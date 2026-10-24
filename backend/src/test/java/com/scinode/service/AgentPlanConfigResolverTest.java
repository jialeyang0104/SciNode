package com.scinode.service;

import com.scinode.engine.model.WorkflowNode;
import com.scinode.entity.LLMGlobalConfig;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verifyNoMoreInteractions;

class AgentPlanConfigResolverTest {

    private final LLMGlobalConfigService configs = mock(LLMGlobalConfigService.class);
    private final AgentPlanConfigResolver resolver = new AgentPlanConfigResolver(configs);

    @ParameterizedTest
    @CsvSource({"1,2,2", "1,99,1", "1,,1", "99,2,2", "99,99,3", ",,3"})
    void savedConfigurationPriorityIsExplicitThenNodeThenDefault(Long nodeId, Long explicitId, Long expectedId) {
        when(configs.getById(1L)).thenReturn(config(1L));
        when(configs.getById(2L)).thenReturn(config(2L));
        when(configs.getDefaultConfig("volcengine_agent_plan")).thenReturn(config(3L));
        Map<String, Object> data = new HashMap<>();
        if (nodeId != null) data.put("configId", nodeId.toString());
        if (explicitId != null) data.put("agentPlanConfigId", explicitId);
        data.put("apiUrl", "https://inline.invalid");
        data.put("apiKey", "inline-test-key");
        data.put("provider", "step");
        data.put("model", " node-model ");

        ResolvedAgentPlanConfig result = resolver.resolve(node(data), "llm");

        assertEquals(expectedId, result.configId());
        assertEquals("https://models.invalid/" + expectedId, result.apiUrl());
        assertEquals("test-key-" + expectedId, result.apiKey());
        assertEquals("openai", result.provider());
        assertEquals("node-model", result.model());
    }

    @ParameterizedTest
    @CsvSource({
            "llm,node-model,saved-embedding,saved-image,saved-video",
            "unknown,node-model,saved-embedding,saved-image,saved-video",
            "embedding,node-model,node-model,saved-image,saved-video",
            "image,node-model,saved-embedding,node-model,saved-video",
            "video,node-model,saved-embedding,saved-image,node-model",
            "memory,saved-embedding,saved-embedding,saved-image,saved-video",
            "knowledge,saved-embedding,saved-embedding,saved-image,saved-video"
    })
    void nodeModelOverridesOnlyItsRequestedCapability(String capability, String effective,
                                                     String embedding, String image, String video) {
        LLMGlobalConfig saved = config(1L);
        when(configs.getById(1L)).thenReturn(saved);

        ResolvedAgentPlanConfig result = resolver.resolve(node(Map.of("configId", 1L, "model", " node-model ")), capability);

        assertEquals(new ResolvedAgentPlanConfig(1L, "openai", "https://models.invalid/1", "test-key-1",
                effective, embedding, image, video, true), result);
        assertEquals("saved-language", saved.getModel());
        assertEquals("saved-embedding", saved.getEmbeddingModel());
    }

    @ParameterizedTest
    @CsvSource({"llm,saved-language", "image,saved-language", "video,saved-language",
            "embedding,doubao-embedding-vision", "memory,doubao-embedding-vision", "knowledge,doubao-embedding-vision"})
    void missingCapabilityModelsKeepExistingFallbacks(String capability, String effective) {
        LLMGlobalConfig saved = config(1L);
        saved.setEmbeddingModel(" ");
        saved.setImageModel(null);
        saved.setVideoModel("");
        when(configs.getById(1L)).thenReturn(saved);

        ResolvedAgentPlanConfig result = resolver.resolve(node(Map.of("configId", 1L, "model", " ")), capability);

        assertEquals(effective, result.model());
        assertEquals(AgentPlanConfigResolver.DEFAULT_EMBEDDING_MODEL, result.embeddingModel());
        assertEquals("saved-language", result.imageModel());
        assertEquals("saved-language", result.videoModel());
    }

    @Test
    void blankSavedConnectionFieldsUseInlineValuesIndividually() {
        LLMGlobalConfig saved = config(1L);
        saved.setProvider(" ");
        saved.setApiUrl(null);
        when(configs.getById(1L)).thenReturn(saved);

        ResolvedAgentPlanConfig result = resolver.resolve(node(Map.of("configId", 1L,
                "provider", " StepFun ", "apiUrl", " https://inline.invalid ", "apiKey", "inline-key")), "llm");

        assertEquals("step", result.provider());
        assertEquals("https://inline.invalid", result.apiUrl());
        assertEquals("test-key-1", result.apiKey());
    }

