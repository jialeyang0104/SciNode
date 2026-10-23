package com.scinode.dto;

import lombok.Data;

@Data
public class KnowledgePreviewRequest {

    private Integer chunkSize;

    private Integer chunkOverlap;
}
