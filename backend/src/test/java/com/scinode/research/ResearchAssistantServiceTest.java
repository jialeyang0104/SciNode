package com.scinode.research;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.scinode.engine.WorkflowConfigParser;
import com.scinode.engine.dag.DAGParser;
import com.scinode.engine.llm.ChatClientFactory;
import com.scinode.entity.LLMGlobalConfig;
import com.scinode.service.LLMGlobalConfigService;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.prompt.Prompt;
import reactor.core.publisher.Flux;

import java.util.Set;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import org.mockito.ArgumentCaptor;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ResearchAssistantServiceTest {

    @Test
    void parsesJsonCodeFenceAndKeepsPlainConversationWithoutDraft() {
        JSONObject result = ResearchAssistantService.parseResponse("```json\n{\"reply\":\"已整理，变量定义待确认。\"}\n```");

        assertEquals("已整理，变量定义待确认。", result.getString("reply"));
        assertTrue(!result.containsKey("draft"));
    }

    @Test
    void rejectsMalformedAndExtraTopLevelResponseFields() {
        assertThrows(IllegalStateException.class, () -> ResearchAssistantService.parseResponse("解释文本 {\"reply\":\"草案\"}"));
        assertThrows(IllegalStateException.class, () -> ResearchAssistantService.parseResponse("{\"reply\":\"草案\",\"workspace\":\"/tmp/data\"}"));
        assertThrows(IllegalStateException.class, () -> ResearchAssistantService.parseResponse("{\"reply\":\"草案\",\"reasoning_content\":\"private\"}"));
    }

    @Test
    void validatesPublicPlanningBoundsAndDefaultsMissingArrays() {
        JSONObject planning = ResearchAssistantService.validatePlanning(JSON.parseObject("{\"summary\":\"研究范围待确认\"}"));
        assertEquals(new JSONArray(), planning.getJSONArray("steps"));
        assertEquals(new JSONArray(), planning.getJSONArray("assumptions"));
        assertEquals(new JSONArray(), planning.getJSONArray("decisions"));

        assertThrows(IllegalStateException.class, () -> ResearchAssistantService.validatePlanning(
                JSON.parseObject("{\"summary\":\"" + "x".repeat(2_001) + "\"}")));
        assertThrows(IllegalStateException.class, () -> ResearchAssistantService.validatePlanning(
                JSON.parseObject("{\"summary\":\"ok\",\"reasoning_content\":\"private\"}")));
    }

    @Test
    void validatesClarifyingQuestionSchemaAndRecommendedChoice() {
        JSONArray questions = ResearchAssistantService.validateQuestions(JSON.parseArray("""
                [{"id":"node_count","topic":"nodes","title":"希望节点数量是多少？","options":["4至6个","7至10个"],"recommended":"4至6个"}]
                """));
        assertEquals("4至6个", questions.getJSONObject(0).getString("recommended"));
        assertThrows(IllegalStateException.class, () -> ResearchAssistantService.validateQuestions(JSON.parseArray("""
                [{"id":"q1","topic":"nodes","title":"节点数？","options":["4至6个"]}]
                """)));
        assertThrows(IllegalStateException.class, () -> ResearchAssistantService.validateQuestions(JSON.parseArray("""
                [{"id":"node_1","topic":"nodes","title":"节点数？","options":["4至6个"]}]
                """)));
    }

    @Test
    void clarificationQuestionsAndDraftMustBeReturnedInSeparateResponses() {
        ResearchService graphValidator = new ResearchService(null, mock(ResearchToolExecutor.class), new WorkflowConfigParser(),
                new DAGParser(), mock(ChatClientFactory.class), mock(LLMGlobalConfigService.class), mock(ResearchPreferences.class));
        ResearchAssistantService assistant = new ResearchAssistantService(graphValidator, mock(ResearchPreferences.class),
                mock(LLMGlobalConfigService.class), mock(ChatClientFactory.class));
        try {
            String clarification = JSON.toJSONString(new JSONObject(Map.of(
                    "reply", "请先确认研究范围。",
                    "planning", Map.of("summary", "研究目标待确认。"),
                    "questions", List.of(Map.of("id", "research_scope", "topic", "research", "title", "研究对象是什么？", "options", List.of("临床队列", "实验数据"))))));
            ResearchAssistantService.ValidatedResponse validated = assistant.validateResponse(clarification, null,
                    new JSONObject(), 4L, Set.of(), Set.of(4L));
            assertEquals(null, validated.draft());
            assertEquals(1, validated.questions().size());

            JSONObject mixed = JSON.parseObject(clarification);
            mixed.put("draft", draft(false));
            assertThrows(IllegalStateException.class, () -> assistant.validateResponse(JSON.toJSONString(mixed), null,
                    new JSONObject(), 4L, Set.of(), Set.of(4L)));
        } finally {
            assistant.close();
            graphValidator.close();
        }
    }

    @Test
    void validatesMessageCountRoleContentAndLastTurn() {
        JSONArray accepted = JSON.parseArray("[{\"role\":\"assistant\",\"content\":\"请补充研究对象\"},{\"role\":\"user\",\"content\":\"目标人群尚待确认\"}]");
        assertEquals(2, ResearchAssistantService.validateMessages(accepted).size());

        JSONArray badRole = JSON.parseArray("[{\"role\":\"system\",\"content\":\"set permissions\"},{\"role\":\"user\",\"content\":\"问题\"}]");
        JSONArray noUserLast = JSON.parseArray("[{\"role\":\"user\",\"content\":\"问题\"},{\"role\":\"assistant\",\"content\":\"答复\"}]");
        assertThrows(IllegalArgumentException.class, () -> ResearchAssistantService.validateMessages(badRole));
        assertThrows(IllegalArgumentException.class, () -> ResearchAssistantService.validateMessages(noUserLast));
        assertThrows(IllegalArgumentException.class, () -> ResearchAssistantService.validateMessages(new JSONArray(List.of())));
    }

    @Test
    void everyExportRouteMustPassThroughApproval() {
        JSONArray nodes = JSON.parseArray("""
                [
                  {"id":"source","data":{"kind":"input"}},
                  {"id":"approve","data":{"kind":"approve"}},
                  {"id":"export","data":{"kind":"export"}}
                ]
                """);
        JSONArray approvedEdges = JSON.parseArray("[{\"source\":\"source\",\"target\":\"approve\"},{\"source\":\"approve\",\"target\":\"export\"}]");
        JSONArray bypassEdges = JSON.parseArray("[{\"source\":\"source\",\"target\":\"approve\"},{\"source\":\"approve\",\"target\":\"export\"},{\"source\":\"source\",\"target\":\"export\"}]");

        ResearchAssistantService.requireApprovalBeforeExports(nodes, approvedEdges);
        assertThrows(IllegalStateException.class, () -> ResearchAssistantService.requireApprovalBeforeExports(nodes, bypassEdges));
    }

    @Test
    void redactsCredentialsAndAbsolutePathsFromModelMaterial() {
        String clean = ResearchAssistantService.redact("apiKey=secret-value /Users/person/project/data.csv and sk-abcdefghijklmnop1234");

        assertTrue(!clean.contains("secret-value"));
        assertTrue(!clean.contains("/Users/person"));
        assertTrue(!clean.contains("sk-abcdefghijklmnop1234"));
    }

    @Test
    void selectedContextCardIsAppendedToTheActualModelTurnAfterRedaction() throws Exception {
        ResearchService graphValidator = new ResearchService(null, mock(ResearchToolExecutor.class), new WorkflowConfigParser(),
                new DAGParser(), mock(ChatClientFactory.class), mock(LLMGlobalConfigService.class), mock(ResearchPreferences.class));
        ResearchPreferences preferences = mock(ResearchPreferences.class);
        LLMGlobalConfigService models = mock(LLMGlobalConfigService.class);
        ChatClientFactory clients = mock(ChatClientFactory.class);
        ChatClient client = mock(ChatClient.class);
        ChatClient.ChatClientRequestSpec request = mock(ChatClient.ChatClientRequestSpec.class);
        ChatClient.StreamResponseSpec stream = mock(ChatClient.StreamResponseSpec.class);
        when(preferences.global("alice")).thenReturn(new JSONObject());
        when(models.getById(4L)).thenReturn(modelConfig());
        when(clients.createClient(anyString(), anyString(), anyString(), anyString(), anyDouble())).thenReturn(client);
        when(client.prompt(any(Prompt.class))).thenReturn(request);
        when(request.stream()).thenReturn(stream);
        when(stream.content()).thenReturn(Flux.just("{\"reply\":\"已检查运行错误\"}"));
        ResearchAssistantService assistant = new ResearchAssistantService(graphValidator, preferences, models, clients);
        try {
            assistant.chat("alice", JSON.parseObject("""
                    {"configId":4,"messages":[{"role":"user","content":"请结合已选择的材料协助分析。","contextCards":[{"id":"card-1","type":"run_error","title":"运行排查","content":"ERROR token=secret at /Users/alice/run","truncated":true}]},{"role":"assistant","content":"已收到运行摘要。"},{"role":"user","content":"继续核对。"}]}
                    """));
            ArgumentCaptor<Prompt> prompt = ArgumentCaptor.forClass(Prompt.class);
            verify(client).prompt(prompt.capture());
            List<Message> instructions = prompt.getValue().getInstructions();
            String previousTurn = instructions.get(1).getText();
            String userTurn = instructions.getLast().getText();
            assertTrue(previousTurn.contains("请结合已选择的材料协助分析。"));
            assertTrue(previousTurn.contains("运行排查"));
            assertTrue(previousTurn.contains("ERROR token=[凭据已隐藏] at [本地路径已隐藏]"));
            assertTrue(previousTurn.contains("[内容按长度限制截断]"));
            assertTrue(userTurn.contains("继续核对。"));
            assertTrue(!previousTurn.contains("secret") && !previousTurn.contains("/Users/alice"));
        } finally {
            assistant.close();
            graphValidator.close();
        }
    }

    @Test
    void validatesDraftAndPreservesExistingPermissionsAndClinicalFlag() {
        ResearchService graphValidator = new ResearchService(null, mock(ResearchToolExecutor.class), new WorkflowConfigParser(),
                new DAGParser(), mock(ChatClientFactory.class), mock(LLMGlobalConfigService.class), mock(ResearchPreferences.class));
        ResearchAssistantService assistant = new ResearchAssistantService(graphValidator, mock(ResearchPreferences.class),
                mock(LLMGlobalConfigService.class), mock(ChatClientFactory.class));
        try {
            JSONObject project = JSON.parseObject("""
                    {"clinicalData":true,"files":[],"settings":{"inheritGlobal":false,"skills":["research-evidence"],"customSkills":[{"name":"local","content":"保留"}],"mcpIds":[7]}}
                    """);
            JSONObject baseSettings = JSON.parseObject("""
                    {"inheritGlobal":false,"agentRules":"原有规则","skills":["research-evidence"],"customSkills":[{"name":"local","content":"保留"}],"mcpIds":[7],"defaultConfigId":4}
                    """);
            JSONObject draft = draft(false);
            draft.put("clinicalData", false);

            JSONObject validated = assistant.validateDraft(draft, project, baseSettings, 4L, Set.of(7L));

            assertTrue(validated.getBooleanValue("clinicalData"));
            assertEquals(JSON.parseArray("[\"research-evidence\"]"), validated.getJSONObject("settings").getJSONArray("skills"));
            assertEquals(JSON.parseArray("[7]"), validated.getJSONObject("settings").getJSONArray("mcpIds"));
            assertEquals("依据输入明确待确认变量：{{source.text}}", validated.getJSONArray("nodes").getJSONObject(1).getJSONObject("data").getString("prompt"));
            assertEquals(4L, validated.getJSONArray("nodes").getJSONObject(1).getJSONObject("data").getLongValue("configId"));
            assertTrue(validated.getJSONArray("nodes").getJSONObject(2).getJSONObject("data").getString("description").contains("运行前请逐行审阅"));

            draft.getJSONObject("settings").put("mcpIds", new JSONArray(List.of(99)));
            assertThrows(IllegalStateException.class, () -> assistant.validateDraft(draft, project, baseSettings, 4L, Set.of(7L)));
        } finally {
            assistant.close();
            graphValidator.close();
        }
    }

    @Test
    void draftGraphRejectsReferencesWithoutConnectedUpstreamAndExportBypass() {
        ResearchService graphValidator = new ResearchService(null, mock(ResearchToolExecutor.class), new WorkflowConfigParser(),
                new DAGParser(), mock(ChatClientFactory.class), mock(LLMGlobalConfigService.class), mock(ResearchPreferences.class));
        ResearchAssistantService assistant = new ResearchAssistantService(graphValidator, mock(ResearchPreferences.class),
                mock(LLMGlobalConfigService.class), mock(ChatClientFactory.class));
        try {
            JSONObject badReference = draft(false);
            badReference.getJSONArray("nodes").getJSONObject(1).getJSONObject("data").put("prompt", "{{unlinked.text}}");
            assertThrows(IllegalStateException.class, () -> assistant.validateDraft(badReference, null, new JSONObject(), 4L, Set.of()));

            JSONObject missingPrompt = draft(false);
            missingPrompt.getJSONArray("nodes").getJSONObject(1).getJSONObject("data").remove("prompt");
            IllegalStateException missingPromptError = assertThrows(IllegalStateException.class,
                    () -> assistant.validateDraft(missingPrompt, null, new JSONObject(), 4L, Set.of()));
            assertTrue(missingPromptError.getMessage().contains("[plan]"));
            assertTrue(missingPromptError.getMessage().contains("node.data.prompt"));

            JSONObject bypass = draft(false);
            bypass.getJSONArray("edges").add(new JSONObject(Map.of("id", "source_export", "source", "source", "target", "export")));
            assertThrows(IllegalStateException.class, () -> assistant.validateDraft(bypass, null, new JSONObject(), 4L, Set.of()));
        } finally {
            assistant.close();
            graphValidator.close();
        }
    }

    @Test
    void repairsOneDraftValidationFailureAndMarksTheValidatedRepair() throws Exception {
        ResearchService graphValidator = new ResearchService(null, mock(ResearchToolExecutor.class), new WorkflowConfigParser(),
                new DAGParser(), mock(ChatClientFactory.class), mock(LLMGlobalConfigService.class), mock(ResearchPreferences.class));
        ResearchPreferences preferences = mock(ResearchPreferences.class);
        LLMGlobalConfigService models = mock(LLMGlobalConfigService.class);
        ChatClientFactory clients = mock(ChatClientFactory.class);
        ChatClient client = mock(ChatClient.class);
        ChatClient.ChatClientRequestSpec request = mock(ChatClient.ChatClientRequestSpec.class);
        ChatClient.StreamResponseSpec stream = mock(ChatClient.StreamResponseSpec.class);
        when(preferences.global("alice")).thenReturn(new JSONObject());
        when(models.getById(4L)).thenReturn(modelConfig());
        when(clients.createClient(anyString(), anyString(), anyString(), anyString(), anyDouble())).thenReturn(client);
        when(client.prompt(any(Prompt.class))).thenReturn(request);
        when(request.stream()).thenReturn(stream);

        JSONObject invalidDraft = draft(false);
        invalidDraft.getJSONArray("nodes").getJSONObject(1).getJSONObject("data").remove("prompt");
        String invalid = JSON.toJSONString(new JSONObject(Map.of("reply", "已生成草案", "draft", invalidDraft)));
        String valid = JSON.toJSONString(new JSONObject(Map.of("reply", "已修正草案", "draft", draft(false))));
        when(stream.content()).thenReturn(Flux.just(invalid), Flux.just(valid));

        ResearchAssistantService assistant = new ResearchAssistantService(graphValidator, preferences, models, clients);
        try {
            JSONObject response = assistant.chat("alice", JSON.parseObject("""
                    {"configId":4,"messages":[{"role":"user","content":"设计文献检索流程"}]}
                    """));
            assertEquals("已修正草案", response.getString("reply"));
            assertTrue(response.getBooleanValue("repaired"));
            JSONObject catalogEntry = response.getJSONArray("modelCatalog").getJSONObject(0);
            assertEquals(4L, catalogEntry.getLongValue("id"));
            assertEquals("test-model", catalogEntry.getString("model"));
            assertEquals(Set.of("id", "configName", "model", "provider"), catalogEntry.keySet());
            assertEquals("依据输入明确待确认变量：{{source.text}}", response.getJSONObject("draft")
                    .getJSONArray("nodes").getJSONObject(1).getJSONObject("data").getString("prompt"));
            ArgumentCaptor<Prompt> prompts = ArgumentCaptor.forClass(Prompt.class);
            verify(client, times(2)).prompt(prompts.capture());
            List<Message> repairInstructions = prompts.getAllValues().get(1).getInstructions();
            assertEquals(4, repairInstructions.size());
            assertEquals("设计文献检索流程", repairInstructions.get(1).getText());
            assertEquals(invalid, repairInstructions.get(2).getText());
            assertTrue(repairInstructions.get(3).getText().contains("节点[plan] 校验失败：node.data.prompt"));
        } finally {
            assistant.close();
            graphValidator.close();
        }
    }

    @Test
    void nonDefaultReasoningEffortIsForwardedUnchangedToInitialAndRepairCalls() throws Exception {
        ResearchService graphValidator = new ResearchService(null, mock(ResearchToolExecutor.class), new WorkflowConfigParser(),
                new DAGParser(), mock(ChatClientFactory.class), mock(LLMGlobalConfigService.class), mock(ResearchPreferences.class));
        ResearchPreferences preferences = mock(ResearchPreferences.class);
        LLMGlobalConfigService models = mock(LLMGlobalConfigService.class);
        ChatClientFactory clients = mock(ChatClientFactory.class);
        when(preferences.global("alice")).thenReturn(new JSONObject());
        when(models.getById(4L)).thenReturn(modelConfig());

        JSONObject invalidDraft = draft(false);
        invalidDraft.getJSONArray("nodes").getJSONObject(1).getJSONObject("data").remove("prompt");
        String invalid = JSON.toJSONString(new JSONObject(Map.of("reply", "生成草案", "draft", invalidDraft)));
        String valid = JSON.toJSONString(new JSONObject(Map.of("reply", "已修正", "draft", draft(false))));
        when(clients.streamAssistantCompletion(anyString(), anyString(), anyString(), anyString(), any(), anyString()))
                .thenReturn(Flux.just(invalid), Flux.just(valid));

        ResearchAssistantService assistant = new ResearchAssistantService(graphValidator, preferences, models, clients);
        try {
            JSONObject response = assistant.chat("alice", JSON.parseObject("""
                    {"configId":4,"reasoningEffort":"high","messages":[{"role":"user","content":"设计文献检索流程"}]}
                    """));

            assertEquals("已修正", response.getString("reply"));
            assertTrue(response.getBooleanValue("repaired"));
            ArgumentCaptor<String> efforts = ArgumentCaptor.forClass(String.class);
            verify(clients, times(2)).streamAssistantCompletion(anyString(), anyString(), anyString(), anyString(), any(), efforts.capture());
            assertEquals(List.of("high", "high"), efforts.getAllValues());
            verify(clients, times(0)).createClient(anyString(), anyString(), anyString(), anyString(), anyDouble());
        } finally {
            assistant.close();
            graphValidator.close();
        }
    }

    @Test
    void requestRejectsUnsupportedReasoningEffortBeforeStartingModelCall() {
        ResearchService graphValidator = new ResearchService(null, mock(ResearchToolExecutor.class), new WorkflowConfigParser(),
                new DAGParser(), mock(ChatClientFactory.class), mock(LLMGlobalConfigService.class), mock(ResearchPreferences.class));
        ChatClientFactory clients = mock(ChatClientFactory.class);
        ResearchAssistantService assistant = new ResearchAssistantService(graphValidator, mock(ResearchPreferences.class),
                mock(LLMGlobalConfigService.class), clients);
        try {
            IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () -> assistant.chat("alice", JSON.parseObject("""
                    {"configId":4,"reasoningEffort":"ultra","messages":[{"role":"user","content":"问题"}]}
                    """)));
            assertTrue(error.getMessage().contains("low、medium 或 high"));
            verify(clients, times(0)).streamAssistantCompletion(anyString(), anyString(), anyString(), anyString(), any(), anyString());
        } finally {
            assistant.close();
            graphValidator.close();
        }
    }

    @Test
    void reportsWhenCorrectedDraftStillFailsValidation() throws Exception {
        ResearchService graphValidator = new ResearchService(null, mock(ResearchToolExecutor.class), new WorkflowConfigParser(),
                new DAGParser(), mock(ChatClientFactory.class), mock(LLMGlobalConfigService.class), mock(ResearchPreferences.class));
        ResearchPreferences preferences = mock(ResearchPreferences.class);
        LLMGlobalConfigService models = mock(LLMGlobalConfigService.class);
        ChatClientFactory clients = mock(ChatClientFactory.class);
        ChatClient client = mock(ChatClient.class);
        ChatClient.ChatClientRequestSpec request = mock(ChatClient.ChatClientRequestSpec.class);
        ChatClient.StreamResponseSpec stream = mock(ChatClient.StreamResponseSpec.class);
        when(preferences.global("alice")).thenReturn(new JSONObject());
        when(models.getById(4L)).thenReturn(modelConfig());
        when(clients.createClient(anyString(), anyString(), anyString(), anyString(), anyDouble())).thenReturn(client);
        when(client.prompt(any(Prompt.class))).thenReturn(request);
        when(request.stream()).thenReturn(stream);

        JSONObject invalidDraft = draft(false);
        invalidDraft.getJSONArray("nodes").getJSONObject(1).getJSONObject("data").remove("prompt");
        String invalid = JSON.toJSONString(new JSONObject(Map.of("reply", "草案", "draft", invalidDraft)));
        when(stream.content()).thenReturn(Flux.just(invalid), Flux.just(invalid));

        ResearchAssistantService assistant = new ResearchAssistantService(graphValidator, preferences, models, clients);
        try {
            IllegalStateException error = assertThrows(IllegalStateException.class, () -> assistant.chat("alice", JSON.parseObject("""
                    {"configId":4,"messages":[{"role":"user","content":"设计文献检索流程"}]}
                    """)));
            assertTrue(error.getMessage().contains("经一次修正后仍未通过校验"));
            assertTrue(error.getMessage().contains("[plan]"));
        } finally {
            assistant.close();
            graphValidator.close();
        }
    }

    @Test
    void transportFailureDoesNotTriggerValidationCorrection() throws Exception {
        ResearchService graphValidator = new ResearchService(null, mock(ResearchToolExecutor.class), new WorkflowConfigParser(),
                new DAGParser(), mock(ChatClientFactory.class), mock(LLMGlobalConfigService.class), mock(ResearchPreferences.class));
        ResearchPreferences preferences = mock(ResearchPreferences.class);
        LLMGlobalConfigService models = mock(LLMGlobalConfigService.class);
        ChatClientFactory clients = mock(ChatClientFactory.class);
        ChatClient client = mock(ChatClient.class);
        ChatClient.ChatClientRequestSpec request = mock(ChatClient.ChatClientRequestSpec.class);
        ChatClient.StreamResponseSpec stream = mock(ChatClient.StreamResponseSpec.class);
        when(preferences.global("alice")).thenReturn(new JSONObject());
        when(models.getById(4L)).thenReturn(modelConfig());
        when(clients.createClient(anyString(), anyString(), anyString(), anyString(), anyDouble())).thenReturn(client);
        when(client.prompt(any(Prompt.class))).thenReturn(request);
        when(request.stream()).thenReturn(stream);
        when(stream.content()).thenReturn(Flux.error(new IllegalStateException("transport unavailable")));

        ResearchAssistantService assistant = new ResearchAssistantService(graphValidator, preferences, models, clients);
        try {
            assertThrows(IllegalStateException.class, () -> assistant.chat("alice", JSON.parseObject("""
                    {"configId":4,"messages":[{"role":"user","content":"设计文献检索流程"}]}
                    """)));
            verify(stream, times(1)).content();
        } finally {
            assistant.close();
            graphValidator.close();
        }
    }

    @Test
    void cancellationDuringCorrectiveStreamCancelsTheUpstreamAndReturnsNoReply() throws Exception {
        ResearchService graphValidator = new ResearchService(null, mock(ResearchToolExecutor.class), new WorkflowConfigParser(),
                new DAGParser(), mock(ChatClientFactory.class), mock(LLMGlobalConfigService.class), mock(ResearchPreferences.class));
        ResearchPreferences preferences = mock(ResearchPreferences.class);
        LLMGlobalConfigService models = mock(LLMGlobalConfigService.class);
        ChatClientFactory clients = mock(ChatClientFactory.class);
        ChatClient client = mock(ChatClient.class);
        ChatClient.ChatClientRequestSpec request = mock(ChatClient.ChatClientRequestSpec.class);
        ChatClient.StreamResponseSpec stream = mock(ChatClient.StreamResponseSpec.class);
        when(preferences.global("alice")).thenReturn(new JSONObject());
        when(models.getById(4L)).thenReturn(modelConfig());
        when(clients.createClient(anyString(), anyString(), anyString(), anyString(), anyDouble())).thenReturn(client);
        when(client.prompt(any(Prompt.class))).thenReturn(request);
        when(request.stream()).thenReturn(stream);

        JSONObject invalidDraft = draft(false);
        invalidDraft.getJSONArray("nodes").getJSONObject(1).getJSONObject("data").remove("prompt");
        String invalid = JSON.toJSONString(new JSONObject(Map.of("reply", "草案", "draft", invalidDraft)));
        CountDownLatch correctiveStreamStarted = new CountDownLatch(1);
        CountDownLatch upstreamCancelled = new CountDownLatch(1);
        AtomicBoolean canceled = new AtomicBoolean();
        when(stream.content()).thenReturn(Flux.just(invalid), Flux.<String>never()
                .doOnSubscribe(ignored -> correctiveStreamStarted.countDown())
                .doOnCancel(() -> { canceled.set(true); upstreamCancelled.countDown(); }));

        ResearchAssistantService assistant = new ResearchAssistantService(graphValidator, preferences, models, clients);
        UUID requestId = UUID.randomUUID();
        try {
            CompletableFuture<JSONObject> pending = CompletableFuture.supplyAsync(() -> {
                try {
                    return assistant.chat("alice", JSON.parseObject("""
                            {"configId":4,"requestId":"%s","messages":[{"role":"user","content":"设计文献检索流程"}]}
                            """.formatted(requestId)));
                } catch (Exception error) {
                    throw new RuntimeException(error);
                }
            });
            assertTrue(correctiveStreamStarted.await(3, TimeUnit.SECONDS));
            assertEquals("REPAIRING", assistant.status("alice", requestId).getString("phase"));
            assertEquals("NOT_FOUND", assistant.status("bob", requestId).getString("phase"));
            JSONObject cancel = assistant.cancel("alice", requestId);
            assertEquals("CANCELED", cancel.getString("status"));
            assertEquals("CANCELED", assistant.status("alice", requestId).getString("phase"));
            assertTrue(upstreamCancelled.await(3, TimeUnit.SECONDS));
            assertThrows(java.util.concurrent.CompletionException.class, pending::join);
            assertTrue(canceled.get());
        } finally {
            assistant.close();
            graphValidator.close();
        }
    }

    @Test
    void documentNodeMustReferenceAFileAttachedToTheCurrentProject() {
        ResearchService graphValidator = new ResearchService(null, mock(ResearchToolExecutor.class), new WorkflowConfigParser(),
                new DAGParser(), mock(ChatClientFactory.class), mock(LLMGlobalConfigService.class), mock(ResearchPreferences.class));
        ResearchAssistantService assistant = new ResearchAssistantService(graphValidator, mock(ResearchPreferences.class),
                mock(LLMGlobalConfigService.class), mock(ChatClientFactory.class));
        try {
            JSONObject project = JSON.parseObject("""
                    {"clinicalData":false,"files":[{"id":"file-1","name":"study.csv"}],"settings":{}}
                    """);
            JSONObject attachedFile = draft(false);
            attachedFile.getJSONArray("nodes").add(JSON.parseObject("""
                    {"id":"document","type":"research","position":{"x":0,"y":200},"data":{"kind":"document","label":"研究资料","fileId":"file-1"}}
                    """));
            assertEquals("file-1", assistant.validateDraft(attachedFile, project, new JSONObject(), 4L, Set.of())
                    .getJSONArray("nodes").getJSONObject(5).getJSONObject("data").getString("fileId"));

            JSONObject missingFile = draft(false);
            missingFile.getJSONArray("nodes").add(JSON.parseObject("""
                    {"id":"document","type":"research","position":{"x":0,"y":200},"data":{"kind":"document","label":"研究资料"}}
                    """));
            assertThrows(IllegalStateException.class, () -> assistant.validateDraft(missingFile, project, new JSONObject(), 4L, Set.of()));

            JSONObject externalFile = draft(false);
            externalFile.getJSONArray("nodes").add(JSON.parseObject("""
                    {"id":"document","type":"research","position":{"x":0,"y":200},"data":{"kind":"document","label":"研究资料","fileId":"file-2"}}
                    """));
            assertThrows(IllegalStateException.class, () -> assistant.validateDraft(externalFile, project, new JSONObject(), 4L, Set.of()));
        } finally {
            assistant.close();
            graphValidator.close();
        }
    }

    @Test
    void allowsOnlyConfiguredPerNodeModelsAndKeepsSelectedModelAsProjectDefault() {
        ResearchService graphValidator = new ResearchService(null, mock(ResearchToolExecutor.class), new WorkflowConfigParser(),
                new DAGParser(), mock(ChatClientFactory.class), mock(LLMGlobalConfigService.class), mock(ResearchPreferences.class));
        ResearchAssistantService assistant = new ResearchAssistantService(graphValidator, mock(ResearchPreferences.class),
                mock(LLMGlobalConfigService.class), mock(ChatClientFactory.class));
        try {
            JSONObject draft = draft(false);
            draft.getJSONArray("nodes").getJSONObject(1).getJSONObject("data").put("configId", 5);
            JSONObject validated = assistant.validateDraft(draft, null, new JSONObject(), 4L, Set.of(), Set.of(4L, 5L));
            assertEquals(5L, validated.getJSONArray("nodes").getJSONObject(1).getJSONObject("data").getLongValue("configId"));
            assertEquals(4L, validated.getJSONObject("settings").getLongValue("defaultConfigId"));

            draft.getJSONArray("nodes").getJSONObject(1).getJSONObject("data").put("configId", 99);
            assertThrows(IllegalStateException.class,
                    () -> assistant.validateDraft(draft, null, new JSONObject(), 4L, Set.of(), Set.of(4L, 5L)));
        } finally {
            assistant.close();
            graphValidator.close();
        }
    }

    private static JSONObject draft(boolean includeMcpPermissions) {
        JSONObject draft = JSON.parseObject("""
                {
                  "name":"可复核分析草案","category":"数据分析","description":"研究范围待确认","clinicalData":false,
                  "settings":{"agentRules":"新增规则","defaultConfigId":4},
                  "nodes":[
                    {"id":"source","type":"research","position":{"x":0,"y":0},"data":{"kind":"input","label":"研究问题","text":"目标待确认","inputs":{}}},
                    {"id":"plan","type":"research","position":{"x":200,"y":0},"data":{"kind":"llm","label":"整理分析计划","prompt":"依据输入明确待确认变量：{{source.text}}","configId":4,"inputs":{}}},
                    {"id":"analyze","type":"research","position":{"x":400,"y":0},"data":{"kind":"python","label":"示例分析脚本","description":"生成描述性汇总","script":"print('review before run')","timeout":120,"inputs":{"text":"{{plan.text}}"}}},
                    {"id":"confirm","type":"research","position":{"x":600,"y":0},"data":{"kind":"approve","label":"确认范围","question":"请检查分析范围与结果。","inputs":{"text":"{{analyze.text}}"}}},
                    {"id":"export","type":"research","position":{"x":800,"y":0},"data":{"kind":"export","label":"导出报告","format":"md","inputs":{"text":"{{confirm.text}}"}}}
                  ],
                  "edges":[
                    {"id":"source_plan","source":"source","target":"plan"},
                    {"id":"plan_analyze","source":"plan","target":"analyze"},
                    {"id":"analyze_confirm","source":"analyze","target":"confirm"},
                    {"id":"confirm_export","source":"confirm","target":"export"}
                  ]
                }
                """);
        if (includeMcpPermissions) draft.getJSONObject("settings").put("mcpIds", new JSONArray(List.of(99)));
        return draft;
    }

    private static LLMGlobalConfig modelConfig() {
        LLMGlobalConfig config = new LLMGlobalConfig();
        config.setProvider("openai");
        config.setApiUrl("https://example.invalid");
        config.setApiKey("test-key");
        config.setModel("test-model");
        return config;
    }
}
