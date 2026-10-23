package com.scinode.controller;

import com.scinode.common.Result;
import com.scinode.dto.KnowledgeBaseRequest;
import com.scinode.dto.KnowledgePreviewRequest;
import com.scinode.dto.KnowledgeSearchRequest;
import com.scinode.dto.KnowledgeTextImportRequest;
import com.scinode.service.KnowledgeBaseService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;

@Tag(name = "知识库管理接口")
@RestController
@RequestMapping("/api/knowledge-bases")
public class KnowledgeBaseController {

    private final KnowledgeBaseService knowledgeBaseService;

    public KnowledgeBaseController(KnowledgeBaseService knowledgeBaseService) {
        this.knowledgeBaseService = knowledgeBaseService;
    }

    @Operation(summary = "查询知识库列表")
    @GetMapping
    public Result<List<Map<String, Object>>> listKnowledgeBases() {
        return Result.success(knowledgeBaseService.listKnowledgeBases());
    }

    @Operation(summary = "创建知识库")
    @PostMapping
    public Result<Map<String, Object>> createKnowledgeBase(@Valid @RequestBody KnowledgeBaseRequest request) {
        return Result.success(knowledgeBaseService.createKnowledgeBase(request));
    }

    @Operation(summary = "获取知识库详情")
    @GetMapping("/{id}")
    public Result<Map<String, Object>> getKnowledgeBase(@PathVariable Long id) {
        return Result.success(knowledgeBaseService.getKnowledgeBase(id));
    }

    @Operation(summary = "删除知识库")
    @DeleteMapping("/{id}")
    public Result<Void> deleteKnowledgeBase(@PathVariable Long id) {
        knowledgeBaseService.deleteKnowledgeBase(id);
        return Result.success();
    }

    @Operation(summary = "导入粘贴文本")
    @PostMapping("/{id}/documents/text")
    public Result<Map<String, Object>> importText(@PathVariable Long id,
                                                  @Valid @RequestBody KnowledgeTextImportRequest request) {
        return Result.success(knowledgeBaseService.importText(id, request));
    }

    @Operation(summary = "上传文本文件")
    @PostMapping("/{id}/documents/upload")
    public Result<Map<String, Object>> uploadText(@PathVariable Long id,
                                                  @RequestParam("file") MultipartFile file) throws Exception {
        return Result.success(knowledgeBaseService.uploadTextFile(id, file));
    }

    @Operation(summary = "查询知识库文档")
    @GetMapping("/{id}/documents")
    public Result<List<Map<String, Object>>> listDocuments(@PathVariable Long id) {
        return Result.success(knowledgeBaseService.listDocuments(id));
    }

    @Operation(summary = "预览文档分片")
    @PostMapping("/{id}/documents/{documentId}/preview-chunks")
    public Result<List<Map<String, Object>>> previewChunks(@PathVariable Long id,
                                                           @PathVariable Long documentId,
                                                           @RequestBody(required = false) KnowledgePreviewRequest request) {
        return Result.success(knowledgeBaseService.previewChunks(id, documentId, request));
    }

    @Operation(summary = "建立文档索引")
    @PostMapping("/{id}/documents/{documentId}/index")
    public Result<Map<String, Object>> indexDocument(@PathVariable Long id,
                                                     @PathVariable Long documentId) {
        return Result.success(knowledgeBaseService.indexDocument(id, documentId));
    }

    @Operation(summary = "检索测试")
    @PostMapping("/{id}/search")
    public Result<Map<String, Object>> search(@PathVariable Long id,
                                              @Valid @RequestBody KnowledgeSearchRequest request) {
        return Result.success(knowledgeBaseService.search(id, request));
    }
}
