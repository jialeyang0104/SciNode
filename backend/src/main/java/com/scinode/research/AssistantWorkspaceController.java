package com.scinode.research;

import com.alibaba.fastjson2.JSONObject;
import com.scinode.common.Result;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

@RestController
@RequestMapping("/api/research/assistant")
public class AssistantWorkspaceController {
    private final AssistantWorkspaceService workspace;
    private final AssistantConversationTaskService tasks;

    public AssistantWorkspaceController(AssistantWorkspaceService workspace, AssistantConversationTaskService tasks) {
        this.workspace = workspace;
        this.tasks = tasks;
    }

    @GetMapping("/sessions")
    public Result<?> sessions(HttpServletRequest request, @RequestParam(required = false) String projectId,
            @RequestParam(defaultValue = "false") boolean archived) throws Exception {
        return Result.success(tasks.sessions(user(request), projectId, archived));
    }

    @PostMapping("/sessions")
    public Result<?> createSession(HttpServletRequest request, @RequestBody(required = false) JSONObject body) throws Exception {
        return Result.success(workspace.createSession(user(request), body));
    }

    @GetMapping("/sessions/{id}")
    public Result<?> session(HttpServletRequest request, @PathVariable String id) throws Exception {
        return Result.success(tasks.session(user(request), id));
    }

    @PutMapping("/sessions/{id}")
    public Result<?> saveSession(HttpServletRequest request, @PathVariable String id, @RequestBody JSONObject body) throws Exception {
        return Result.success(workspace.saveSession(user(request), id, body));
    }

    @PostMapping("/sessions/{id}/associate")
    public Result<?> associateSession(HttpServletRequest request, @PathVariable String id, @RequestBody JSONObject body) throws Exception {
        if (body == null) throw new IllegalArgumentException("缺少会话关联内容");
        for (String key : body.keySet()) if (!List.of("projectId", "revision").contains(key)) {
            throw new IllegalArgumentException("会话关联包含未支持字段：" + key);
        }
        return Result.success(workspace.associateSession(user(request), id, body.getString("projectId"), body.getInteger("revision")));
    }

    @PostMapping("/sessions/{id}/archive")
    public Result<?> archiveSession(HttpServletRequest request, @PathVariable String id) throws Exception {
        return Result.success(workspace.archiveSession(user(request), id));
    }

    @PostMapping("/sessions/{id}/unarchive")
    public Result<?> unarchiveSession(HttpServletRequest request, @PathVariable String id) throws Exception {
        return Result.success(workspace.unarchiveSession(user(request), id));
    }

    @DeleteMapping("/sessions/{id}")
    public Result<?> deleteSession(HttpServletRequest request, @PathVariable String id) throws Exception {
        return Result.success(tasks.delete(user(request), id));
    }

    @PostMapping("/sessions/{id}/tasks")
    public Result<?> startTask(HttpServletRequest request, @PathVariable String id, @RequestBody JSONObject body) throws Exception {
        return Result.success(tasks.start(user(request), id, body));
    }

    @PostMapping("/sessions/{id}/tasks/retry")
    public Result<?> retryTask(HttpServletRequest request, @PathVariable String id, @RequestBody(required = false) JSONObject body) throws Exception {
        return Result.success(tasks.retry(user(request), id, body));
    }

    @GetMapping("/sessions/{id}/tasks/current")
    public Result<?> currentTask(HttpServletRequest request, @PathVariable String id) throws Exception {
        return Result.success(tasks.status(user(request), id));
    }

    @PostMapping("/sessions/{id}/tasks/cancel")
    public Result<?> cancelTask(HttpServletRequest request, @PathVariable String id) throws Exception {
        return Result.success(tasks.cancel(user(request), id));
    }

    @PostMapping("/files")
    public Result<?> upload(HttpServletRequest request, @RequestParam("file") MultipartFile file) throws Exception {
        return Result.success(workspace.upload(user(request), file));
    }

    @PostMapping("/local-files")
    public Result<?> importLocalFile(HttpServletRequest request, @RequestBody JSONObject body) throws Exception {
        return Result.success(workspace.importLocalFile(user(request), body == null ? null : body.getString("path")));
    }

    @GetMapping("/local-files")
    public Result<?> localFiles(@RequestParam(required = false) String path) throws Exception {
        return Result.success(workspace.localFiles(path));
    }

    @GetMapping("/files/{id}")
    public Result<?> file(HttpServletRequest request, @PathVariable String id) throws Exception {
        return Result.success(workspace.file(user(request), id));
    }

    private String user(HttpServletRequest request) {
        Object username = request.getAttribute("username");
        if (!(username instanceof String value) || value.isBlank()) throw new IllegalStateException("当前请求缺少登录用户信息");
        return value;
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Result<?>> error(Exception error) {
        String message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
        return ResponseEntity.badRequest().body(Result.error(message));
    }
}
