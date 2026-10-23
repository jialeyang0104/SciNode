package com.scinode.engine.skill;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Skill 加载器
 * 从文件系统加载 SKILL.md 文件，解析 YAML frontmatter
 */
@Slf4j
@Component
public class SkillLoader {

    private static final Pattern FRONTMATTER_PATTERN = Pattern.compile(
            "^---\\s*\\n([\\s\\S]*?)\\n---\\s*\\n([\\s\\S]*)$"
    );

    private static final String SKILL_FILE_NAME = "SKILL.md";
    private static final String REFERENCE_DIR_NAME = "reference";

    /**
     * 从指定目录加载 Skill
     *
     * @param skillPath Skill 目录路径
     * @return Skill 对象
     * @throws IOException 如果读取文件失败
     */
    public Skill load(Path skillPath) throws IOException {
        Path skillFile = skillPath.resolve(SKILL_FILE_NAME);

        if (!Files.exists(skillFile)) {
            throw new IOException("Skill file not found: " + skillFile);
        }

        String fileContent = Files.readString(skillFile);
        List<String> references = loadReferenceList(skillPath);
        return parseSkill(fileContent, skillPath, references, skillFile.toString());
    }

    /**
     * 从 classpath 资源内容加载 Skill
     *
     * @param fileContent SKILL.md 内容
     * @param references  reference 文件名列表（不含 .md）
     * @param sourceName  资源来源，便于日志定位
     */
    public Skill loadFromContent(String fileContent, List<String> references, String sourceName) throws IOException {
        return parseSkill(fileContent, null, references, sourceName);
    }

    private Skill parseSkill(String fileContent, Path skillPath, List<String> references, String sourceName) throws IOException {
        Matcher matcher = FRONTMATTER_PATTERN.matcher(fileContent);
        if (!matcher.matches()) {
            throw new IOException("Invalid SKILL.md format: missing YAML frontmatter in " + sourceName);
        }

        String frontmatter = matcher.group(1);
        String content = matcher.group(2).trim();
        Map<String, String> metadata = parseFrontmatter(frontmatter);

        String name = metadata.get("name");
        String description = metadata.get("description");
        if (name == null || name.isBlank()) {
            throw new IOException("Skill name is required in frontmatter: " + sourceName);
        }

        List<String> safeReferences = references != null ? references : new ArrayList<>();
        Skill skill = Skill.builder()
                .name(name)
                .description(description != null ? description : "")
                .content(content)
                .skillPath(skillPath)
                .references(safeReferences)
                .build();

        log.info("Loaded skill: {} with {} references", name, safeReferences.size());
        return skill;
    }

    /**
     * 解析 YAML frontmatter（简单实现，支持基本键值对）
     */
    private Map<String, String> parseFrontmatter(String frontmatter) {
        Map<String, String> metadata = new HashMap<>();

        BufferedReader reader = new BufferedReader(new java.io.StringReader(frontmatter));
        try {
            String line;
            while ((line = reader.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty() || line.startsWith("#")) {
                    continue;
                }

                int colonIndex = line.indexOf(':');
                if (colonIndex > 0) {
                    String key = line.substring(0, colonIndex).trim();
                    String value = line.substring(colonIndex + 1).trim();

                    // 移除引号
                    if ((value.startsWith("\"") && value.endsWith("\"")) ||
                        (value.startsWith("'") && value.endsWith("'"))) {
                        value = value.substring(1, value.length() - 1);
                    }

                    metadata.put(key, value);
                }
            }
        } catch (IOException e) {
            log.warn("Failed to parse frontmatter", e);
        }

        return metadata;
    }

    /**
     * 加载 reference 目录下的文件列表
     */
    private List<String> loadReferenceList(Path skillPath) {
        Path referenceDir = skillPath.resolve(REFERENCE_DIR_NAME);

        if (!Files.exists(referenceDir) || !Files.isDirectory(referenceDir)) {
            return new ArrayList<>();
        }

        try {
            return Files.list(referenceDir)
                    .filter(Files::isRegularFile)
                    .filter(p -> p.toString().endsWith(".md"))
                    .map(p -> p.getFileName().toString())
                    .map(name -> name.substring(0, name.length() - 3)) // 移除 .md 后缀
                    .sorted()
                    .collect(Collectors.toList());
        } catch (IOException e) {
            log.warn("Failed to list reference files in {}", referenceDir, e);
            return new ArrayList<>();
        }
    }

    /**
     * 加载指定的 reference 文件内容
     *
     * @param skillPath     Skill 目录路径
     * @param referenceName reference 文件名（不含 .md 后缀）
     * @return reference 文件内容
     * @throws IOException 如果读取文件失败
     */
    public String loadReference(Path skillPath, String referenceName) throws IOException {
        if (skillPath == null) {
            throw new IOException("Skill path is not available");
        }

        Path referenceDir = skillPath.resolve(REFERENCE_DIR_NAME).normalize();
        Path referenceFile = referenceDir.resolve(referenceName + ".md").normalize();

        if (!referenceFile.startsWith(referenceDir)) {
            throw new IOException("Invalid reference path: " + referenceName);
        }

        if (!Files.exists(referenceFile) || !Files.isRegularFile(referenceFile)) {
            throw new IOException("Reference file not found: " + referenceFile);
        }

        return Files.readString(referenceFile);
    }
}
