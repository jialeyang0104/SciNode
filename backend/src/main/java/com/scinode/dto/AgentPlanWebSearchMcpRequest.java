package com.scinode.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class AgentPlanWebSearchMcpRequest {

    private String name;

    private String description;

    @NotBlank(message = "联网搜索 API Key 不能为空")
    private String apiKey;
}
