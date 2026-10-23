package com.scinode.research;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.scinode.engine.model.WorkflowNode;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;

/** Persistent, user-scoped chat sessions and staged source documents. */
@Service
public class AssistantWorkspaceService {
    static final String NAMESPACE = "assistant-sessions";
    static final int MAX_MESSAGES = 200;
    static final int MAX_MESSAGE_CHARS = 100_000;
    static final int MAX_SESSION_BYTES = 2 * 1024 * 1024;
    static final long MAX_FILE_BYTES = 20L * 1024 * 1024;
    static final int MAX_FILE_CHARS = 100_000;
    static final int MAX_CONTEXT_FILES = 5;
    static final int MAX_CONTEXT_CHARS = 120_000;
    private static final Set<String> EXTENSIONS = Set.of(".docx", ".pdf", ".txt", ".md", ".csv", ".json");
    private static final String UUID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
    static final String RUNTIME_ID = UUID.randomUUID().toString();
    private static final String STORAGE_NAME_PATTERN = UUID_PATTERN + "\\.(docx|pdf|txt|md|csv|json)";

    private final ResearchStore store;
    private final ResearchToolExecutor tools;
    private final Path desktop;

    @Autowired
    public AssistantWorkspaceService(ResearchStore store, ResearchToolExecutor tools,
            @Value("${user.home}") String userHome) {
        this(store, tools, Path.of(userHome, "Desktop"));
    }

    AssistantWorkspaceService(ResearchStore store, ResearchToolExecutor tools, Path desktop) {
        this.store = store;
        this.tools = tools;
        this.desktop = desktop.toAbsolutePath().normalize();
    }

    public synchronized List<JSONObject> sessions(String user, String projectId) throws IOException {
        return sessions(user, projectId, false);
    }

    public synchronized List<JSONObject> sessions(String user, String projectId, boolean archivedOnly) throws IOException {
        String selectedProject = projectId == null || projectId.isBlank() ? null : uuid(projectId);
        if (selectedProject != null) validateProject(user, selectedProject);
        List<JSONObject> result = new ArrayList<>();
        for (JSONObject session : store.list(user, NAMESPACE)) {
            boolean changed = normalizeLegacyArchive(session);
            changed |= recoverTaskAfterRestart(user, session);
            if (changed) saveTaskMutation(user, session);
            if (isArchived(session) != archivedOnly) continue;
            String sessionProject = session.getString("projectId");
            if (!Objects.equals(selectedProject, sessionProject)) continue;
            JSONObject summary = new JSONObject();
            summary.put("id", session.getString("id"));
            summary.put("title", session.getString("title"));
            if (sessionProject != null) summary.put("projectId", sessionProject);
            summary.put("revision", session.getIntValue("revision"));
            summary.put("updatedAt", session.getString("updatedAt"));
            summary.put("messageCount", session.getJSONArray("messages").size());
            JSONObject task = session.getJSONObject("assistantTask");
            if (task != null) {
                summary.put("taskStatus", task.getString("status"));
                summary.put("taskPhase", task.getString("phase"));
                summary.put("taskError", task.getString("error"));
            }
            summary.put("archived", isArchived(session));
            result.add(summary);
        }
        return result;
    }

    public synchronized JSONObject createSession(String user, JSONObject request) throws IOException {
        JSONObject body = copy(request);
        String projectId = body.getString("projectId");
        if (projectId != null && !projectId.isBlank()) {
            projectId = uuid(projectId);
            validateProject(user, projectId);
        }
        String title = body.getString("title");
        if (title != null) validateTitle(title);
        JSONObject session = new JSONObject();
        session.put("id", UUID.randomUUID().toString());
        session.put("title", title == null || title.isBlank() ? "新对话" : title);
        if (projectId != null && !projectId.isBlank()) session.put("projectId", projectId);
        session.put("revision", 1);
        session.put("createdAt", now());
        session.put("updatedAt", now());
        session.put("messages", new JSONArray());
        session.put("contextCards", new JSONArray());
        session.put("trashed", false);
        session.put("archived", false);
        checkSessionSize(session);
        store.write(user, NAMESPACE, session);
        return session;
    }

