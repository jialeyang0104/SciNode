package com.scinode.controller;

import com.scinode.common.Result;
import com.scinode.engine.skill.Skill;
import com.scinode.engine.skill.SkillRegistry;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Skill 控制器
 * 提供 Skills 列表和详情 API
 */
@Tag(name = "技能接口")
@RestController
@RequestMapping("/api/skills")
public class SkillController {

    @Autowired
    private SkillRegistry skillRegistry;

    /**
     * 获取所有 Skills 摘要列表
     */
    @Operation(summary = "获取所有技能列表")
    @GetMapping
    public Result<List<SkillRegistry.SkillSummary>> listSkills() {
        List<SkillRegistry.SkillSummary> skills = skillRegistry.getSkillSummaries();
        return Result.success(skills);
    }

    /**
     * 获取指定 Skill 详情
     */
    @Operation(summary = "获取技能详情")
    @GetMapping("/{name}")
    public Result<Skill> getSkill(@PathVariable String name) {
        return skillRegistry.getSkill(name)
                .map(Result::success)
                .orElse(Result.error(404, "Skill not found: " + name));
    }

    /**
     * 获取 Skill 的 reference 文档
     */
    @Operation(summary = "获取技能参考文档")
    @GetMapping("/{skillName}/references/{referenceName}")
    public Result<String> getSkillReference(
            @PathVariable String skillName,
            @PathVariable String referenceName) {
        try {
            String content = skillRegistry.loadReference(skillName, referenceName);
            return Result.success(content);
        } catch (Exception e) {
            return Result.error(404, "Reference not found: " + skillName + "/" + referenceName);
        }
    }
}
