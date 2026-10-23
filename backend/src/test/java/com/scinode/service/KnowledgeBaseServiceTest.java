package com.scinode.service;

import com.scinode.entity.KnowledgeBase;
import com.scinode.entity.KnowledgeChunk;
import com.scinode.mapper.KnowledgeBaseMapper;
import com.scinode.mapper.KnowledgeChunkMapper;
import com.scinode.mapper.KnowledgeDocumentMapper;
import com.scinode.mapper.KnowledgeIndexTaskMapper;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class KnowledgeBaseServiceTest {

    @Test
    void shouldScoreChineseTextMatchesWhenEmbeddingIsUnavailable() {
        KnowledgeChunkMapper chunkMapper = mock(KnowledgeChunkMapper.class);
        KnowledgeBaseService service = createService(chunkMapper);
        when(chunkMapper.selectList(any())).thenReturn(List.of(
                chunk(1L, "联网搜索能力", "Agent Plan 支持联网搜索、网页读取和知识库检索，可以获取实时权威信息。"),
                chunk(2L, "语音能力", "TTS 节点负责把文本转换成语音，适合播报和配音。")
        ));

        Map<String, Object> result = service.retrieve("1", "联网搜索应该怎么做?", List.of(), 5, 0);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> chunks = (List<Map<String, Object>>) result.get("chunks");
        assertEquals(1, chunks.size());
        assertEquals(1L, chunks.getFirst().get("chunkId"));
        assertTrue((double) chunks.getFirst().get("score") > 0);
    }

    @Test
    void shouldNotReturnZeroScoreChunksWhenThresholdAllowsFallbackSearch() {
        KnowledgeChunkMapper chunkMapper = mock(KnowledgeChunkMapper.class);
        KnowledgeBaseService service = createService(chunkMapper);
        when(chunkMapper.selectList(any())).thenReturn(List.of(
                chunk(1L, "语音能力", "TTS 节点负责把文本转换成语音，适合播报和配音。")
        ));

        Map<String, Object> result = service.retrieve("1", "联网搜索应该怎么做?", List.of(), 5, 0);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> chunks = (List<Map<String, Object>>) result.get("chunks");
        assertTrue(chunks.isEmpty());
        assertFalse(String.valueOf(result.get("context")).contains("TTS"));
    }

    private KnowledgeBaseService createService(KnowledgeChunkMapper chunkMapper) {
        KnowledgeBaseMapper baseMapper = mock(KnowledgeBaseMapper.class);
        KnowledgeBase base = new KnowledgeBase();
        base.setId(1L);
        base.setName("测试知识库");
        when(baseMapper.selectById(1L)).thenReturn(base);
        return new KnowledgeBaseService(
                baseMapper,
                mock(KnowledgeDocumentMapper.class),
                chunkMapper,
                mock(KnowledgeIndexTaskMapper.class),
                mock(AgentPlanConfigResolver.class),
                mock(VolcengineAgentPlanClient.class)
        );
    }

    private KnowledgeChunk chunk(Long id, String title, String content) {
        KnowledgeChunk chunk = new KnowledgeChunk();
        chunk.setId(id);
        chunk.setKnowledgeBaseId(1L);
        chunk.setDocumentId(10L + id);
        chunk.setTitle(title);
        chunk.setContent(content);
        chunk.setEmbedding("[]");
        chunk.setStatus("READY");
        return chunk;
    }
}