    public synchronized JSONObject session(String user, String id) throws IOException {
        JSONObject session = store.read(user, NAMESPACE, uuid(id));
        boolean changed = normalizeLegacyArchive(session);
        changed |= recoverTaskAfterRestart(user, session);
        if (changed) saveTaskMutation(user, session);
        return session;
    }

    public synchronized JSONObject saveSession(String user, String id, JSONObject request) throws IOException {
        String sessionId = uuid(id);
        JSONObject body = copy(request);
        if (request != null && request.containsKey("reasoningEffort") && request.get("reasoningEffort") == null) {
            body.put("reasoningEffort", null);
        }
        JSONObject current = store.read(user, NAMESPACE, sessionId);
        if (body.getInteger("revision") == null || body.getIntValue("revision") != current.getIntValue("revision")) {
            throw new IllegalArgumentException("对话版本已更新，请刷新后再保存 (revision conflict)");
        }
        JSONArray messages = body.getJSONArray("messages");
        if (messages == null) throw new IllegalArgumentException("保存对话需要提供 messages 数组");
        validateMessages(messages);
        AssistantContextSupport.sanitizeMessageCards(messages);
        JSONArray pendingContextCards = body.containsKey("contextCards")
                ? AssistantContextSupport.sanitizeCards(body.get("contextCards")) : null;
        if (messages.isEmpty()) {
            JSONObject task = current.getJSONObject("assistantTask");
            if (task != null && "RUNNING".equals(task.getString("status"))) {
                throw new IllegalStateException("本轮回复仍在后台运行；请等待完成或点击“中断”后再清空会话");
            }
            current.remove("assistantTask");
        }
        if (body.containsKey("title")) validateTitle(body.getString("title"));
        if (body.containsKey("reasoningEffort")) validateReasoningEffort(body.get("reasoningEffort"));
        if (body.containsKey("attachments")) {
            if (!(body.get("attachments") instanceof JSONArray attachments)) throw new IllegalArgumentException("attachments 需要是数组");
            validateAttachments(user, attachments);
        }

        for (String field : List.of("title", "configId", "model", "reasoningEffort", "draft", "questionAnswers", "layoutMode", "attachments", "selections", "toolResults", "input")) {
            if (body.containsKey(field)) current.put(field, body.get(field));
        }
        if (pendingContextCards != null) current.put("contextCards", pendingContextCards);
        current.put("messages", messages);
        current.put("revision", current.getIntValue("revision") + 1);
        current.put("updatedAt", now());
        checkSessionSize(current);
        store.write(user, NAMESPACE, current);
        return current;
    }

    public synchronized JSONObject archiveSession(String user, String id) throws IOException {
        JSONObject session = store.read(user, NAMESPACE, uuid(id));
        session.put("archived", true);
        session.remove("trashed");
        session.put("updatedAt", now());
        store.write(user, NAMESPACE, session);
        return session;
    }

    public synchronized JSONObject unarchiveSession(String user, String id) throws IOException {
        JSONObject session = store.read(user, NAMESPACE, uuid(id));
        session.put("archived", false);
        session.put("trashed", false);
        session.put("updatedAt", now());
        store.write(user, NAMESPACE, session);
        return session;
    }

    public synchronized JSONObject associateSession(String user, String id, String projectId, Integer expectedRevision) throws IOException {
        JSONObject session = store.read(user, NAMESPACE, uuid(id));
        String validProjectId = uuid(projectId);
        validateProject(user, validProjectId);
        if (expectedRevision == null || expectedRevision != session.getIntValue("revision")) {
            throw new IllegalArgumentException("对话版本已更新，请刷新后再关联 (revision conflict)");
        }
        if (isArchived(session)) throw new IllegalStateException("已归档对话不能关联到项目，请先取消归档");
        JSONObject task = session.getJSONObject("assistantTask");
        if (task != null && "RUNNING".equals(task.getString("status"))) {
            throw new IllegalStateException("本轮回复仍在后台运行；请等待完成后再关联对话");
        }
        String priorProjectId = session.getString("projectId");
        if (Objects.equals(priorProjectId, validProjectId)) return session;
        if (priorProjectId != null) throw new IllegalArgumentException("这段对话已关联其他项目");
        session.put("projectId", validProjectId);
        saveTaskMutation(user, session);
        return session;
    }

