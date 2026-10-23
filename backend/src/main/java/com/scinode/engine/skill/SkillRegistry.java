package com.scinode.engine.skill;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Skill 注册中心
 * 管理所有 Skills，提供查找功能
 */
@Slf4j
@Component
public class SkillRegistry {

    private final Map<String, Skill> skills = new ConcurrentHashMap<>();
    private final Map<String, Map<String, String>> referenceCache = new ConcurrentHashMap<>();
    private static final Pattern SAFE_REFERENCE_NAME = Pattern.compile("^[a-zA-Z0-9._-]+$");

    private final SkillLoader skillLoader;

    @Value("${scinode.skills.path:skills}")
    private String skillsPath;

    public SkillRegistry(SkillLoader skillLoader) {
        this.skillLoader = skillLoader;
    }

    /**
     * 应用启动时加载所有 Skills
     */
    @PostConstruct
    public void init() {
        log.info("Loading skills from path: {}", skillsPath);

        int classpathLoaded = loadFromClasspath();
        if (classpathLoaded > 0) {
            log.info("Loaded {} skills from classpath", classpathLoaded);
            return;
        }

        if (classpathLoaded == 0) {
            log.warn("No skills loaded from classpath, fallback to file system");
        }

        loadFromFileSystem();
    }

    private int loadFromClasspath() {
        try {
            PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
            Resource[] resources = resolver.getResources("classpath*:" + skillsPath + "/*/SKILL.md");

            if (resources.length == 0) {
                log.debug("No classpath skill resources found");
                return 0;
            }

            int loaded = 0;
            for (Resource resource : resources) {
                try {
                    String skillDirName = extractSkillDirName(resource);
                    Map<String, String> references = loadClasspathReferences(resolver, skillDirName);
                    Skill skill = skillLoader.loadFromContent(
                            readResource(resource),
                            new ArrayList<>(references.keySet()),
                            resource.getDescription()
                    );
                    register(skill);
                    if (!references.isEmpty()) {
                        referenceCache.put(skill.getName(), new ConcurrentHashMap<>(references));
                    }
                    loaded++;
                } catch (Exception e) {
                    log.warn("Failed to load skill from {}: {}", resource.getDescription(), e.getMessage());
                }
            }

            if (loaded == 0) {
                log.warn("Found {} classpath skill resources but loaded 0", resources.length);
            }
            return loaded;
        } catch (IOException e) {
            log.debug("No skills found in classpath: {}", e.getMessage());
            return 0;
        }
    }

    private void loadFromFileSystem() {
        Path skillsDir = getSkillsPath();
        log.info("Trying to load skills from file system: {}", skillsDir.toAbsolutePath());

        if (!Files.exists(skillsDir)) {
            log.warn("Skills directory not found: {}", skillsDir.toAbsolutePath());
            return;
        }

        try {
            List<Path> skillDirs = Files.list(skillsDir)
                    .filter(Files::isDirectory)
                    .collect(Collectors.toList());

            for (Path skillDir : skillDirs) {
                try {
                    Skill skill = skillLoader.load(skillDir);
                    register(skill);
                } catch (IOException e) {
                    log.warn("Failed to load skill from {}: {}", skillDir, e.getMessage());
                }
            }

            log.info("Loaded {} skills from file system", skills.size());
        } catch (IOException e) {
            log.error("Failed to list skills directory", e);
        }
    }

