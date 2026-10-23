package com.scinode.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class KnowledgeBaseRequest {

    @NotBlank(message = "知识库名称不能为空")
    private String name;

    private String description;

    private Long configId;

    private String embeddingModel;

    private Integer chunkSize;

    private Integer chunkOverlap;
}