    /** Legacy names retain compatibility while the UI presents a single archive area. */
    public synchronized JSONObject trashSession(String user, String id) throws IOException { return archiveSession(user, id); }
    public synchronized JSONObject restoreSession(String user, String id) throws IOException { return unarchiveSession(user, id); }

    public synchronized JSONObject beginAssistantTask(String user, String id, String taskId,
            Integer revision, JSONObject snapshot, JSONObject request) throws IOException {
        boolean hasReasoningEffort = snapshot != null && snapshot.containsKey("reasoningEffort");
        Object reasoningEffort = snapshot == null ? null : snapshot.get("reasoningEffort");
        snapshot = copy(snapshot);
        if (hasReasoningEffort && reasoningEffort == null) snapshot.put("reasoningEffort", null);
        String sessionId = uuid(id);
        String validTaskId = uuid(taskId);
        JSONObject current = store.read(user, NAMESPACE, sessionId);
        JSONObject previous = current.getJSONObject("assistantTask");
        if (previous != null && "RUNNING".equals(previous.getString("status"))) {
            if (validTaskId.equals(previous.getString("id"))) return current;
            throw new IllegalStateException("这段对话正在处理中，请等待完成或先中断当前回复");
        }
        if (revision == null || revision != current.getIntValue("revision")) {
            throw new IllegalArgumentException("对话版本已更新，请刷新后重试 (revision conflict)");
        }
        if (snapshot == null) throw new IllegalArgumentException("缺少本轮对话保存内容");
        String snapshotProject = snapshot.getString("projectId");
        if (!Objects.equals(snapshotProject, current.getString("projectId"))) throw new IllegalArgumentException("不能更改对话所属项目");
        if (snapshot.containsKey("contextCards")) snapshot.put("contextCards", AssistantContextSupport.sanitizeCards(snapshot.get("contextCards")));
        for (String field : List.of("title", "configId", "model", "reasoningEffort", "draft", "questionAnswers", "layoutMode", "attachments", "selections", "toolResults", "input", "contextCards")) {
            if (snapshot.containsKey(field)) current.put(field, snapshot.get(field));
        }
        if (snapshot.get("title") instanceof String title) validateTitle(title);
        if (snapshot.containsKey("reasoningEffort")) validateReasoningEffort(snapshot.get("reasoningEffort"));
        if (snapshot.containsKey("attachments")) {
            if (!(snapshot.get("attachments") instanceof JSONArray attachments)) throw new IllegalArgumentException("attachments 需要是数组");
            validateAttachments(user, attachments);
        }
        if (!(snapshot.get("messages") instanceof JSONArray sessionMessages)) throw new IllegalArgumentException("保存对话需要提供 messages 数组");
        validateMessages(sessionMessages);
        AssistantContextSupport.sanitizeMessageCards(sessionMessages);
        if (sessionMessages.isEmpty() || !"user".equals(sessionMessages.getJSONObject(sessionMessages.size() - 1).getString("role"))) {
            throw new IllegalArgumentException("本轮对话需要以用户消息结尾");
        }
        current.put("messages", JSON.parseArray(sessionMessages.toJSONString()));
        JSONObject chat = copy(request);
        if (chat.isEmpty()) throw new IllegalArgumentException("缺少助手请求内容");
        String projectId = chat.getString("projectId");
        if (projectId != null && !projectId.isBlank()) projectId = uuid(projectId);
        if (!Objects.equals(projectId, current.getString("projectId"))) {
            throw new IllegalArgumentException("助手请求项目范围与对话不匹配");
        }
        if (!(chat.get("messages") instanceof JSONArray requestMessages)) throw new IllegalArgumentException("助手请求需要提供 messages 数组");
        validateMessages(requestMessages);
        AssistantContextSupport.sanitizeMessageCards(requestMessages);
        JSONObject lastRequestMessage = requestMessages.getJSONObject(requestMessages.size() - 1);
        JSONObject lastSessionMessage = sessionMessages.getJSONObject(sessionMessages.size() - 1);
        if (!"user".equals(lastRequestMessage.getString("role"))
                || !Objects.equals(lastRequestMessage.getString("content"), lastSessionMessage.getString("content"))) {
            throw new IllegalArgumentException("本轮请求与当前会话最后一条用户消息不匹配");
        }
        JSONArray requestCards = AssistantContextSupport.sanitizeCards(lastRequestMessage.get("contextCards"));
        JSONArray sessionCards = AssistantContextSupport.sanitizeCards(lastSessionMessage.get("contextCards"));
        if (!requestCards.toJSONString().equals(sessionCards.toJSONString())) {
            throw new IllegalArgumentException("本轮请求上下文卡片与当前会话不匹配");
        }
        chat.put("messages", requestMessages);
        chat.put("requestId", validTaskId);
        current.put("configId", chat.get("configId"));
        if (chat.containsKey("model")) current.put("model", chat.get("model"));
        if (chat.containsKey("reasoningEffort")) current.put("reasoningEffort", chat.get("reasoningEffort"));
        JSONObject task = new JSONObject();
        task.put("id", validTaskId);
        task.put("requestId", validTaskId);
        task.put("status", "RUNNING");
        task.put("phase", "PREPARING");
        task.put("startedAt", now());
        task.put("updatedAt", now());
        task.put("runtimeId", RUNTIME_ID);
        task.put("request", chat);
        task.put("userText", current.getString("input"));
        current.put("assistantTask", task);
        saveTaskMutation(user, current);
        return current;
    }

