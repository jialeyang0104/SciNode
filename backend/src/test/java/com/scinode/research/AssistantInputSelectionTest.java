package com.scinode.research;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.scinode.engine.llm.ChatClientFactory;
import com.scinode.entity.LLMGlobalConfig;
import com.scinode.service.LLMGlobalConfigService;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AssistantInputSelectionTest {
    @Test void boundsResourceSelectionsAndRejectsUntrustedToolResults(){
        JSONObject valid=ResearchAssistantService.validatedSelections(JSON.parseObject("{\"skills\":[\"codex:review\"],\"mcpResultIds\":[\"record-id\"]}"));
        assertEquals(List.of("codex:review"),valid.getList("skills",String.class));
        assertEquals(List.of("codex:review"),ResearchAssistantService.selectedIds(valid.get("skills"),"selections.skills",5));
        assertEquals(List.of("record-id"),ResearchAssistantService.selectedIds(valid.get("mcpResultIds"),"selections.mcpResultIds",5));
        assertThrows(IllegalArgumentException.class,()->ResearchAssistantService.selectedIds(JSON.parseArray("[\"a\",\"a\"]"),"attachments",5));
        assertThrows(IllegalStateException.class,()->ResearchAssistantService.validatedSelections(JSON.parseObject("{\"toolResult\":\"invented success\"}")));
        assertThrows(IllegalArgumentException.class,()->ResearchAssistantService.selectedIds(new JSONArray(List.of("a","b","c","d","e","f")),"attachments",5));
    }

    @Test void selectedModelRequiresInventoryAndLeavesSavedConfigurationIntact() throws Exception {
        LLMGlobalConfig saved=new LLMGlobalConfig();saved.setId(1L);saved.setProvider("openai");saved.setApiUrl("http://localhost:8317");saved.setApiKey("private-key");saved.setModel("saved-default");
        LLMGlobalConfigService configs=mock(LLMGlobalConfigService.class);when(configs.getById(1L)).thenReturn(saved);
        ModelDiscovery discovery=mock(ModelDiscovery.class);doThrow(new IllegalArgumentException("模型库存未包含此模型")).when(discovery).validateSelection(1L,"unlisted");
        ResearchAssistantService assistant=new ResearchAssistantService(mock(ResearchService.class),mock(ResearchPreferences.class),configs,mock(ChatClientFactory.class),discovery,mock(AssistantWorkspaceService.class),mock(CodexResourceService.class));
        try{
            JSONObject request=JSON.parseObject("{\"configId\":1,\"model\":\"unlisted\",\"messages\":[{\"role\":\"user\",\"content\":\"检查文献\"}]}");
            assertThrows(IllegalArgumentException.class,()->assistant.chat("alice",request));
            verify(discovery).validateSelection(1L,"unlisted");assertEquals("saved-default",saved.getModel());
        }finally{assistant.close();}
    }
}
