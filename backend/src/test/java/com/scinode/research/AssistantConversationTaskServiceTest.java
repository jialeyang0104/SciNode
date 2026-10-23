package com.scinode.research;

import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONArray;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AssistantConversationTaskServiceTest {
    @TempDir Path temp;
    private AssistantWorkspaceService workspace;
    private ResearchAssistantService assistant;
    private AssistantConversationTaskService tasks;

    @BeforeEach
    void setUp() throws Exception {
        ResearchStore store = new ResearchStore(temp.resolve("data").toString());
        workspace = new AssistantWorkspaceService(store, new ResearchToolExecutor("python3", "Rscript", "python3"), Files.createDirectory(temp.resolve("Desktop")));
        assistant = mock(ResearchAssistantService.class);
        tasks = new AssistantConversationTaskService(assistant, workspace);
    }

    @AfterEach
    void tearDown() { tasks.shutdown(); }

    @Test
    void taskFinishesAfterStartReturnsAndDifferentSessionsRemainIndependent() throws Exception {
        JSONObject first = workspace.createSession("alice", new JSONObject());
        JSONObject second = workspace.createSession("alice", new JSONObject());
        CountDownLatch modelStarted = new CountDownLatch(2), release = new CountDownLatch(1);
        when(assistant.status(eq("alice"), any())).thenReturn(new JSONObject(Map.of("phase", "GENERATING")));
        when(assistant.chat(eq("alice"), any())).thenAnswer(invocation -> {
            modelStarted.countDown();
            assertTrue(release.await(5, TimeUnit.SECONDS));
            return new JSONObject(Map.of("reply", "后台验收完成", "model", "fake-model"));
        });

        JSONObject firstStarted = tasks.start("alice", first.getString("id"), startBody(first, UUID.randomUUID().toString(), "第一个问题"));
        JSONObject secondStarted = tasks.start("alice", second.getString("id"), startBody(second, UUID.randomUUID().toString(), "第二个问题"));
        assertEquals("RUNNING", firstStarted.getJSONObject("task").getString("status"));
        assertEquals("RUNNING", secondStarted.getJSONObject("task").getString("status"));
        assertTrue(modelStarted.await(3, TimeUnit.SECONDS));

        IllegalStateException duplicate = assertThrows(IllegalStateException.class,
                () -> tasks.start("alice", first.getString("id"), startBody(first, UUID.randomUUID().toString(), "重复问题")));
        assertTrue(duplicate.getMessage().contains("处理中"));

        release.countDown();
        awaitStatus(first.getString("id"), "COMPLETED");
        awaitStatus(second.getString("id"), "COMPLETED");
        assertEquals(2, workspace.session("alice", first.getString("id")).getJSONArray("messages").size());
        assertEquals("第一个问题", workspace.session("alice", first.getString("id")).getJSONArray("messages").getJSONObject(0).getString("content"));
        assertEquals("第二个问题", workspace.session("alice", second.getString("id")).getJSONArray("messages").getJSONObject(0).getString("content"));
        verify(assistant, times(2)).chat(eq("alice"), any());
    }

    @Test
    void taskStartNormalizesHttpNestedMapsAndListsBeforeSessionValidation() throws Exception {
        JSONObject session = workspace.createSession("alice", new JSONObject());
        JSONObject existing = new JSONObject();
        existing.put("revision", session.getIntValue("revision"));
        existing.put("messages", new JSONArray());
        existing.put("reasoningEffort", "high");
        session = workspace.saveSession("alice", session.getString("id"), existing);
        Map<String, Object> message = new LinkedHashMap<>();
        message.put("role", "user");
        message.put("content", "HTTP形状的合成问题");
        Map<String, Object> snapshot = new LinkedHashMap<>();
        snapshot.put("id", session.getString("id"));
        snapshot.put("revision", session.getIntValue("revision"));
        snapshot.put("title", "HTTP形状测试");
        snapshot.put("messages", List.of(message));
        snapshot.put("attachments", List.of());
        snapshot.put("selections", Map.of("skills", List.of(), "mcpResultIds", List.of()));
        snapshot.put("questionAnswers", Map.of("scope", Map.of("choice", "合成范围")));
        snapshot.put("draft", Map.of("name", "HTTP形状草案", "nodes", List.of(Map.of("id", "node-1"))));
        snapshot.put("toolResults", List.of(Map.of("toolName", "synthetic-tool", "result", Map.of("ok", true))));
        snapshot.put("input", "HTTP形状的合成问题");
        snapshot.put("reasoningEffort", null);
        Map<String, Object> request = Map.of(
                "configId", 1,
                "messages", List.of(message),
                "attachments", List.of(),
                "selections", Map.of("skills", List.of(), "mcpResultIds", List.of()));
        JSONObject body = new JSONObject();
        body.put("taskId", UUID.randomUUID().toString());
        body.put("revision", session.getIntValue("revision"));
        body.put("snapshot", snapshot);
        body.put("request", request);
        CountDownLatch modelStarted = new CountDownLatch(1), releaseModel = new CountDownLatch(1);
        AtomicReference<JSONObject> receivedRequest = new AtomicReference<>();
        when(assistant.chat(eq("alice"), any())).thenAnswer(invocation -> {
            receivedRequest.set(invocation.getArgument(1));
            modelStarted.countDown();
            assertTrue(releaseModel.await(5, TimeUnit.SECONDS));
            return new JSONObject(Map.of("reply", "归一化成功", "model", "fake-model"));
        });

        JSONObject started = tasks.start("alice", session.getString("id"), body);
        assertEquals("RUNNING", started.getJSONObject("task").getString("status"));
        assertTrue(modelStarted.await(3, TimeUnit.SECONDS));
        JSONObject running = workspace.session("alice", session.getString("id"));
        assertEquals("合成范围", running.getJSONObject("questionAnswers").getJSONObject("scope").getString("choice"));
        assertEquals("node-1", running.getJSONObject("draft").getJSONArray("nodes").getJSONObject(0).getString("id"));
        assertTrue(running.getJSONArray("toolResults").getJSONObject(0).getJSONObject("result").getBooleanValue("ok"));
        releaseModel.countDown();
        awaitStatus(session.getString("id"), "COMPLETED");

        JSONObject completed = workspace.session("alice", session.getString("id"));
        assertEquals("HTTP形状测试", completed.getString("title"));
        assertEquals("HTTP形状的合成问题", completed.getJSONArray("messages").getJSONObject(0).getString("content"));
        assertTrue(completed.getJSONArray("attachments").isEmpty());
        assertEquals("node-1", completed.getJSONObject("draft").getJSONArray("nodes").getJSONObject(0).getString("id"));
        assertTrue(completed.getJSONArray("toolResults").getJSONObject(0).getJSONObject("result").getBooleanValue("ok"));
        assertFalse(completed.containsKey("reasoningEffort"), "explicit null must clear the prior reasoning level");
        assertInstanceOf(com.alibaba.fastjson2.JSONArray.class, receivedRequest.get().get("messages"));
        assertInstanceOf(com.alibaba.fastjson2.JSONArray.class, receivedRequest.get().get("attachments"));
        assertInstanceOf(com.alibaba.fastjson2.JSONArray.class, receivedRequest.get().getJSONObject("selections").get("skills"));
        verify(assistant).chat(eq("alice"), any());
    }

    @Test
    void failedTaskCanRetryAndCancelBlocksLateReply() throws Exception {
        JSONObject session = workspace.createSession("alice", new JSONObject());
        when(assistant.status(eq("alice"), any())).thenReturn(new JSONObject(Map.of("phase", "GENERATING")));
        when(assistant.chat(eq("alice"), any())).thenThrow(new IllegalStateException("模型暂不可用"))
                .thenAnswer(invocation -> new JSONObject(Map.of("reply", "重试成功", "model", "fake-model")));
        JSONObject started = tasks.start("alice", session.getString("id"), startBody(session, UUID.randomUUID().toString(), "失败后重试"));
        awaitStatus(session.getString("id"), "FAILED");
        JSONObject failed = workspace.session("alice", session.getString("id"));
        assertEquals("模型暂不可用", failed.getJSONObject("assistantTask").getString("error"));
        JSONObject retried = tasks.retry("alice", session.getString("id"), new JSONObject(Map.of("taskId", UUID.randomUUID().toString())));
        assertEquals("RUNNING", retried.getJSONObject("task").getString("status"));
        awaitStatus(session.getString("id"), "COMPLETED");
        assertEquals(2, workspace.session("alice", session.getString("id")).getJSONArray("messages").size());

        JSONObject other = workspace.createSession("alice", new JSONObject());
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        when(assistant.chat(eq("alice"), argThat(request -> "待取消".equals(request.getJSONArray("messages").getJSONObject(0).getString("content"))))).thenAnswer(invocation -> {
            entered.countDown(); release.await(5, TimeUnit.SECONDS);
            return new JSONObject(Map.of("reply", "迟到回复"));
        });
        when(assistant.cancel(eq("alice"), any())).thenReturn(new JSONObject(Map.of("status", "CANCELED")));
        tasks.start("alice", other.getString("id"), startBody(other, UUID.randomUUID().toString(), "待取消"));
        assertTrue(entered.await(3, TimeUnit.SECONDS));
        JSONObject canceled = tasks.cancel("alice", other.getString("id"));
        assertEquals("CANCELED", canceled.getJSONObject("task").getString("status"));
        release.countDown();
        Thread.sleep(150);
        JSONObject finalSession = workspace.session("alice", other.getString("id"));
        assertEquals("CANCELED", finalSession.getJSONObject("assistantTask").getString("status"));
        assertEquals(1, finalSession.getJSONArray("messages").size());
    }

    @Test
    void lateCanceledTaskCleanupDoesNotClearImmediatelyRetriedTaskActivity() throws Exception {
        JSONObject session = workspace.createSession("alice", new JSONObject());
        JSONObject queuedSession = workspace.createSession("alice", new JSONObject());
        String oldTaskId = UUID.randomUUID().toString();
        String retryTaskId = UUID.randomUUID().toString();
        String queuedTaskId = UUID.randomUUID().toString();
        CountDownLatch oldStarted = new CountDownLatch(1), releaseOld = new CountDownLatch(1);
        CountDownLatch retryStarted = new CountDownLatch(1), queuedStarted = new CountDownLatch(1);
        CountDownLatch releaseRetryAndQueued = new CountDownLatch(1);
        when(assistant.status(eq("alice"), any())).thenReturn(new JSONObject(Map.of("phase", "GENERATING")));
        when(assistant.cancel(eq("alice"), any())).thenReturn(new JSONObject(Map.of("status", "CANCELED")));
        when(assistant.chat(eq("alice"), any())).thenAnswer(invocation -> {
            JSONObject request = invocation.getArgument(1);
            String requestId = request.getString("requestId");
            if (oldTaskId.equals(requestId)) {
                oldStarted.countDown();
                assertTrue(releaseOld.await(5, TimeUnit.SECONDS));
                throw new java.util.concurrent.CancellationException("canceled after retry started");
            }
            if (retryTaskId.equals(requestId)) {
                retryStarted.countDown();
                assertTrue(releaseRetryAndQueued.await(5, TimeUnit.SECONDS));
                return new JSONObject(Map.of("reply", "重试完成", "model", "fake-model"));
            }
            assertEquals(queuedTaskId, requestId);
            queuedStarted.countDown();
            assertTrue(releaseRetryAndQueued.await(5, TimeUnit.SECONDS));
            return new JSONObject(Map.of("reply", "排队任务完成", "model", "fake-model"));
        });

        JSONObject started = tasks.start("alice", session.getString("id"), startBody(session, oldTaskId, "原始问题"));
        assertEquals("RUNNING", started.getJSONObject("task").getString("status"));
        assertTrue(oldStarted.await(3, TimeUnit.SECONDS));
        JSONObject canceled = tasks.cancel("alice", session.getString("id"));
        assertEquals("CANCELED", canceled.getJSONObject("task").getString("status"));

        JSONObject retried = tasks.retry("alice", session.getString("id"), new JSONObject(Map.of("taskId", retryTaskId)));
        assertEquals("RUNNING", retried.getJSONObject("task").getString("status"));
        assertTrue(retryStarted.await(3, TimeUnit.SECONDS));
        JSONObject queued = tasks.start("alice", queuedSession.getString("id"), startBody(queuedSession, queuedTaskId, "排队问题"));
        assertEquals("RUNNING", queued.getJSONObject("task").getString("status"));

        releaseOld.countDown();
        assertTrue(queuedStarted.await(3, TimeUnit.SECONDS), "the queued task starts only after the canceled worker has completed cleanup");
        JSONObject retryStatus = tasks.status("alice", session.getString("id"));
        assertEquals("RUNNING", retryStatus.getJSONObject("task").getString("status"));
        verify(assistant).status("alice", UUID.fromString(retryTaskId));

        releaseRetryAndQueued.countDown();
        awaitStatus(session.getString("id"), "COMPLETED");
        awaitStatus(queuedSession.getString("id"), "COMPLETED");
    }

    private JSONObject startBody(JSONObject session, String taskId, String text) {
        JSONObject snapshot = new JSONObject();
        snapshot.put("id", session.getString("id")); snapshot.put("revision", session.getIntValue("revision"));
        snapshot.put("title", text); snapshot.put("messages", new JSONArray(List.of(new JSONObject(Map.of("role", "user", "content", text)))));
        snapshot.put("input", text);
        JSONObject request = new JSONObject(Map.of("configId", 1, "messages", new JSONArray(List.of(new JSONObject(Map.of("role", "user", "content", text))))));
        return new JSONObject(Map.of("taskId", taskId, "revision", session.getIntValue("revision"), "snapshot", snapshot, "request", request));
    }

    private void awaitStatus(String sessionId, String status) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(4);
        while (System.nanoTime() < deadline) {
            JSONObject current = workspace.session("alice", sessionId);
            JSONObject task = current.getJSONObject("assistantTask");
            if (task != null && status.equals(task.getString("status"))) return;
            Thread.sleep(20);
        }
        fail("Task did not reach " + status);
    }
}