    private String readResource(Resource resource) throws IOException {
        try (var inputStream = resource.getInputStream()) {
            return new String(inputStream.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private String extractSkillDirName(Resource resource) throws IOException {
        String path = resource.getURL().toString().replace('\\', '/');
        Pattern pattern = Pattern.compile(".*/" + Pattern.quote(skillsPath) + "/([^/]+)/SKILL\\.md(?:\\]|$)");
        Matcher matcher = pattern.matcher(path);
        if (matcher.find()) {
            return matcher.group(1);
        }
        throw new IOException("Unable to resolve skill directory from resource URL: " + path);
    }

    private Map<String, String> loadClasspathReferences(PathMatchingResourcePatternResolver resolver, String skillDirName) {
        Map<String, String> references = new HashMap<>();
        String pattern = "classpath*:" + skillsPath + "/" + skillDirName + "/reference/*.md";

        try {
            Resource[] referenceResources = resolver.getResources(pattern);
            for (Resource referenceResource : referenceResources) {
                String fileName = referenceResource.getFilename();
                if (fileName == null || !fileName.endsWith(".md")) {
                    continue;
                }
                String referenceName = fileName.substring(0, fileName.length() - 3);
                references.put(referenceName, readResource(referenceResource));
            }
        } catch (Exception e) {
            log.warn("Failed to load classpath references for {}: {}", skillDirName, e.getMessage());
        }

        return references;
    }

    /**
     * 获取 Skills 目录路径
     */
    private Path getSkillsPath() {
        Path path = Paths.get(skillsPath);

        // 如果是相对路径，尝试从当前目录或 classpath 查找
        if (!path.isAbsolute()) {
            // 首先尝试当前工作目录
            Path cwdPath = Paths.get(System.getProperty("user.dir")).resolve(skillsPath);
            if (Files.exists(cwdPath)) {
                return cwdPath;
            }

            // 然后尝试 backend/src/main/resources
            Path resourcesPath = Paths.get("backend/src/main/resources").resolve(skillsPath);
            if (Files.exists(resourcesPath)) {
                return resourcesPath;
            }

            // 最后尝试 src/main/resources（如果在 backend 目录下运行）
            Path altResourcesPath = Paths.get("src/main/resources").resolve(skillsPath);
            if (Files.exists(altResourcesPath)) {
                return altResourcesPath;
            }
        }

        return path;
    }

    /**
     * 注册一个 Skill
     */
    public void register(Skill skill) {
        skills.put(skill.getName(), skill);
        log.debug("Registered skill: {}", skill.getName());
    }

    /**
     * 根据名称获取 Skill
     */
    public Optional<Skill> getSkill(String name) {
        return Optional.ofNullable(skills.get(name));
    }

    /**
     * 获取所有已注册的 Skills
     */
    public List<Skill> getAllSkills() {
        return Collections.unmodifiableList(List.copyOf(skills.values()));
    }

    /**
     * 获取所有 Skill 的摘要信息（用于列表展示）
     */
    public List<SkillSummary> getSkillSummaries() {
        return skills.values().stream()
                .map(skill -> new SkillSummary(skill.getName(), skill.getDescription()))
                .sorted((a, b) -> a.name().compareTo(b.name()))
                .collect(Collectors.toList());
    }

    /**
     * 检查 Skill 是否存在
     */
    public boolean hasSkill(String name) {
        return skills.containsKey(name);
    }

    /**
     * 加载指定 Skill 的 reference 文件
     *
     * @param skillName     Skill 名称
     * @param referenceName reference 文件名
     * @return reference 文件内容
     * @throws IOException 如果加载失败
     */
    public String loadReference(String skillName, String referenceName) throws IOException {
        Skill skill = skills.get(skillName);
        if (skill == null) {
            throw new IOException("Skill not found: " + skillName);
        }

        if (referenceName == null || referenceName.isBlank()) {
            throw new IOException("Reference name is required");
        }
        if (!SAFE_REFERENCE_NAME.matcher(referenceName).matches()) {
            throw new IOException("Invalid reference name: " + referenceName);
        }

        List<String> availableReferences = skill.getReferences();
        if (availableReferences == null || !availableReferences.contains(referenceName)) {
            throw new IOException("Reference not found in skill: " + referenceName);
        }

        Map<String, String> cachedReferences = referenceCache.get(skillName);
        if (cachedReferences != null && cachedReferences.containsKey(referenceName)) {
            return cachedReferences.get(referenceName);
        }

        String content = skillLoader.loadReference(skill.getSkillPath(), referenceName);
        referenceCache
                .computeIfAbsent(skillName, key -> new ConcurrentHashMap<>())
                .put(referenceName, content);
        return content;
    }

    /**
     * 加载指定 Skill 的所有 reference 文件
     *
     * @param skillName Skill 名称
     * @return reference 文件名 -> 内容的映射
     */
    public Map<String, String> loadAllReferences(String skillName) {
        Skill skill = skills.get(skillName);
        if (skill == null) {
            log.warn("Skill not found: {}", skillName);
            return Collections.emptyMap();
        }

        Map<String, String> cachedReferences = referenceCache.get(skillName);
        if (cachedReferences != null && !cachedReferences.isEmpty()) {
            return new HashMap<>(cachedReferences);
        }

        Map<String, String> references = new HashMap<>();
        List<String> refNames = skill.getReferences();

        if (refNames == null || refNames.isEmpty()) {
            return references;
        }

        for (String refName : refNames) {
            try {
                String content = loadReference(skillName, refName);
                references.put(refName, content);
                log.debug("Loaded reference: {} for skill: {}", refName, skillName);
            } catch (IOException e) {
                log.warn("Failed to load reference {} for skill {}: {}", refName, skillName, e.getMessage());
            }
        }

        if (!references.isEmpty()) {
            referenceCache.put(skillName, new ConcurrentHashMap<>(references));
        }

        log.info("Loaded {} references for skill: {}", references.size(), skillName);
        return references;
    }

    /**
     * Skill 摘要记录
     */
    public record SkillSummary(String name, String description) {}
}
