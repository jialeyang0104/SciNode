package com.scinode.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

import java.util.List;
import java.util.Map;

@Data
public class McpToolConfigRequest {

    @NotBlank(message = "MCP 名称不能为空")
    private String name;

    private String description;

    private String toolType;

    @NotBlank(message = "工具名不能为空")
    private String toolName;

    private String transport;

    @NotBlank(message = "启动命令不能为空")
    private String command;

    private List<String> args;

    private Map<String, String> env;

    private Integer enabled;
}
