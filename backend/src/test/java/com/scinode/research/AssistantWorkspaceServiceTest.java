package com.scinode.research;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockMultipartFile;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class AssistantWorkspaceServiceTest {
    @TempDir Path temp;
    private ResearchStore store;
    private AssistantWorkspaceService workspace;

    @BeforeEach
    void setUp() throws Exception {
        store = new ResearchStore(temp.resolve("data").toString());
        ResearchToolExecutor tools = new ResearchToolExecutor("python3", "Rscript", "python3");
        Path desktop = Files.createDirectory(temp.resolve("Desktop"));
        workspace = new AssistantWorkspaceService(store, tools, desktop);
    }

    @Test
    void sessionsAreScopedByUserAndProjectAndLegacyTrashIsAnAccessibleArchive() throws Exception {
        String user = "alice";
        String projectId = UUID.randomUUID().toString();
        store.write(user, "projects", new JSONObject(Map.of("id", projectId, "revision", 1)));

        JSONObject home = workspace.createSession(user, new JSONObject());
        JSONObject project = workspace.createSession(user, new JSONObject(Map.of("title", "项目会话", "projectId", projectId)));
        assertEquals(1, workspace.sessions(user, null).size());
        assertEquals(home.getString("id"), workspace.sessions(user, null).get(0).getString("id"));
        assertEquals(project.getString("id"), workspace.sessions(user, projectId).get(0).getString("id"));
        assertThrows(IllegalArgumentException.class, () -> workspace.session("bob", home.getString("id")));

        JSONObject archived = workspace.archiveSession(user, home.getString("id"));
        assertTrue(archived.getBooleanValue("archived"));
        assertTrue(workspace.sessions(user, null).isEmpty());
        assertEquals(1, workspace.sessions(user, null, true).size());
        assertFalse(workspace.unarchiveSession(user, home.getString("id")).getBooleanValue("archived"));
        assertEquals(1, workspace.sessions(user, null).size());

        JSONObject old = workspace.createSession(user, new JSONObject(Map.of("title", "旧回收站会话")));
        old.put("trashed", true);
        old.remove("archived");
        store.write(user, AssistantWorkspaceService.NAMESPACE, old);
        assertEquals(1, workspace.sessions(user, null, true).size());
        JSONObject migrated = workspace.session(user, old.getString("id"));
        assertTrue(migrated.getBooleanValue("archived"));
        assertFalse(migrated.containsKey("trashed"));
    }

    @Test
    void homeSessionCanBeOptimisticallyAssociatedWithNewProjectWithoutLosingConversation() throws Exception {
        JSONObject session = workspace.createSession("alice", new JSONObject());
        String projectId = UUID.randomUUID().toString();
        store.write("alice", "projects", new JSONObject(Map.of("id", projectId, "revision", 1)));
        JSONObject saved = workspace.saveSession("alice", session.getString("id"), new JSONObject(Map.of(
                "revision", 1,
                "messages", new JSONArray(List.of(new JSONObject(Map.of("role", "user", "content", "请生成方案")),
                        new JSONObject(Map.of("role", "assistant", "content", "已生成草案", "draft", Map.of("name", "本地草案"))))),
                "draft", Map.of("name", "本地草案"), "contextCards", List.of(Map.of("id", "c1", "type", "project_summary", "title", "项目资料", "content", "当前版本 v2", "truncated", false)))));

        JSONObject associated = workspace.associateSession("alice", session.getString("id"), projectId, saved.getIntValue("revision"));
        assertEquals(projectId, associated.getString("projectId"));
        assertEquals(saved.getIntValue("revision") + 1, associated.getIntValue("revision"));
        assertEquals("本地草案", associated.getJSONObject("draft").getString("name"));
        assertEquals("当前版本 v2", associated.getJSONArray("contextCards").getJSONObject(0).getString("content"));
        assertEquals(associated.getString("id"), workspace.sessions("alice", projectId).get(0).getString("id"));
        assertTrue(workspace.sessions("alice", null).isEmpty());
        assertThrows(IllegalArgumentException.class, () -> workspace.associateSession("alice", session.getString("id"), projectId, saved.getIntValue("revision")));
        assertThrows(IllegalArgumentException.class, () -> workspace.associateSession("bob", session.getString("id"), projectId, associated.getIntValue("revision")));
    }

    @Test
    void requestMustCarrySameContextCardsAsThePersistedUserTurn() throws Exception {
        JSONObject session = workspace.createSession("alice", new JSONObject());
        String id = session.getString("id"), taskId = UUID.randomUUID().toString();
        JSONObject card = new JSONObject(Map.of("id", "c1", "type", "project_summary", "title", "项目资料", "content", "版本 v3", "truncated", false));
        String defaultMaterialPrompt = "请结合已选择的材料协助分析。";
        JSONObject userMessage = new JSONObject(Map.of("role", "user", "content", defaultMaterialPrompt, "contextCards", List.of(card)));
        JSONObject snapshot = new JSONObject(Map.of("id", id, "revision", 1, "messages", new JSONArray(List.of(userMessage)), "input", defaultMaterialPrompt));
        JSONObject request = new JSONObject(Map.of("configId", 1, "messages", new JSONArray(List.of(new JSONObject(Map.of("role", "user", "content", defaultMaterialPrompt))))));
        assertThrows(IllegalArgumentException.class, () -> workspace.beginAssistantTask("alice", id, taskId, 1, snapshot, request));
        request.getJSONArray("messages").getJSONObject(0).put("contextCards", new JSONArray(List.of(card)));
        JSONObject started = workspace.beginAssistantTask("alice", id, taskId, 1, snapshot, request);
        assertEquals("版本 v3", started.getJSONObject("assistantTask").getJSONObject("request").getJSONArray("messages").getJSONObject(0).getJSONArray("contextCards").getJSONObject(0).getString("content"));
        assertEquals(defaultMaterialPrompt, started.getString("input"));
    }

    @Test
    void beginningTaskClearsSavedPendingCardsButKeepsCardsOnTheSentUserMessage() throws Exception {
        JSONObject created = workspace.createSession("alice", new JSONObject());
        String id = created.getString("id"), taskId = UUID.randomUUID().toString();
        JSONObject pendingCard = new JSONObject(Map.of("id", "pending-1", "type", "project_summary", "title", "项目资料", "content", "尚未发送的项目资料", "truncated", false));
        JSONObject saved = workspace.saveSession("alice", id, new JSONObject(Map.of(
                "revision", 1,
                "messages", new JSONArray(),
                "contextCards", new JSONArray(List.of(pendingCard)))));
        assertEquals(1, saved.getJSONArray("contextCards").size());

        JSONObject sentCard = new JSONObject(Map.of("id", "sent-1", "type", "run_error", "title", "运行报错", "content", "已确认发送的脱敏运行摘要", "truncated", false));
        String prompt = "请结合已选择的材料协助分析。";
        JSONObject userMessage = new JSONObject(Map.of("role", "user", "content", prompt, "contextCards", new JSONArray(List.of(sentCard))));
        JSONObject snapshot = new JSONObject(Map.of(
                "id", id,
                "revision", saved.getIntValue("revision"),
                "messages", new JSONArray(List.of(userMessage)),
                "input", prompt,
                "contextCards", new JSONArray()));
        JSONObject requestMessage = new JSONObject(Map.of("role", "user", "content", prompt, "contextCards", new JSONArray(List.of(sentCard))));
        JSONObject request = new JSONObject(Map.of("configId", 1, "messages", new JSONArray(List.of(requestMessage))));

        JSONObject started = workspace.beginAssistantTask("alice", id, taskId, saved.getIntValue("revision"), snapshot, request);
        JSONObject reloaded = workspace.session("alice", id);

        assertTrue(started.getJSONArray("contextCards").isEmpty());
        assertTrue(reloaded.getJSONArray("contextCards").isEmpty());
        JSONObject returnedUserMessage = started.getJSONArray("messages").getJSONObject(0);
        JSONObject reloadedUserMessage = reloaded.getJSONArray("messages").getJSONObject(0);
        assertEquals("sent-1", returnedUserMessage.getJSONArray("contextCards").getJSONObject(0).getString("id"));
        assertEquals("sent-1", reloadedUserMessage.getJSONArray("contextCards").getJSONObject(0).getString("id"));
    }

    @Test
    void savePreservesAssistantMetadataAndRejectsStaleRevision() throws Exception {
        JSONObject created = workspace.createSession("alice", new JSONObject(Map.of("title", "对话")));
        String id = created.getString("id");
        JSONObject attachment = workspace.upload("alice", new MockMultipartFile("file", "history.txt", "text/plain", "历史材料".getBytes()));
        JSONObject message = new JSONObject(Map.of(
                "role", "assistant",
                "content", "请确认方案",
                "planning", Map.of("stage", "questions"),
                "questions", List.of("结局是什么？"),
                "draft", Map.of("nodes", List.of()),
                "repaired", true,
                "attachments", List.of(Map.of("id", "example"))));
        JSONObject request = new JSONObject(Map.of(
                "revision", 1,
                "reasoningEffort", "high",
                "messages", new JSONArray(List.of(message)),
                "draft", Map.of("nodes", List.of()),
                "questionAnswers", Map.of("结局是什么？", "28天死亡"),
                "layoutMode", "split",
                "attachments", List.of(Map.of("id", attachment.getString("id"), "name", "history.txt")),
                "selections", List.of("file-1")));
        JSONObject saved = workspace.saveSession("alice", id, request);
        assertEquals(2, saved.getIntValue("revision"));
        assertEquals("high", saved.getString("reasoningEffort"));
        assertEquals("high", workspace.session("alice", id).getString("reasoningEffort"));
        assertTrue(saved.getJSONArray("messages").getJSONObject(0).getBooleanValue("repaired"));
        assertEquals("questions", saved.getJSONArray("messages").getJSONObject(0).getJSONObject("planning").getString("stage"));
        assertEquals("28天死亡", workspace.session("alice", id).getJSONObject("questionAnswers").getString("结局是什么？"));
        assertEquals(attachment.getString("id"), saved.getJSONArray("attachments").getJSONObject(0).getString("id"));
        IllegalArgumentException conflict = assertThrows(IllegalArgumentException.class,
                () -> workspace.saveSession("alice", id, request));
        assertTrue(conflict.getMessage().contains("revision conflict"));

        JSONObject otherUser = workspace.createSession("bob", new JSONObject());
        JSONObject crossUser = new JSONObject(Map.of("revision", 1, "messages", new JSONArray(), "attachments", List.of(attachment.getString("id"))));
        assertThrows(IllegalArgumentException.class, () -> workspace.saveSession("bob", otherUser.getString("id"), crossUser));
    }

    @Test
    void savingDefaultReasoningEffortClearsThePreviouslySelectedValue() throws Exception {
        JSONObject created = workspace.createSession("alice", new JSONObject());
        String id = created.getString("id");
        JSONObject selected = workspace.saveSession("alice", id, new JSONObject(Map.of(
                "revision", 1, "messages", new JSONArray(), "reasoningEffort", "high")));
        assertEquals("high", selected.getString("reasoningEffort"));

        JSONObject reset = new JSONObject();
        reset.put("revision", selected.getIntValue("revision"));
        reset.put("messages", new JSONArray());
        reset.put("reasoningEffort", null);
        JSONObject savedDefault = workspace.saveSession("alice", id, reset);

        assertNull(savedDefault.get("reasoningEffort"));
        assertNull(workspace.session("alice", id).get("reasoningEffort"));
    }

    @Test
    void backgroundResultSurvivesConcurrentAndStaleSessionSavesExactlyOnce() throws Exception {
        JSONObject created = workspace.createSession("alice", new JSONObject());
        String id = created.getString("id"), taskId = UUID.randomUUID().toString();
        JSONObject snapshot = new JSONObject();
        snapshot.put("id", id); snapshot.put("revision", 1); snapshot.put("projectId", null);
        snapshot.put("title", "后台任务"); snapshot.put("messages", new JSONArray(List.of(new JSONObject(Map.of("role", "user", "content", "检查问题")))));
        snapshot.put("input", "检查问题");
        JSONObject request = new JSONObject(Map.of("configId", 1, "messages", new JSONArray(List.of(new JSONObject(Map.of("role", "user", "content", "检查问题"))))));
        JSONObject started = workspace.beginAssistantTask("alice", id, taskId, 1, snapshot, request);
        assertEquals("RUNNING", started.getJSONObject("assistantTask").getString("status"));
        assertEquals(2, started.getIntValue("revision"));
        assertThrows(IllegalStateException.class, () -> workspace.beginAssistantTask("alice", id, UUID.randomUUID().toString(), 2, snapshot, request));

        JSONObject concurrentSave = new JSONObject();
        concurrentSave.put("revision", 2); concurrentSave.put("messages", started.getJSONArray("messages"));
        concurrentSave.put("draft", Map.of("name", "手动草案"));
        JSONObject savedWhileRunning = workspace.saveSession("alice", id, concurrentSave);
        assertEquals(3, savedWhileRunning.getIntValue("revision"));

        JSONObject result = new JSONObject(Map.of("reply", "后台验收完成", "draft", Map.of("name", "后台草案"), "model", "fake-model"));
        JSONObject completed = workspace.finishAssistantTask("alice", id, taskId, result);
        assertEquals("COMPLETED", completed.getJSONObject("assistantTask").getString("status"));
        assertEquals(2, completed.getJSONArray("messages").size());
        assertEquals("后台验收完成", completed.getJSONArray("messages").getJSONObject(1).getString("content"));
        assertEquals("后台草案", completed.getJSONObject("draft").getString("name"));
        assertThrows(IllegalArgumentException.class, () -> workspace.saveSession("alice", id, concurrentSave));
        JSONObject duplicateCompletion = workspace.finishAssistantTask("alice", id, taskId, result);
        assertEquals(2, duplicateCompletion.getJSONArray("messages").size());
    }

    @Test
    void explicitCancellationWinsAgainstLateCompletionAndPermanentDeleteCannotBeRecreated() throws Exception {
        JSONObject created = workspace.createSession("alice", new JSONObject());
        String id = created.getString("id"), taskId = UUID.randomUUID().toString();
        JSONObject snapshot = new JSONObject(Map.of("id", id, "revision", 1, "title", "取消测试", "messages", new JSONArray(List.of(new JSONObject(Map.of("role", "user", "content", "待取消")))), "input", "待取消"));
        JSONObject request = new JSONObject(Map.of("configId", 1, "messages", new JSONArray(List.of(new JSONObject(Map.of("role", "user", "content", "待取消"))))));
        workspace.beginAssistantTask("alice", id, taskId, 1, snapshot, request);
        JSONObject canceled = workspace.cancelAssistantTask("alice", id, taskId);
        assertEquals("CANCELED", canceled.getJSONObject("assistantTask").getString("status"));
        assertEquals("CANCELED", workspace.finishAssistantTask("alice", id, taskId, new JSONObject(Map.of("reply", "late")))
                .getJSONObject("assistantTask").getString("status"));
        assertEquals(1, workspace.session("alice", id).getJSONArray("messages").size());

        JSONObject other = workspace.createSession("alice", new JSONObject());
        String otherId = other.getString("id"), otherTask = UUID.randomUUID().toString();
        JSONObject otherSnapshot = new JSONObject(Map.of("id", otherId, "revision", 1, "title", "删除测试", "messages", new JSONArray(List.of(new JSONObject(Map.of("role", "user", "content", "后台处理中"))))));
        JSONObject otherRequest = new JSONObject(Map.of("configId", 1, "messages", new JSONArray(List.of(new JSONObject(Map.of("role", "user", "content", "后台处理中"))))));
        workspace.beginAssistantTask("alice", otherId, otherTask, 1, otherSnapshot, otherRequest);
        workspace.deleteSession("alice", otherId);
        assertNull(workspace.finishAssistantTask("alice", otherId, otherTask, new JSONObject(Map.of("reply", "迟到结果"))));
        assertThrows(IllegalArgumentException.class, () -> workspace.session("alice", otherId));
    }

    @Test
    void runningTaskFromAnotherRuntimeIsMarkedInterruptedAndCanBeRetried() throws Exception {
        JSONObject created = workspace.createSession("alice", new JSONObject());
        String id = created.getString("id"), taskId = UUID.randomUUID().toString();
        JSONObject snapshot = new JSONObject(Map.of("id", id, "revision", 1, "title", "重启测试", "messages", new JSONArray(List.of(new JSONObject(Map.of("role", "user", "content", "保留问题"))))));
        JSONObject request = new JSONObject(Map.of("configId", 1, "messages", new JSONArray(List.of(new JSONObject(Map.of("role", "user", "content", "保留问题"))))));
        JSONObject running = workspace.beginAssistantTask("alice", id, taskId, 1, snapshot, request);
        JSONObject task = running.getJSONObject("assistantTask"); task.put("runtimeId", "previous-process");
        store.write("alice", AssistantWorkspaceService.NAMESPACE, running);
        JSONObject recovered = workspace.session("alice", id);
        assertEquals("INTERRUPTED", recovered.getJSONObject("assistantTask").getString("status"));
        assertTrue(recovered.getJSONObject("assistantTask").getString("error").contains("服务重启"));
        assertEquals("保留问题", recovered.getJSONArray("messages").getJSONObject(0).getString("content"));
    }

    @Test
    void rejectsHistoryLimitsWithoutReplacingTheSavedRevision() throws Exception {
        JSONObject created = workspace.createSession("alice", new JSONObject());
        String id = created.getString("id");
        JSONObject tooLong = new JSONObject(Map.of("revision", 1, "messages", new JSONArray(List.of(
                new JSONObject(Map.of("role", "user", "content", "x".repeat(100_001)))))));
        assertThrows(IllegalArgumentException.class, () -> workspace.saveSession("alice", id, tooLong));

        JSONArray tooMany = new JSONArray();
        for (int i = 0; i <= AssistantWorkspaceService.MAX_MESSAGES; i++) {
            tooMany.add(new JSONObject(Map.of("role", "user", "content", "x")));
        }
        assertThrows(IllegalArgumentException.class, () -> workspace.saveSession("alice", id,
                new JSONObject(Map.of("revision", 1, "messages", tooMany))));

        JSONObject oversized = new JSONObject(Map.of("revision", 1, "messages", new JSONArray(), "selections", "x".repeat(2 * 1024 * 1024)));
        assertThrows(IllegalArgumentException.class, () -> workspace.saveSession("alice", id, oversized));
        assertEquals(1, workspace.session("alice", id).getIntValue("revision"));
    }

    @Test
    void stagesFileWithHashExtractedContentAndNoStoragePathInResponses() throws Exception {
        byte[] source = "用户提供的研究材料".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        JSONObject attachment = workspace.upload("alice", new MockMultipartFile("file", "notes.txt", "text/plain", source));
        String id = attachment.getString("id");
        assertEquals(ResearchStore.hash(source), attachment.getString("sha256"));
        assertFalse(attachment.containsKey("content"));
        assertFalse(attachment.toJSONString().contains("assistant-sessions"));

        JSONObject full = workspace.file("alice", id);
        assertEquals("用户提供的研究材料", full.getString("content"));
        assertEquals(source.length, full.getIntValue("size"));
        assertThrows(IllegalArgumentException.class, () -> workspace.file("bob", id));

        JSONObject context = workspace.attachmentContext("alice", List.of(id));
        assertTrue(context.getString("content").contains("用户主动提交的材料"));
        assertTrue(context.getString("content").contains("用户提供的研究材料"));
        assertFalse(context.getJSONArray("attachments").getJSONObject(0).containsKey("content"));
    }

    @Test
    void localImportCopiesAndDoesNotEnumerateHiddenOrSensitiveEntries() throws Exception {
        Path localFile = temp.resolve("input.csv");
        byte[] bytes = "id,value\n1,2\n".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        Files.write(localFile, bytes);
        Path hidden = workspaceDesktop().resolve(".private.txt");
        Files.writeString(hidden, "hidden");
        Files.writeString(workspaceDesktop().resolve("visible.txt"), "visible");
        Path library = Files.createDirectory(workspaceDesktop().resolve("Library"));
        Files.writeString(library.resolve("private.txt"), "private");

        JSONObject attachment = workspace.importLocalFile("alice", localFile.toString());
        assertEquals(ResearchStore.hash(bytes), attachment.getString("sha256"));
        assertEquals("id,value\n1,2\n", workspace.file("alice", attachment.getString("id")).getString("content"));
        assertEquals("id,value\n1,2\n", Files.readString(localFile));

        JSONObject listing = workspace.localFiles(workspaceDesktop().toString());
        assertEquals(1, listing.getJSONArray("entries").size());
        assertEquals("visible.txt", listing.getJSONArray("entries").getJSONObject(0).getString("name"));
        assertFalse(listing.toJSONString().contains("assistant-sessions"));
    }

    @Test
    void contextOverflowAndUnsupportedFilesFailExplicitly() throws Exception {
        List<String> ids = new ArrayList<>();
        byte[] seventyThousand = "x".repeat(70_000).getBytes(java.nio.charset.StandardCharsets.UTF_8);
        ids.add(workspace.upload("alice", new MockMultipartFile("file", "one.txt", "text/plain", seventyThousand)).getString("id"));
        ids.add(workspace.upload("alice", new MockMultipartFile("file", "two.txt", "text/plain", seventyThousand)).getString("id"));
        IllegalArgumentException overflow = assertThrows(IllegalArgumentException.class, () -> workspace.attachmentContext("alice", ids));
        assertTrue(overflow.getMessage().contains("120000"));
        assertThrows(IllegalArgumentException.class,
                () -> workspace.upload("alice", new MockMultipartFile("file", "secret.bin", "application/octet-stream", new byte[]{1})));
    }

    private Path workspaceDesktop() {
        return temp.resolve("Desktop");
    }
}
