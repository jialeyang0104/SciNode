package com.scinode.research;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Owns durable, session-scoped assistant jobs independently of the browser request lifetime. */
@Service
public class AssistantConversationTaskService {
    private final ResearchAssistantService assistant;
    private final AssistantWorkspaceService workspace;
    private final ThreadPoolExecutor executor = new ThreadPoolExecutor(2, 2, 0, TimeUnit.MILLISECONDS,
            new ArrayBlockingQueue<>(8), task -> {
                Thread thread = new Thread(task, "scinode-assistant-session");
                thread.setDaemon(true);
                return thread;
            }, new ThreadPoolExecutor.AbortPolicy());
    private final Map<Key, String> active = new java.util.HashMap<>();

    public AssistantConversationTaskService(ResearchAssistantService assistant, AssistantWorkspaceService workspace) {
        this.assistant = assistant;
        this.workspace = workspace;
    }

    public synchronized List<JSONObject> sessions(String user, String projectId, boolean archived) throws IOException {
        List<JSONObject> result = workspace.sessions(user, projectId, archived);
        // Reading a list is also the recovery boundary for jobs left RUNNING by a previous process.
        for (JSONObject summary : result) {
            JSONObject session = workspace.session(user, summary.getString("id"));
            JSONObject task = session.getJSONObject("assistantTask");
            if (task != null) {
                summary.put("taskStatus", task.getString("status"));
                summary.put("taskPhase", task.getString("phase"));
                summary.put("taskError", task.getString("error"));
            }
        }
        return result;
    }

    public synchronized JSONObject session(String user, String id) throws IOException {
        JSONObject session = workspace.session(user, id);
        refreshPhase(user, id, session);
        return session;
    }

    public synchronized JSONObject start(String user, String sessionId, JSONObject body) throws IOException {
        if (body == null) throw new IllegalArgumentException("缺少后台助手任务内容");
        String taskId = uuid(body.getString("taskId"));
        JSONObject request = body.getJSONObject("request");
        JSONObject snapshot = body.getJSONObject("snapshot");
        Integer revision = body.getInteger("revision");
        JSONObject current = workspace.session(user, sessionId);
        JSONObject existing = current.getJSONObject("assistantTask");
        if (existing != null && taskId.equals(existing.getString("id")) && "RUNNING".equals(existing.getString("status"))) {
            return taskView(user, sessionId, current);
        }
        workspace.beginAssistantTask(user, sessionId, taskId, revision, snapshot, request);
        Key key = new Key(user, uuid(sessionId));
        active.put(key, taskId);
        try {
            executor.execute(() -> execute(user, sessionId, taskId, request));
        } catch (RuntimeException rejected) {
            active.remove(key, taskId);
            workspace.failAssistantTask(user, sessionId, taskId, "助手后台任务暂时繁忙，请重试。");
            throw new IllegalStateException("助手后台任务暂时繁忙，请重试");
        }
        return taskView(user, sessionId, workspace.session(user, sessionId));
    }

    public synchronized JSONObject retry(String user, String sessionId, JSONObject body) throws IOException {
        JSONObject current = workspace.session(user, sessionId);
        JSONObject previous = current.getJSONObject("assistantTask");
        if (previous == null || !List.of("FAILED", "CANCELED", "INTERRUPTED").contains(previous.getString("status"))) {
            throw new IllegalStateException("当前对话没有可重试的失败或中断请求");
        }
        JSONObject request = previous.getJSONObject("request");
        if (request == null) throw new IllegalStateException("原请求信息缺失，请重新发送问题");
        String taskId = body == null ? UUID.randomUUID().toString() : body.getString("taskId");
        if (taskId == null || taskId.isBlank()) taskId = UUID.randomUUID().toString();
        taskId = uuid(taskId);
        workspace.beginAssistantTask(user, sessionId, taskId, current.getIntValue("revision"), current, request);
        Key key = new Key(user, uuid(sessionId));
        active.put(key, taskId);
        String retryId = taskId;
        try {
            executor.execute(() -> execute(user, sessionId, retryId, request));
        } catch (RuntimeException rejected) {
            active.remove(key, retryId);
            workspace.failAssistantTask(user, sessionId, taskId, "助手后台任务暂时繁忙，请重试。");
            throw new IllegalStateException("助手后台任务暂时繁忙，请重试");
        }
        return taskView(user, sessionId, workspace.session(user, sessionId));
    }