    @ParameterizedTest
    @CsvSource({"Volcengine,volcengine_agent_plan", "ark,volcengine_agent_plan",
            "agent_plan,volcengine_agent_plan", "Agent Plan,volcengine_agent_plan", "火山方舟,volcengine_agent_plan",
            "Open AI,openai", "Deep Seek,deepseek", "通义千问,qwen", "StepFun,step", "阶跃星辰,step",
            "智谱,zhipu", "AI Ping,ai_ping", "Agnes,agnes", "Agnes AI,agnes", "Custom Provider,custom provider"})
    void providerAliasesKeepTheirExistingRuntimeKeys(String alias, String expected) {
        ResolvedAgentPlanConfig result = resolver.resolve(node(Map.of("provider", " " + alias + " ")), "llm");

        assertEquals(expected, result.provider());
        assertNull(result.configId());
        assertFalse(result.memoryEnabled());
    }

    @Test
    void imageUsesProviderDefaultBeforeAgentPlanOrStepDefaults() {
        when(configs.getDefaultConfig("step")).thenReturn(config(1L));

        ResolvedAgentPlanConfig result = resolver.resolveImageConfig(node(Map.of("provider", "StepFun", "model", "chosen-image")));

        assertEquals(1L, result.configId());
        assertEquals("chosen-image", result.model());
        org.mockito.Mockito.verify(configs).getDefaultConfig("step");
        verifyNoMoreInteractions(configs);
    }

    @Test
    void imageWithoutProviderDefaultFallsBackToAgentPlanThenStep() {
        when(configs.getDefaultConfig("volcengine_agent_plan")).thenReturn(config(2L));
        when(configs.getDefaultConfig("step")).thenReturn(config(3L));

        assertEquals(2L, resolver.resolveImageConfig(node(Map.of("provider", "qwen"))).configId());

        when(configs.getDefaultConfig("volcengine_agent_plan")).thenReturn(null);
        assertEquals(3L, resolver.resolveImageConfig(node(Map.of())).configId());
    }

    @Test
    void imageKeepsAncillaryFieldsRawAndDoesNotUseEmbeddingFallback() {
        LLMGlobalConfig saved = config(1L);
        saved.setEmbeddingModel(" untrimmed-embedding ");
        saved.setVideoModel(" untrimmed-video ");
        when(configs.getById(1L)).thenReturn(saved);

        ResolvedAgentPlanConfig result = resolver.resolveImageConfig(node(Map.of("configId", 1L)));

        assertEquals(" untrimmed-embedding ", result.embeddingModel());
        assertEquals(" untrimmed-video ", result.videoModel());
        when(configs.getById(1L)).thenReturn(null);
        result = resolver.resolveImageConfig(node(Map.of("apiUrl", " https://inline.invalid ", "apiKey", " inline-key ", "model", " inline-image ")));
        assertNull(result.embeddingModel());
        assertNull(result.videoModel());
        assertEquals("inline-image", result.model());
        assertEquals("https://inline.invalid", result.apiUrl());
        assertEquals("inline-key", result.apiKey());
    }

    @Test
    void knowledgeKeepsRequestedConfigIdWhenSavedConfigIsAbsent() {
        ResolvedAgentPlanConfig result = resolver.resolveKnowledgeConfig(99L, " override ");

        assertEquals(new ResolvedAgentPlanConfig(99L, "volcengine_agent_plan", null, null,
                "override", "override", null, null, false), result);
        assertEquals(AgentPlanConfigResolver.DEFAULT_EMBEDDING_MODEL, resolver.resolveKnowledgeConfig(null, null).model());
    }

    @Test
    void knowledgePreservesRawConnectionAndAncillaryFields() {
        LLMGlobalConfig saved = config(1L);
        saved.setProvider(" Agnes AI ");
        saved.setApiUrl(" https://models.invalid/1 ");
        saved.setApiKey(" test-key-1 ");
        saved.setImageModel(" image ");
        saved.setVideoModel(" video ");
        when(configs.getById(1L)).thenReturn(saved);

        assertEquals(new ResolvedAgentPlanConfig(1L, "agnes", " https://models.invalid/1 ", " test-key-1 ",
                "saved-embedding", "saved-embedding", " image ", " video ", true), resolver.resolveKnowledgeConfig(1L, null));
    }

    @Test
    void invalidConfigIdStillFailsInsteadOfSelectingAnotherConnection() {
        assertThrows(NumberFormatException.class, () -> resolver.resolve(node(Map.of("configId", "invalid")), "llm"));
    }