    public synchronized JSONObject finishAssistantTask(String user, String id, String taskId, JSONObject result) throws IOException {
        JSONObject current = readExistingSession(user, id);
        if (current == null) return null;
        JSONObject task = current.getJSONObject("assistantTask");
        if (!matchingRunningTask(task, taskId)) return current;
        String reply = result.getString("reply");
        if (reply == null) throw new IllegalArgumentException("助手响应缺少 reply");
        JSONObject message = new JSONObject();
        message.put("role", "assistant");
        message.put("content", reply);
        for (String field : List.of("draft", "planning", "questions", "repaired")) {
            if (result.containsKey(field)) message.put(field, result.get(field));
        }
        JSONArray messages = current.getJSONArray("messages");
        if (messages == null) messages = new JSONArray();
        JSONArray nextMessages = JSON.parseArray(messages.toJSONString());
        nextMessages.add(message);
        if (nextMessages.size() > MAX_MESSAGES) nextMessages.remove(0);
        current.put("messages", nextMessages);
        if (Objects.equals(current.getString("input"), task.getString("userText"))) current.put("input", "");
        if (result.containsKey("draft")) current.put("draft", result.get("draft"));
        current.put("questionAnswers", new JSONObject());
        task.put("status", "COMPLETED");
        task.put("phase", "COMPLETED");
        task.put("responseModel", result.getString("model"));
        task.put("updatedAt", now());
        current.put("assistantTask", task);
        saveTaskMutation(user, current);
        return current;
    }

    public synchronized JSONObject failAssistantTask(String user, String id, String taskId, String error) throws IOException {
        JSONObject current = readExistingSession(user, id);
        if (current == null) return null;
        JSONObject task = current.getJSONObject("assistantTask");
        if (!matchingRunningTask(task, taskId)) return current;
        task.put("status", "FAILED");
        task.put("phase", "FAILED");
        task.put("error", error == null || error.isBlank() ? "助手请求失败，请重试。" : error.substring(0, Math.min(error.length(), 2_000)));
        task.put("updatedAt", now());
        current.put("assistantTask", task);
        saveTaskMutation(user, current);
        return current;
    }

    public synchronized JSONObject cancelAssistantTask(String user, String id, String taskId) throws IOException {
        JSONObject current = readExistingSession(user, id);
        if (current == null) return null;
        JSONObject task = current.getJSONObject("assistantTask");
        if (!matchingRunningTask(task, taskId)) return current;
        task.put("status", "CANCELED");
        task.put("phase", "CANCELED");
        task.put("updatedAt", now());
        current.put("assistantTask", task);
        saveTaskMutation(user, current);
        return current;
    }

