package com.scinode.research;

import com.alibaba.fastjson2.JSONObject;
import com.scinode.common.Result;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.ExceptionHandler;

@RestController
@RequestMapping("/api/research")
public class CodexResourceController {
    private final CodexResourceService resources;

    public CodexResourceController(CodexResourceService resources) {
        this.resources = resources;
    }

    @GetMapping("/codex/status")
    public Result<?> codexStatus(HttpServletRequest request) throws Exception {
        return Result.success(resources.status(user(request)));
    }

    @PostMapping("/codex/link")
    public Result<?> link(HttpServletRequest request, @RequestBody(required = false) JSONObject body) throws Exception {
        return Result.success(resources.link(user(request), body == null ? null : body.getString("codexHome")));
    }

    @PostMapping("/codex/unlink")
    public Result<?> unlink(HttpServletRequest request) throws Exception {
        return Result.success(resources.unlink(user(request)));
    }

    @GetMapping("/assistant/resources")
    public Result<?> catalog(HttpServletRequest request, @RequestParam(required = false) String projectId) throws Exception {
        return Result.success(resources.resources(user(request), projectId));
    }

    @GetMapping("/assistant/skills/{resourceId}/content")
    public Result<?> skillContent(HttpServletRequest request, @PathVariable String resourceId,
                                  @RequestParam(required = false) String projectId) throws Exception {
        return Result.success(new JSONObject().fluentPut("content", resources.skillContent(user(request), resourceId, projectId)));
    }

    @GetMapping("/assistant/skills/content")
    public Result<?> skillContentById(HttpServletRequest request, @RequestParam String resourceId,
                                      @RequestParam(required = false) String projectId) throws Exception {
        return Result.success(new JSONObject().fluentPut("content", resources.skillContent(user(request), resourceId, projectId)));
    }

    @PostMapping("/assistant/mcp/inspect")
    public Result<?> inspectMcp(HttpServletRequest request, @RequestBody JSONObject body) throws Exception {
        return Result.success(resources.inspectMcp(user(request), required(body, "resourceId"), body.getString("projectId")));
    }

    @PostMapping("/assistant/mcp/call")
    public Result<?> callMcp(HttpServletRequest request, @RequestBody JSONObject body) throws Exception {
        return Result.success(resources.callMcp(user(request), required(body, "resourceId"), required(body, "toolName"),
                body.getJSONObject("arguments"), body.getString("projectId")));
    }

    private String user(HttpServletRequest request) {
        return (String) request.getAttribute("username");
    }

    private String required(JSONObject body, String field) {
        if (body == null) throw new IllegalArgumentException("请提供请求内容");
        String value = body.getString(field);
        if (value == null || value.isBlank()) throw new IllegalArgumentException("请填写 " + field);
        return value;
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Result<?>> error(Exception error) {
        String message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
        message = message.replaceAll("(?<![A-Za-z0-9])(?:/(?:Users|Volumes|private|tmp|var|home|mnt|opt|srv)/[^\\s\\\"'<>]+|[A-Za-z]:\\\\Users\\\\[^\\s\\\"'<>]+)", "[本地路径隐藏]");
        return ResponseEntity.badRequest().body(Result.error(message));
    }
}