    @ParameterizedTest
    @NullAndEmptySource
    @org.junit.jupiter.params.provider.ValueSource(strings = " ")
    void incompleteConnectionStillFailsAtValidation(String missing) {
        for (ResolvedAgentPlanConfig incomplete : List.of(
                new ResolvedAgentPlanConfig(null, "openai", missing, "key", "model", null, null, null, false),
                new ResolvedAgentPlanConfig(null, "openai", "url", missing, "model", null, null, null, false),
                new ResolvedAgentPlanConfig(null, "openai", "url", "key", missing, null, null, null, false))) {
            IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                    () -> resolver.validateApiConfig(incomplete, "科研任务"));
            assertTrue(error.getMessage().startsWith("科研任务 节点缺少有效的"));
        }
    }

    @Test
    void validInlineConnectionPassesValidation() {
        ResolvedAgentPlanConfig result = resolver.resolve(node(Map.of("apiUrl", " https://inline.invalid ",
                "apiKey", " test-key ", "model", " inline-model ")), "llm");

        assertDoesNotThrow(() -> resolver.validateApiConfig(result, "科研任务"));
        assertEquals("volcengine_agent_plan", result.provider());
    }

    private static LLMGlobalConfig config(long id) {
        LLMGlobalConfig config = new LLMGlobalConfig();
        config.setId(id);
        config.setProvider("openai");
        config.setApiUrl("https://models.invalid/" + id);
        config.setApiKey("test-key-" + id);
        config.setModel("saved-language");
        config.setEmbeddingModel("saved-embedding");
        config.setImageModel("saved-image");
        config.setVideoModel("saved-video");
        config.setMemoryEnabled(1);
        return config;
    }

    private static WorkflowNode node(Map<String, Object> data) {
        WorkflowNode node = new WorkflowNode();
        node.setData(data);
        return node;
    }

    @Test
    void resolveImageConfig_UsesSelectedStepConfig_WhenAgentPlanDefaultExists() {
        LLMGlobalConfigService configService = mock(LLMGlobalConfigService.class);
        AgentPlanConfigResolver resolver = new AgentPlanConfigResolver(configService);

        LLMGlobalConfig stepConfig = new LLMGlobalConfig();
        stepConfig.setId(12L);
        stepConfig.setProvider("step");
        stepConfig.setApiUrl("https://api.stepfun.com/v1");
        stepConfig.setApiKey("step-key");
        stepConfig.setModel("step-3.5-flash");
        stepConfig.setImageModel("step-1x-medium");

        LLMGlobalConfig agentPlanDefault = new LLMGlobalConfig();
        agentPlanDefault.setId(33L);
        agentPlanDefault.setProvider("volcengine_agent_plan");
        agentPlanDefault.setApiUrl("https://ark.cn-beijing.volces.com/api/plan/v3");
        agentPlanDefault.setApiKey("ark-key");
        agentPlanDefault.setModel("doubao-model");
        agentPlanDefault.setImageModel("seedream-model");

        when(configService.getById(12L)).thenReturn(stepConfig);
        when(configService.getDefaultConfig("volcengine_agent_plan")).thenReturn(agentPlanDefault);

        WorkflowNode node = new WorkflowNode();
        Map<String, Object> data = new HashMap<>();
        data.put("configId", 12L);
        node.setData(data);

        ResolvedAgentPlanConfig resolved = resolver.resolveImageConfig(node);

        assertEquals(12L, resolved.configId());
        assertEquals("step", resolved.provider());
        assertEquals("https://api.stepfun.com/v1", resolved.apiUrl());
        assertEquals("step-key", resolved.apiKey());
        assertEquals("step-1x-medium", resolved.model());
    }

    @Test
    void resolveVideoConfig_UsesSelectedAgnesConfig_WhenAgentPlanDefaultExists() {
        LLMGlobalConfigService configService = mock(LLMGlobalConfigService.class);
        AgentPlanConfigResolver resolver = new AgentPlanConfigResolver(configService);

        LLMGlobalConfig agnesConfig = new LLMGlobalConfig();
        agnesConfig.setId(18L);
        agnesConfig.setProvider("Agnes AI");
        agnesConfig.setApiUrl("https://apihub.agnes-ai.com");
        agnesConfig.setApiKey("agnes-key");
        agnesConfig.setModel("agnes-2.0-flash");
        agnesConfig.setVideoModel("agnes-video-v2.0");

        LLMGlobalConfig agentPlanDefault = new LLMGlobalConfig();
        agentPlanDefault.setId(33L);
        agentPlanDefault.setProvider("volcengine_agent_plan");
        agentPlanDefault.setApiUrl("https://ark.cn-beijing.volces.com/api/plan/v3");
        agentPlanDefault.setApiKey("ark-key");
        agentPlanDefault.setModel("doubao-model");
        agentPlanDefault.setVideoModel("seedance-model");

        when(configService.getById(18L)).thenReturn(agnesConfig);
        when(configService.getDefaultConfig("volcengine_agent_plan")).thenReturn(agentPlanDefault);

        WorkflowNode node = new WorkflowNode();
        Map<String, Object> data = new HashMap<>();
        data.put("configId", 18L);
        node.setData(data);

        ResolvedAgentPlanConfig resolved = resolver.resolve(node, "video");

        assertEquals(18L, resolved.configId());
        assertEquals("agnes", resolved.provider());
        assertEquals("https://apihub.agnes-ai.com", resolved.apiUrl());
        assertEquals("agnes-key", resolved.apiKey());
        assertEquals("agnes-video-v2.0", resolved.model());
    }
}
