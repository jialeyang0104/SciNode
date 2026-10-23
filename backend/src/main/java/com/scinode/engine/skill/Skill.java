package com.scinode.engine.skill;

import lombok.Builder;
import lombok.Data;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

/**
 * Skill 模型类
 * 代表一个预置的最佳实践指南
 */
@Data
@Builder
public class Skill {

    /**
     * Skill 名称（从 YAML frontmatter 解析）
     */
    private String name;

    /**
     * Skill 描述（从 YAML frontmatter 解析）
     */
    private String description;

    /**
     * SKILL.md 主体内容（不包含 frontmatter）
     */
    private String content;

    /**
     * Skill 目录路径
     */
    private Path skillPath;

    /**
     * 可用的 reference 文件列表
     */
    private List<String> references;

    /**
     * 获取 Skill 摘要信息（用于系统提示）
     * 直接提供完整内容，让 LLM 立即执行任务
     */
    public String getSummary() {
        StringBuilder sb = new StringBuilder();
        sb.append("# 技能: ").append(name).append("\n\n");
        sb.append(description).append("\n\n");
        sb.append("---\n\n");
        sb.append("## 技能指南\n\n");
        sb.append(content).append("\n\n");

        if (references != null && !references.isEmpty()) {
            sb.append("## 可用参考文档\n");
            sb.append("调用 load_skill_reference 函数获取：\n");
            for (String ref : references) {
                sb.append("- ").append(ref).append("\n");
            }
        }

        return sb.toString();
    }

    /**
     * 获取完整内容（包含主体内容和 reference 列表）
     */
    public String getFullContent() {
        StringBuilder sb = new StringBuilder();
        sb.append("# ").append(name).append("\n\n");
        sb.append(content).append("\n\n");

        if (references != null && !references.isEmpty()) {
            sb.append("## 可用的参考文档\n");
            for (String ref : references) {
                sb.append("- ").append(ref).append("\n");
            }
            sb.append("\n调用 load_skill_reference 函数获取详细内容。\n");
        }

        return sb.toString();
    }

    /**
     * 获取完整的执行 Prompt（包含所有 references 内容）
     * 直接打包所有内容，无需 LLM 再调用函数
     *
     * @param referenceContents reference 文件名 -> 内容的映射
     */
    public String getFullExecutionPrompt(Map<String, String> referenceContents) {
        StringBuilder sb = new StringBuilder();
        sb.append("# 技能: ").append(name).append("\n\n");
        sb.append(description).append("\n\n");
        sb.append("---\n\n");
        sb.append("## 技能指南\n\n");
        sb.append(content).append("\n\n");

        // 直接嵌入所有 reference 内容
        if (referenceContents != null && !referenceContents.isEmpty()) {
            sb.append("## 参考文档\n\n");
            for (Map.Entry<String, String> entry : referenceContents.entrySet()) {
                sb.append("### ").append(entry.getKey()).append("\n\n");
                sb.append(entry.getValue()).append("\n\n");
            }
        }

        return sb.toString();
    }
}