    public synchronized JSONObject setAssistantTaskPhase(String user, String id, String taskId, String phase) throws IOException {
        JSONObject current = readExistingSession(user, id);
        if (current == null) return null;
        JSONObject task = current.getJSONObject("assistantTask");
        if (!matchingRunningTask(task, taskId)) return current;
        if (!Objects.equals(task.getString("phase"), phase)) {
            task.put("phase", phase);
            task.put("updatedAt", now());
            current.put("assistantTask", task);
            saveTaskMutation(user, current);
        }
        return current;
    }

    public synchronized JSONObject deleteSession(String user, String id) throws IOException {
        String sessionId = uuid(id);
        store.read(user, NAMESPACE, sessionId);
        store.delete(user, NAMESPACE, sessionId);
        return new JSONObject(Map.of("id", sessionId, "deleted", true));
    }

    private void saveTaskMutation(String user, JSONObject session) throws IOException {
        session.put("revision", session.getIntValue("revision") + 1);
        session.put("updatedAt", now());
        checkSessionSize(session);
        store.write(user, NAMESPACE, session);
    }

    private JSONObject readExistingSession(String user, String id) throws IOException {
        try { return store.read(user, NAMESPACE, uuid(id)); }
        catch (IllegalArgumentException missing) {
            if (missing.getMessage() != null && missing.getMessage().contains("尚未创建")) return null;
            throw missing;
        }
    }

    private static boolean matchingRunningTask(JSONObject task, String taskId) {
        return task != null && "RUNNING".equals(task.getString("status")) && Objects.equals(task.getString("id"), taskId);
    }

    private static boolean isArchived(JSONObject session) {
        return session.getBooleanValue("archived") || session.getBooleanValue("trashed");
    }

    private boolean normalizeLegacyArchive(JSONObject session) {
        if (!session.getBooleanValue("trashed")) return false;
        session.put("archived", true);
        session.remove("trashed");
        return true;
    }

    private boolean recoverTaskAfterRestart(String user, JSONObject session) throws IOException {
        JSONObject task = session.getJSONObject("assistantTask");
        if (task == null || !"RUNNING".equals(task.getString("status"))
                || RUNTIME_ID.equals(task.getString("runtimeId"))) return false;
        task.put("status", "INTERRUPTED");
        task.put("phase", "FAILED");
        task.put("error", "服务重启时本轮请求被中断；原问题和草案已保留，可重试。");
        task.put("updatedAt", now());
        session.put("assistantTask", task);
        return true;
    }

    private static JSONObject copyMessage(JSONObject message) { return JSON.parseObject(message.toJSONString()); }

    public JSONObject upload(String user, MultipartFile upload) throws Exception {
        if (upload == null || upload.isEmpty()) throw new IllegalArgumentException("文件内容不能为空");
        if (upload.getSize() > MAX_FILE_BYTES) throw new IllegalArgumentException("单个文件最大支持20MB");
        String name = validName(upload.getOriginalFilename());
        byte[] bytes = upload.getBytes();
        if (bytes.length == 0) throw new IllegalArgumentException("文件内容不能为空");
        if (bytes.length > MAX_FILE_BYTES) throw new IllegalArgumentException("单个文件最大支持20MB");
        return stage(user, name, bytes);
    }

    public JSONObject importLocalFile(String user, String requestedPath) throws Exception {
        if (requestedPath == null || requestedPath.isBlank()) throw new IllegalArgumentException("请提供本机文件路径");
        Path source;
        try { source = Path.of(requestedPath).toRealPath(); }
        catch (InvalidPathException | NoSuchFileException e) { throw new IllegalArgumentException("本机文件路径无效或文件不存在"); }
        if (!Files.isRegularFile(source, LinkOption.NOFOLLOW_LINKS) && !Files.isRegularFile(source)) {
            throw new IllegalArgumentException("指定路径需要指向一个本机文件");
        }
        long size = Files.size(source);
        if (size == 0) throw new IllegalArgumentException("文件内容不能为空");
        if (size > MAX_FILE_BYTES) throw new IllegalArgumentException("单个文件最大支持20MB");
        String name = validName(source.getFileName().toString());
        byte[] bytes = Files.readAllBytes(source);
        if (bytes.length != size || bytes.length == 0 || bytes.length > MAX_FILE_BYTES) {
            throw new IllegalArgumentException("读取本机文件时文件大小发生变化，请重试");
        }
        return stage(user, name, bytes);
    }

