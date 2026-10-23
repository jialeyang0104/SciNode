package com.scinode.research;

import com.alibaba.fastjson2.JSONObject;
import com.scinode.common.Result;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import java.util.*;
import java.nio.file.Files;

@RestController
@RequestMapping("/api/research")
public class ResearchController {
    private final ResearchService service;
    private final ModelDiscovery discovery;
    private final ResearchPreferences preferences;
    private final ResearchAssistantService assistant;
    public ResearchController(ResearchService service,ModelDiscovery discovery,ResearchPreferences preferences,ResearchAssistantService assistant) { this.service=service;this.discovery=discovery;this.preferences=preferences;this.assistant=assistant; }
    @PostMapping("/models/discover") public Result<?> discover(@RequestBody JSONObject body)throws Exception{return Result.success(discovery.discover(body));}
    @GetMapping("/models/{configId}/inventory") public Result<?> inventory(@PathVariable Long configId,@RequestParam(defaultValue="false") boolean refresh)throws Exception{return Result.success(discovery.inventory(configId,refresh));}
    @PostMapping("/assistant/chat") public Result<?> assistantChat(HttpServletRequest r,@RequestBody JSONObject body)throws Exception{return Result.success(assistant.chat(user(r),body));}
    @PostMapping("/assistant/requests/{requestId}/cancel") public Result<?> cancelAssistant(HttpServletRequest r,@PathVariable String requestId) {
        UUID id;
        try { id = UUID.fromString(requestId); }
        catch (IllegalArgumentException error) { return Result.error("requestId 应为 UUID"); }
        return Result.success(assistant.cancel(user(r), id));
    }
    @GetMapping("/assistant/requests/{requestId}/status") public Result<?> assistantStatus(HttpServletRequest r,@PathVariable String requestId) {
        UUID id;
        try { id = UUID.fromString(requestId); }
        catch (IllegalArgumentException error) { return Result.error("requestId 应为 UUID"); }
        return Result.success(assistant.status(user(r), id));
    }
    @GetMapping("/settings") public Result<?> settings(HttpServletRequest r)throws Exception{return Result.success(preferences.global(user(r)));}
    @PutMapping("/settings") public Result<?> settings(HttpServletRequest r,@RequestBody JSONObject body)throws Exception{return Result.success(preferences.saveGlobal(user(r),body));}
    @PostMapping("/projects/{id}/lifecycle") public Result<?> lifecycle(HttpServletRequest r,@PathVariable String id,@RequestBody JSONObject body)throws Exception{return Result.success(service.lifecycle(user(r),id,body));}
    @PostMapping("/mcp/{id}/inspect") public Result<?> inspect(@PathVariable Long id)throws Exception{return Result.success(preferences.inspect(id));}
    private String user(HttpServletRequest r) { return (String)r.getAttribute("username"); }
    @GetMapping("/projects") public Result<?> projects(HttpServletRequest r) throws Exception { return Result.success(service.projects(user(r))); }
    @PostMapping("/projects") public Result<?> create(HttpServletRequest r, @RequestBody JSONObject body) throws Exception { return Result.success(service.create(user(r),body)); }
    @GetMapping("/projects/{id}") public Result<?> project(HttpServletRequest r,@PathVariable String id) throws Exception { return Result.success(service.project(user(r),id)); }
    @PutMapping("/projects/{id}") public Result<?> save(HttpServletRequest r,@PathVariable String id,@RequestBody JSONObject body) throws Exception { return Result.success(service.save(user(r),id,body)); }
    @PostMapping("/projects/{id}/files") public Result<?> upload(HttpServletRequest r,@PathVariable String id,@RequestParam("file") MultipartFile file) throws Exception { return Result.success(service.upload(user(r),id,file)); }
    @PostMapping("/projects/{id}/runs") public Result<?> run(HttpServletRequest r,@PathVariable String id,@RequestBody JSONObject body) throws Exception { return Result.success(service.start(user(r),id,body)); }
    @GetMapping("/projects/{id}/runs") public Result<?> runs(HttpServletRequest r,@PathVariable String id) throws Exception { return Result.success(service.runs(user(r),id)); }
    @GetMapping("/runs/{id}") public Result<?> run(HttpServletRequest r,@PathVariable String id) throws Exception { return Result.success(service.run(user(r),id)); }
    @PostMapping("/runs/{id}/stop") public Result<?> stop(HttpServletRequest r,@PathVariable String id) throws Exception { return Result.success(service.stop(user(r),id)); }
    @PostMapping("/runs/{id}/pause") public Result<?> pause(HttpServletRequest r,@PathVariable String id) throws Exception { return Result.success(service.pause(user(r),id)); }
    @PostMapping("/runs/{id}/continue") public Result<?> proceed(HttpServletRequest r,@PathVariable String id,@RequestBody JSONObject body) throws Exception { return Result.success(service.proceed(user(r),id,body)); }
    @PostMapping("/runs/{id}/freeze") public Result<?> freeze(HttpServletRequest r,@PathVariable String id) throws Exception { return Result.success(service.freeze(user(r),id)); }
    @GetMapping("/runs/{id}/artifacts/{index}") public ResponseEntity<byte[]> download(HttpServletRequest r,@PathVariable String id,@PathVariable int index) throws Exception {
        var f=service.artifact(user(r),id,index);
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_DISPOSITION,ContentDisposition.attachment().filename(f.getFileName().toString(), java.nio.charset.StandardCharsets.UTF_8).build().toString()).contentType(MediaType.APPLICATION_OCTET_STREAM).body(Files.readAllBytes(f));
    }
    @GetMapping("/templates") public Result<?> templates(HttpServletRequest r) throws Exception { return Result.success(service.templates(user(r))); }
    @PostMapping("/templates") public Result<?> template(HttpServletRequest r,@RequestBody JSONObject body) throws Exception { return Result.success(service.template(user(r),body)); }
    @DeleteMapping("/templates/{id}") public Result<?> deleteTemplate(HttpServletRequest r,@PathVariable String id) throws Exception { service.deleteTemplate(user(r),id); return Result.success(); }
    @PostMapping("/models/{id}/test") public Result<?> test(@PathVariable Long id) throws Exception { return Result.success(service.testModel(id)); }
    @ExceptionHandler(Exception.class) public ResponseEntity<Result<?>> error(Exception e) {
        return ResponseEntity.badRequest().body(Result.error(e.getMessage()==null?e.getClass().getSimpleName():e.getMessage()));
    }
}
