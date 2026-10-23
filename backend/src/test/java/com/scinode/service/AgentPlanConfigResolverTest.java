package com.scinode.service;

import com.scinode.engine.model.WorkflowNode;
import com.scinode.entity.LLMGlobalConfig;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AgentPlanConfigResolverTest {

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