    public JSONObject localFiles(String requestedPath) throws IOException {
        Path directory;
        try { directory = Path.of(requestedPath == null || requestedPath.isBlank() ? desktop.toString() : requestedPath).toRealPath(); }
        catch (InvalidPathException | NoSuchFileException e) { throw new IllegalArgumentException("目录路径无效或目录不存在"); }
        if (!Files.isDirectory(directory)) throw new IllegalArgumentException("请指定一个本机目录");
        JSONObject result = new JSONObject();
        result.put("path", directory.toString());
        Path parent = directory.getParent();
        if (parent != null) result.put("parentPath", parent.toString());
        JSONArray entries = new JSONArray();
        try (var stream = Files.list(directory)) {
            List<Path> paths = new ArrayList<>(stream.filter(path -> !isHidden(path) && !isSensitiveDirectory(path))
                    .limit(501).toList());
            if (paths.size() > 500) throw new IllegalArgumentException("目录包含超过500个可见项目，请指定更具体的目录");
            paths.sort(Comparator.comparing((Path path) -> !Files.isDirectory(path))
                    .thenComparing(path -> path.getFileName().toString().toLowerCase(Locale.ROOT)));
            for (Path path : paths) {
                JSONObject entry = new JSONObject();
                entry.put("name", path.getFileName().toString());
                entry.put("path", path.toString());
                boolean isDirectory = Files.isDirectory(path);
                entry.put("directory", isDirectory);
                if (!isDirectory && Files.isRegularFile(path)) entry.put("size", Files.size(path));
                entries.add(entry);
            }
        }
        result.put("entries", entries);
        return result;
    }

    /** Internal file API used by ResearchAssistantService; storage paths stay private. */
    public JSONObject file(String user, String id) throws IOException {
        JSONObject metadata = readFileMetadata(user, id);
        Path contentPath = contentPath(user, metadata);
        if (!Files.isRegularFile(contentPath) || Files.size(contentPath) != metadata.getLongValue("size")
                || !ResearchStore.hash(contentPath).equals(metadata.getString("sha256"))) {
            throw new IllegalStateException("暂存附件缺失或校验失败，请重新添加文件: " + metadata.getString("name"));
        }
        String body = metadata.getString("content");
        if (body == null || body.length() != metadata.getIntValue("characters") || body.length() > MAX_FILE_CHARS) {
            throw new IllegalStateException("附件正文记录缺失或校验失败，请重新添加文件: " + metadata.getString("name"));
        }
        JSONObject result = safeMetadata(metadata);
        result.put("content", body);
        return result;
    }

    /** Builds explicitly labeled user material for the model context after the user submits it. */
    public JSONObject attachmentContext(String user, List<String> ids) throws IOException {
        if (ids == null || ids.isEmpty()) return new JSONObject(Map.of("content", "", "attachments", new JSONArray()));
        if (ids.size() > MAX_CONTEXT_FILES) throw new IllegalArgumentException("每次最多使用5个附件");
        JSONArray attachments = new JSONArray();
        StringBuilder context = new StringBuilder("以下内容为用户主动提交的材料，仅作为用户材料供本轮科研助手分析：\n");
        int totalCharacters = 0;
        for (String id : ids) {
            JSONObject item = file(user, id);
            String content = item.getString("content");
            totalCharacters += item.getIntValue("characters");
            if (totalCharacters > MAX_CONTEXT_CHARS) throw new IllegalArgumentException("附件正文总长度超过120000字符，请减少附件或拆分后发送");
            context.append("\n--- 用户材料：").append(item.getString("name")).append(" ---\n").append(content).append('\n');
            item.remove("content");
            attachments.add(item);
        }
        if (context.length() > MAX_CONTEXT_CHARS + 2_000) throw new IllegalArgumentException("附件正文总长度超过120000字符，请减少附件或拆分后发送");
        return new JSONObject(Map.of("content", context.toString(), "attachments", attachments));
    }

