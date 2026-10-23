package com.scinode.research;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class AssistantContextSupportTest {
    @Test
    void selectedCardsAreBoundedAndRedactedBeforePersistenceOrModelUse() {
        JSONArray clean = AssistantContextSupport.sanitizeCards(new JSONArray(java.util.List.of(new JSONObject(Map.of(
                "id", "card-1", "type", "run_error", "title", "运行排查", "content", "token=local-secret at /Users/alice/run", "truncated", true)))));
        JSONObject card = clean.getJSONObject(0);
        assertEquals("token=[凭据已隐藏] at [本地路径已隐藏]", card.getString("content"));
        assertTrue(AssistantContextSupport.formatForModel(clean).contains("[内容按长度限制截断]"));
        assertThrows(IllegalArgumentException.class, () -> AssistantContextSupport.sanitizeCards(new JSONArray(java.util.List.of(
                new JSONObject(Map.of("id", "x", "type", "project_summary", "title", "项目", "content", "x".repeat(6_001), "truncated", false))))));
        assertThrows(IllegalArgumentException.class, () -> AssistantContextSupport.sanitizeCards(new JSONArray(java.util.List.of(
                new JSONObject(Map.of("id", "x", "type", "run_error", "title", "运行", "content", "x", "truncated", false, "output", "private"))))));
        JSONObject oversizedTurn = new JSONObject(Map.of("role", "user", "content", "x".repeat(11_500), "contextCards", java.util.List.of(
                Map.of("id", "c", "type", "project_summary", "title", "项目资料", "content", "y".repeat(1_000), "truncated", false))));
        assertThrows(IllegalArgumentException.class, () -> ResearchAssistantService.validateMessages(new JSONArray(java.util.List.of(oversizedTurn))));
    }
}
