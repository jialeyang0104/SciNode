package com.scinode.controller;

import com.scinode.common.Result;
import com.scinode.dto.AgentPlanWebSearchMcpRequest;
import com.scinode.dto.McpToolConfigRequest;
import com.scinode.dto.McpToolTestRequest;
import com.scinode.service.McpToolConfigService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@Tag(name = "MCP 工具管理接口")
@RestController
@RequestMapping("/api/mcp-tools")
public class McpToolConfigController {

    private final McpToolConfigService mcpToolConfigService;

    public McpToolConfigController(McpToolConfigService mcpToolConfigService) {
        this.mcpToolConfigService = mcpToolConfigService;
    }

    @Operation(summary = "查询 MCP 工具列表")
    @GetMapping
    public Result<List<Map<String, Object>>> list() {
        return Result.success(mcpToolConfigService.listConfigs());
    }

    @Operation(summary = "新增 MCP 工具")
    @PostMapping
    public Result<Map<String, Object>> create(@Valid @RequestBody McpToolConfigRequest request) {
        return Result.success(mcpToolConfigService.createConfig(request));
    }

    @Operation(summary = "新增 Agent Plan 联网搜索 MCP 工具")
    @PostMapping("/agent-plan-web-search")
    public Result<Map<String, Object>> createAgentPlanWebSearch(@Valid @RequestBody AgentPlanWebSearchMcpRequest request) {
        return Result.success(mcpToolConfigService.createAgentPlanWebSearch(request));
    }

    @Operation(summary = "更新 MCP 工具")
    @PutMapping("/{id}")
    public Result<Map<String, Object>> update(@PathVariable Long id,
                                              @Valid @RequestBody McpToolConfigRequest request) {
        return Result.success(mcpToolConfigService.updateConfig(id, request));
    }

    @Operation(summary = "删除 MCP 工具")
    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        mcpToolConfigService.deleteConfig(id);
        return Result.success();
    }

    @Operation(summary = "测试 MCP 工具")
    @PostMapping("/{id}/test")
    public Result<Map<String, Object>> test(@PathVariable Long id,
                                            @RequestBody(required = false) McpToolTestRequest request) throws Exception {
        return Result.success(mcpToolConfigService.testConfig(id, request == null ? null : request.getQuery()));
    }
}