    public synchronized JSONObject status(String user, String sessionId) throws IOException {
        JSONObject session = workspace.session(user, sessionId);
        refreshPhase(user, sessionId, session);
        return taskView(user, sessionId, session);
    }

    public synchronized JSONObject cancel(String user, String sessionId) throws IOException {
        JSONObject session = workspace.session(user, sessionId);
        JSONObject task = session.getJSONObject("assistantTask");
        if (task == null || !"RUNNING".equals(task.getString("status"))) return taskView(user, sessionId, session);
        UUID requestId = UUID.fromString(task.getString("requestId"));
        JSONObject cancellation = assistant.cancel(user, requestId);
        if ("CANCELED".equals(cancellation.getString("status"))) {
            workspace.cancelAssistantTask(user, sessionId, task.getString("id"));
            active.remove(new Key(user, uuid(sessionId)), task.getString("id"));
        }
        return taskView(user, sessionId, workspace.session(user, sessionId));
    }

    public synchronized JSONObject delete(String user, String sessionId) throws IOException {
        String validSessionId = uuid(sessionId);
        JSONObject session = workspace.session(user, validSessionId);
        JSONObject task = session.getJSONObject("assistantTask");
        if (task != null && "RUNNING".equals(task.getString("status"))) {
            assistant.cancel(user, UUID.fromString(task.getString("requestId")));
        }
        if (task != null) active.remove(new Key(user, validSessionId), task.getString("id"));
        return workspace.deleteSession(user, validSessionId);
    }

    private void execute(String user, String sessionId, String taskId, JSONObject originalRequest) {
        Key key = new Key(user, uuid(sessionId));
        try {
            JSONObject request = JSON.parseObject(originalRequest.toJSONString());
            request.put("requestId", taskId);
            JSONObject result = assistant.chat(user, request);
            synchronized (this) {
                workspace.finishAssistantTask(user, sessionId, taskId, result);
            }
        } catch (java.util.concurrent.CancellationException canceled) {
            try { synchronized (this) { workspace.cancelAssistantTask(user, sessionId, taskId); } }
            catch (IOException ignored) { /* Session deletion is the only expected reason. */ }
        } catch (Exception error) {
            try {
                String detail = error.getMessage() == null ? "助手请求失败，请重试。" : error.getMessage();
                synchronized (this) { workspace.failAssistantTask(user, sessionId, taskId, detail); }
            } catch (Exception ignored) { /* A deleted session must stay deleted. */ }
        } finally {
            synchronized (this) { active.remove(key, taskId); }
        }
    }

    private void refreshPhase(String user, String sessionId, JSONObject session) throws IOException {
        JSONObject task = session.getJSONObject("assistantTask");
        if (task == null || !"RUNNING".equals(task.getString("status"))) return;
        if (!Objects.equals(active.get(new Key(user, uuid(sessionId))), task.getString("id"))) {
            // workspace.session already changes a task from another runtime to INTERRUPTED.
            JSONObject recovered = workspace.session(user, sessionId);
            session.clear();
            session.putAll(recovered);
            return;
        }
        String phase = assistant.status(user, UUID.fromString(task.getString("requestId"))).getString("phase");
        if (phase != null && !"NOT_FOUND".equals(phase)) {
            JSONObject updated = workspace.setAssistantTaskPhase(user, sessionId, task.getString("id"), phase);
            if (updated != null) {
                session.clear();
                session.putAll(updated);
            }
        }
    }

    private JSONObject taskView(String user, String sessionId, JSONObject session) throws IOException {
        JSONObject result = new JSONObject();
        JSONObject task = session.getJSONObject("assistantTask");
        if (task == null) task = new JSONObject(Map.of("status", "IDLE", "phase", "NOT_FOUND"));
        else {
            task = JSON.parseObject(task.toJSONString());
            task.remove("request");
            task.remove("runtimeId");
        }
        result.put("task", task);
        result.put("session", session);
        return result;
    }

    @PreDestroy
    void shutdown() { executor.shutdownNow(); }

    private static String uuid(String value) {
        try { return UUID.fromString(value).toString(); }
        catch (RuntimeException error) { throw new IllegalArgumentException("ID 应为 UUID"); }
    }

    private record Key(String user, String sessionId) { }
}