    private JSONObject stage(String user, String name, byte[] bytes) throws Exception {
        String id = UUID.randomUUID().toString();
        Path owner = store.owner(user);
        Path namespace = owner.resolve(NAMESPACE);
        Path contentDirectory = namespace.resolve("content");
        Path stagingDirectory = namespace.resolve("staging");
        Files.createDirectories(contentDirectory);
        Files.createDirectories(stagingDirectory);
        restrictDirectory(owner);
        restrictDirectory(namespace);
        restrictDirectory(contentDirectory);
        restrictDirectory(stagingDirectory);
        String extension = extension(name);
        Path contentPath = contentDirectory.resolve(id + extension);
        Path pending = Files.createTempFile(contentDirectory, ".upload-", ".tmp");
        Path work = null;
        try {
            Files.write(pending, bytes, StandardOpenOption.TRUNCATE_EXISTING);
            Files.move(pending, contentPath, StandardCopyOption.ATOMIC_MOVE);
            String hash = ResearchStore.hash(contentPath);
            if (Files.size(contentPath) != bytes.length || !hash.equals(ResearchStore.hash(bytes))) {
                throw new IllegalStateException("附件副本校验失败");
            }
            work = Files.createTempDirectory(stagingDirectory, "extract-");
            WorkflowNode node = new WorkflowNode();
            node.setId("assistant-document");
            node.setType("research");
            node.setData(Map.of("kind", "document", "filePath", contentPath.toString()));
            Map<String, Object> output;
            try {
                output = tools.execute(node, Map.of("_workDir", work.toString(), "filePath", contentPath.toString()));
            } catch (Exception error) {
                if (".pdf".equals(extension) && (error.getMessage() == null || !error.getMessage().contains("可提取文本层"))) {
                    throw new IllegalArgumentException("PDF正文提取失败；扫描件需要先完成文字识别。原始错误：" + error.getMessage(), error);
                }
                throw error;
            }
            Object rawText = output.get("text");
            if (!(rawText instanceof String text)) throw new IllegalStateException("文档提取结果缺少正文");
            if (text.isBlank()) throw new IllegalArgumentException("文档没有可提取正文");
            if (text.length() > MAX_FILE_CHARS) throw new IllegalArgumentException("单个文件正文超过100000字符");
            JSONObject metadata = new JSONObject();
            metadata.put("id", id);
            metadata.put("name", name);
            metadata.put("size", bytes.length);
            metadata.put("sha256", hash);
            metadata.put("characters", text.length());
            metadata.put("preview", text.substring(0, Math.min(1_000, text.length())));
            metadata.put("content", text);
            metadata.put("storageName", contentPath.getFileName().toString());
            metadata.put("createdAt", now());
            try {
                store.write(user, NAMESPACE + "/files", metadata);
            } catch (Exception error) {
                Files.deleteIfExists(contentPath);
                throw error;
            }
            return safeMetadata(metadata);
        } catch (Exception error) {
            Files.deleteIfExists(contentPath);
            throw error;
        } finally {
            Files.deleteIfExists(pending);
            if (work != null) deleteTree(work);
        }
    }

    private JSONObject readFileMetadata(String user, String id) throws IOException {
        return store.read(user, NAMESPACE + "/files", uuid(id));
    }

    private Path contentPath(String user, JSONObject metadata) {
        String id = uuid(metadata.getString("id"));
        String storageName = metadata.getString("storageName");
        if (storageName == null || !storageName.matches(STORAGE_NAME_PATTERN)) {
            throw new IllegalStateException("附件存储记录格式错误");
        }
        Path directory = store.owner(user).resolve(NAMESPACE).resolve("content").toAbsolutePath().normalize();
        Path path = directory.resolve(storageName).normalize();
        if (!path.startsWith(directory) || !storageName.startsWith(id + ".")) throw new IllegalStateException("附件存储记录格式错误");
        return path;
    }

    private JSONObject safeMetadata(JSONObject metadata) {
        JSONObject result = new JSONObject();
        for (String field : List.of("id", "name", "size", "sha256", "characters", "preview")) {
            if (metadata.containsKey(field)) result.put(field, metadata.get(field));
        }
        return result;
    }

    private void validateProject(String user, String projectId) throws IOException {
        store.read(user, "projects", uuid(projectId));
    }

