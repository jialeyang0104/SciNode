package com.scinode.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class KnowledgeSearchRequest {

    @NotBlank(message = "检索问题不能为空")
    private String query;

    private Integer topK;

    private Double scoreThreshold;
}
