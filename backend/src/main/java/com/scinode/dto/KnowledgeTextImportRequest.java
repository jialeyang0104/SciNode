package com.scinode.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class KnowledgeTextImportRequest {

    private String title;

    @NotBlank(message = "导入文本不能为空")
    private String content;

    private String tags;
}