    private void validateAttachments(String user, JSONArray attachments) throws IOException {
        if (attachments == null) return;
        for (int index = 0; index < attachments.size(); index++) {
            Object value = attachments.get(index);
            String id;
            if (value instanceof String fileId) id = fileId;
            else if (value instanceof JSONObject attachment) id = attachment.getString("id");
            else throw new IllegalArgumentException("attachments[" + index + "] 需要是附件ID或附件对象");
            readFileMetadata(user, id);
        }
    }

    private static void validateMessages(JSONArray messages) {
        if (messages.size() > MAX_MESSAGES) throw new IllegalArgumentException("对话最多保留200条消息");
        for (int index = 0; index < messages.size(); index++) {
            Object value = messages.get(index);
            if (!(value instanceof JSONObject message)) throw new IllegalArgumentException("messages[" + index + "] 应为对象");
            if (!(message.get("role") instanceof String role) || !Set.of("user", "assistant").contains(role)) {
                throw new IllegalArgumentException("messages[" + index + "] 的 role 需要是 user 或 assistant");
            }
            if (!(message.get("content") instanceof String content)) throw new IllegalArgumentException("messages[" + index + "] 缺少文本 content");
            JSONArray cards = AssistantContextSupport.sanitizeCards(message.get("contextCards"));
            String context = AssistantContextSupport.formatForModel(cards);
            if (content.length() + context.length() > MAX_MESSAGE_CHARS) throw new IllegalArgumentException("单条消息与上下文卡片正文最多100000字符");
            if (!cards.isEmpty()) message.put("contextCards", cards);
        }
    }

    private static void checkSessionSize(JSONObject session) {
        int size = JSON.toJSONString(session).getBytes(StandardCharsets.UTF_8).length;
        if (size > MAX_SESSION_BYTES) throw new IllegalArgumentException("完整对话记录超过2MB，请保留较少的附件元信息后重试");
    }

    private static void validateReasoningEffort(Object value) {
        if (value != null && (!(value instanceof String effort) || !Set.of("low", "medium", "high").contains(effort))) {
            throw new IllegalArgumentException("reasoningEffort 只支持 low、medium 或 high；默认设置请省略该字段");
        }
    }

    private static void validateTitle(String title) {
        if (title == null) throw new IllegalArgumentException("对话标题需要是文本");
        if (title.length() > 200) throw new IllegalArgumentException("对话标题最多200字符");
    }

    private static JSONObject copy(JSONObject source) {
        return source == null ? new JSONObject() : JSON.parseObject(source.toJSONString());
    }

    private static String uuid(String value) {
        if (value == null || !value.matches(UUID_PATTERN)) throw new IllegalArgumentException("ID 应为 UUID");
        return UUID.fromString(value).toString();
    }

    private static String validName(String rawName) {
        if (rawName == null || rawName.isBlank() || rawName.contains("/") || rawName.contains("\\")
                || rawName.equals(".") || rawName.equals("..") || rawName.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("文件名格式错误");
        }
        extension(rawName);
        return rawName;
    }

    private static String extension(String name) {
        int dot = name.lastIndexOf('.');
        String extension = dot < 0 ? "" : name.substring(dot).toLowerCase(Locale.ROOT);
        if (!EXTENSIONS.contains(extension)) throw new IllegalArgumentException("文件格式请使用docx、pdf、txt、md、csv或json");
        return extension;
    }

    private static boolean isHidden(Path path) {
        try { return path.getFileName().toString().startsWith(".") || Files.isHidden(path); }
        catch (IOException error) { throw new IllegalStateException("检查本机目录项失败: " + path.getFileName(), error); }
    }

    private static boolean isSensitiveDirectory(Path path) {
        if (!Files.isDirectory(path)) return false;
        String name = path.getFileName().toString().toLowerCase(Locale.ROOT);
        return Set.of("library", "keychains", "application support", "containers", "private", "system volume information").contains(name);
    }

    private static void restrictDirectory(Path directory) throws IOException {
        if (Files.getFileStore(directory).supportsFileAttributeView("posix")) {
            Files.setPosixFilePermissions(directory, java.nio.file.attribute.PosixFilePermissions.fromString("rwx------"));
        }
    }

    private static void deleteTree(Path path) throws IOException {
        if (!Files.exists(path)) return;
        try (var walk = Files.walk(path)) {
            for (Path entry : walk.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(entry);
        }
    }

    private static String now() { return Instant.now().toString(); }

}
