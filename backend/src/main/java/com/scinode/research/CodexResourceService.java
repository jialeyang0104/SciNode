package com.scinode.research;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.scinode.engine.skill.Skill;
import com.scinode.engine.skill.SkillRegistry;
import com.scinode.entity.McpToolConfig;
import com.scinode.service.McpToolConfigService;
import com.scinode.service.SearchInfinityMcpClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.tomlj.Toml;
import org.tomlj.TomlArray;
import org.tomlj.TomlParseResult;
import org.tomlj.TomlTable;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** User-scoped, read-only import of Codex skills and MCP definitions. */
@Service
public class CodexResourceService {
    private static final Pattern SAFE_FOLDER = Pattern.compile("[A-Za-z0-9._-]{1,128}");
    private static final Pattern MARKDOWN_LINK = Pattern.compile("\\[[^]]*]\\(([^)]+)\\)");
    private static final Pattern SECRET_TOKEN = Pattern.compile("(?i)\\b(?:sk-[a-z0-9_-]{8,}|gh[pousr]_[a-z0-9]{12,}|xox[baprs]-[a-z0-9-]{12,}|Bearer\\s+[A-Za-z0-9._~+/-]+=*)\\b");
    private static final Pattern SECRET_ASSIGNMENT = Pattern.compile("(?i)(\\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization)\\b\\s*[:=]\\s*)([^\\s,;]+)");
    private static final Pattern PRIVATE_PATH = Pattern.compile("(?<![A-Za-z0-9])(?:/(?:Users|Volumes|private|tmp|var|home|mnt|opt|srv)/[^\\s\\\"'<>]+|[A-Za-z]:\\\\Users\\\\[^\\s\\\"'<>]+)");
    private static final int SKILL_FILE_LIMIT = 100_000;
    private static final int SKILL_TOTAL_LIMIT = 500_000;
    private static final int MCP_RESULT_LIMIT = 60_000;

    private final ResearchStore store;
    private final ResearchService research;
    private final ResearchPreferences preferences;
    private final SkillRegistry builtins;
    private final McpToolConfigService scinodeMcp;
    private final SearchInfinityMcpClient mcpClient;
    private final String configuredCodexHome;

    public CodexResourceService(ResearchStore store, ResearchService research, ResearchPreferences preferences,
                                SkillRegistry builtins, McpToolConfigService scinodeMcp,
                                SearchInfinityMcpClient mcpClient,
                                @Value("${scinode.codex-home:}") String configuredCodexHome) {
        this.store = store;
        this.research = research;
        this.preferences = preferences;
        this.builtins = builtins;
        this.scinodeMcp = scinodeMcp;
        this.mcpClient = mcpClient;
        this.configuredCodexHome = configuredCodexHome;
    }

    public JSONObject status(String user) throws IOException {
        Path links = linksDirectory(user);
        Path skillLink = links.resolve("skills"), configLink = links.resolve("config.toml");
        List<String> warnings = new ArrayList<>();
        boolean skillsLinked = Files.isSymbolicLink(skillLink);
        boolean configLinked = Files.isSymbolicLink(configLink);
        if (!skillsLinked || !configLinked) warnings.add("Codex 尚未完整链接到当前 SciNode 账户");
        Path home = linkedHome(skillLink, configLink);
        if (skillsLinked && !Files.isDirectory(skillLink)) warnings.add("Codex skills 链接目标当前不可用");
        if (configLinked && !Files.isRegularFile(configLink)) warnings.add("Codex config.toml 链接目标当前不可用");
        int skillCount = skillsLinked && Files.isDirectory(skillLink) ? codexSkillFolders(skillLink).size() : 0;
        int mcpCount = 0;
        if (configLinked && Files.isRegularFile(configLink)) {
            try {
                List<CodexServer> servers = codexServers(configLink);
                mcpCount = servers.size();
                warnings.addAll(serverWarnings(servers));
            } catch (Exception error) {
                warnings.add("Codex config.toml 解析失败");
            }
        }
        JSONObject result = new JSONObject();
        result.put("linked", skillsLinked && configLinked && Files.isDirectory(skillLink) && Files.isRegularFile(configLink));
        result.put("codexHome", home == null ? defaultCodexHome().toString() : home.toString());
        result.put("skillsCount", skillCount);
        result.put("mcpCount", mcpCount);
        result.put("warnings", new JSONArray(warnings.stream().distinct().toList()));
        return result;
    }

    public JSONObject link(String user, String requestedHome) throws IOException {
        String requested = requestedHome == null || requestedHome.isBlank() ? configuredHome() : requestedHome.trim();
        Path home;
        try { home = Path.of(requested).toAbsolutePath().normalize().toRealPath(); }
        catch (IOException error) { throw new IllegalArgumentException("Codex Home 目录不存在或无法读取", error); }
        Path sourceConfig = home.resolve("config.toml"), sourceSkills = home.resolve("skills");
        if (!Files.isRegularFile(sourceConfig) || !Files.isDirectory(sourceSkills)) {
            throw new IllegalArgumentException("Codex Home 应包含可读取的 config.toml 与 skills 目录");
        }
        // Parse before creating links so malformed source files never produce a misleading linked status.
        codexServers(sourceConfig);
        Path links = linksDirectory(user);
        Files.createDirectories(links);
        restrictPrivate(links);
        Path skillLink = links.resolve("skills"), configLink = links.resolve("config.toml");
        boolean madeSkills = false, madeConfig = false;
        try {
            madeSkills = ensureLink(skillLink, sourceSkills.toRealPath());
            madeConfig = ensureLink(configLink, sourceConfig.toRealPath());
        } catch (IOException error) {
            if (madeConfig) Files.deleteIfExists(configLink);
            if (madeSkills) Files.deleteIfExists(skillLink);
            throw error;
        }
        return status(user);
    }

    public JSONObject unlink(String user) throws IOException {
        Path links = linksDirectory(user);
        Path skillLink = links.resolve("skills"), configLink = links.resolve("config.toml");
        boolean found = false;
        for (Path path : List.of(skillLink, configLink)) {
            if (Files.exists(path, LinkOption.NOFOLLOW_LINKS)) {
                if (!Files.isSymbolicLink(path)) throw new IllegalStateException("拒绝删除 SciNode 链接目录中的非符号链接: " + path.getFileName());
                Files.delete(path);
                found = true;
            }
        }
        if (!found) throw new IllegalArgumentException("当前账户尚未创建 Codex 资源链接");
        try { Files.deleteIfExists(links); } catch (java.nio.file.DirectoryNotEmptyException ignored) { }
        JSONObject result = status(user);
        result.put("unlinked", true);
        return result;
    }

    public JSONObject resources(String user, String projectId) throws IOException {
        JSONArray skills = new JSONArray();
        builtins.getAllSkills().stream().sorted(Comparator.comparing(Skill::getName)).forEach(skill -> {
            JSONObject item = new JSONObject(); item.put("id", "builtin:" + skill.getName());
            item.put("name", skill.getName()); item.put("description", Objects.toString(skill.getDescription(), "")); item.put("source", "builtin");
            skills.add(item);
        });
        Path skillRoot = skillLink(user);
        if (skillRoot != null) for (Path folder : codexSkillFolders(skillRoot)) {
            SkillMetadata metadata = skillMetadata(folder);
            JSONObject item = new JSONObject(); item.put("id", "codex:" + skillIdentifier(skillRoot, folder));
            item.put("name", metadata.name()); item.put("description", metadata.description()); item.put("source", "codex");
            skills.add(item);
        }
        JSONArray mcp = new JSONArray();
        Path config = configLink(user);
        if (config != null) for (CodexServer server : codexServers(config)) mcp.add(codexMcpSummary(server));
        for (McpToolConfig entry : authorizedScinodeMcp(user, projectId)) mcp.add(scinodeMcpSummary(entry));
        JSONObject result = new JSONObject(); result.put("skills", skills); result.put("mcp", mcp); return result;
    }

    public String skillContent(String user, String resourceId, String projectId) throws IOException {
        if (resourceId == null || resourceId.isBlank()) throw new IllegalArgumentException("请提供 Skill 资源 ID");
        if (resourceId.startsWith("builtin:")) {
            String name = resourceId.substring("builtin:".length());
            Skill skill = builtins.getSkill(name).orElseThrow(() -> new IllegalArgumentException("内置 Skill 不存在"));
            Map<String, String> references = new LinkedHashMap<>();
            if (skill.getReferences() != null) for (String reference : skill.getReferences()) {
                references.put(reference, builtins.loadReference(name, reference));
            }
            return skill.getFullExecutionPrompt(references);
        }
        if (!resourceId.startsWith("codex:")) throw new IllegalArgumentException("Skill 资源 ID 格式错误");
        String folderName = resourceId.substring("codex:".length());
        if (!safeSkillIdentifier(folderName)) throw new IllegalArgumentException("Codex Skill 目录名格式错误");
        Path root = skillLink(user);
        if (root == null) throw new IllegalArgumentException("请先链接当前账户的 Codex Home");
        Path rootReal = root.toRealPath(), folder = root.resolve(folderName).normalize();
        Path relative = root.normalize().relativize(folder);
        if (relative.isAbsolute() || relative.startsWith("..") || relative.getNameCount() > 2 ||
                (relative.getNameCount() == 2 && !".system".equals(relative.getName(0).toString())) || !Files.isDirectory(folder))
            throw new IllegalArgumentException("Codex Skill 不存在或当前账户无访问权限");
        Path folderReal = folder.toRealPath();
        if (!folderReal.startsWith(rootReal)) throw new IllegalArgumentException("Codex Skill 目录超出 Codex skills 根目录");
        Path main = safeSkillFile(folderReal, Path.of("SKILL.md"));
        String content = readBounded(main, SKILL_FILE_LIMIT);
        LinkedHashSet<String> references = markdownReferences(content);
        Path referenceDir = folderReal.resolve("references");
        if (Files.isDirectory(referenceDir)) {
            try (var files = Files.list(referenceDir)) {
                files.filter(Files::isRegularFile).filter(path -> path.getFileName().toString().endsWith(".md"))
                        .map(path -> "references/" + path.getFileName()).sorted().forEach(references::add);
            }
        }
        int total = content.length();
        StringBuilder assembled = new StringBuilder(content);
        for (String reference : references) {
            Path referenceFile = safeSkillFile(folderReal, Path.of(reference));
            String text = readBounded(referenceFile, SKILL_FILE_LIMIT);
            total += text.length();
            if (total > SKILL_TOTAL_LIMIT) throw new IllegalArgumentException("Codex Skill 与引用总长度超过500000字符");
            assembled.append("\n\n## 参考文件：").append(reference).append("\n\n").append(text);
        }
        return assembled.toString();
    }

    public JSONObject inspectMcp(String user, String resourceId, String projectId) throws IOException {
        McpHandle handle = requireMcp(user, resourceId, projectId);
        JSONObject raw;
        try { raw = mcpClient.inspectConfiguredTools(handle.config()); }
        catch (IOException error) { throw new IOException(redact(error.getMessage(), handle.secrets()), error); }
        JSONArray found = raw.getJSONArray("tools"), safeTools = new JSONArray();
        if (found != null) for (int i = 0; i < found.size(); i++) {
            JSONObject tool = found.getJSONObject(i); if (tool == null) continue;
            JSONObject safe = new JSONObject(); safe.put("name", tool.getString("name"));
            if (tool.getString("description") != null) safe.put("description", tool.getString("description"));
            if (tool.getJSONObject("inputSchema") != null) safe.put("inputSchema", tool.getJSONObject("inputSchema"));
            safeTools.add(sanitize(safe, handle.secrets()));
        }
        return new JSONObject(Map.of("tools", safeTools));
    }

    public JSONObject callMcp(String user, String resourceId, String toolName, JSONObject arguments, String projectId) throws IOException {
        if (toolName == null || toolName.isBlank()) throw new IllegalArgumentException("请提供 MCP 工具名");
        if (arguments == null) throw new IllegalArgumentException("MCP 参数需要 JSON 对象");
        McpHandle handle = requireMcp(user, resourceId, projectId);
        JSONObject listed;
        try { listed = mcpClient.inspectConfiguredTools(handle.config()); }
        catch (IOException error) { throw new IOException(redact(error.getMessage(), handle.secrets()), error); }
        JSONObject schema = findToolSchema(listed, toolName);
        validateRequiredArguments(schema, arguments);
        handle.config().setToolName(toolName);
        Map<String, Object> raw;
        try { raw = mcpClient.callConfiguredTool(handle.config(), arguments); }
        catch (IOException error) { throw new IOException(redact(error.getMessage(), handle.secrets()), error); }
        JSONObject safeResult = sanitize(JSON.parseObject(JSON.toJSONString(raw)), handle.secrets());
        String text = safeResult.getString("text");
        String id = UUID.randomUUID().toString();
        JSONObject record = new JSONObject(); record.put("id", id); record.put("resourceId", resourceId); record.put("toolName", toolName);
        record.put("text", text == null ? "" : text); record.put("result", safeResult); record.put("updatedAt", Instant.now().toString());
        store.write(user, "assistant-tools", record);
        return record;
    }

    public String toolResultContent(String user, List<String> ids) throws IOException {
        if (ids == null || ids.isEmpty()) return "";
        if (ids.size() > 5) throw new IllegalArgumentException("每次对话最多加入5项 MCP 结果");
        StringBuilder material = new StringBuilder(); Set<String> unique = new LinkedHashSet<>();
        for (String id : ids) {
            if (id == null || !id.matches("[0-9a-fA-F-]{36}") || !unique.add(id)) throw new IllegalArgumentException("MCP 结果 ID 格式错误或重复");
            JSONObject record = store.read(user, "assistant-tools", id);
            String item = "\n\n[MCP 结果 " + record.getString("resourceId") + " / " + record.getString("toolName") + "]\n"
                    + Objects.toString(record.getString("text"), "") + "\n结构化结果：" + JSON.toJSONString(record.get("result"));
            if (material.length() + item.length() > MCP_RESULT_LIMIT) throw new IllegalArgumentException("加入对话的 MCP 结果总长度超过60000字符");
            material.append(item);
        }
        return material.toString();
    }

    private McpHandle requireMcp(String user, String resourceId, String projectId) throws IOException {
        if (resourceId == null || resourceId.isBlank()) throw new IllegalArgumentException("请提供 MCP 资源 ID");
        if (resourceId.startsWith("codex:")) {
            String name = resourceId.substring("codex:".length());
            CodexServer server = codexServersRequired(user).stream().filter(item -> item.name().equals(name)).findFirst()
                    .orElseThrow(() -> new IllegalArgumentException("Codex MCP 不存在或当前账户无访问权限"));
            if (!server.enabled()) throw new IllegalArgumentException("Codex MCP 已停用");
            if (server.url() != null) throw new IllegalArgumentException("当前仅支持 stdio MCP；此服务器为 HTTP transport");
            if (server.cwd() != null && !server.cwd().isBlank()) throw new IllegalArgumentException("当前 MCP 客户端不支持 Codex cwd，请清空 cwd 后重试");
            if (server.command() == null || server.command().isBlank()) throw new IllegalArgumentException("Codex stdio MCP 缺少 command");
            McpToolConfig config = new McpToolConfig(); config.setName(server.name()); config.setTransport("stdio"); config.setCommand(server.command());
            config.setArgs(JSON.toJSONString(server.args()));
            Map<String, String> env = new LinkedHashMap<>(server.env());
            for (String nameVar : server.envVars()) {
                String value = System.getenv(nameVar);
                if (value == null) throw new IllegalArgumentException("Codex MCP 所需环境变量未设置: " + nameVar);
                env.put(nameVar, value);
            }
            config.setEnv(JSON.toJSONString(env));
            return new McpHandle(resourceId, config, secretValues(env));
        }
        if (!resourceId.startsWith("scinode:")) throw new IllegalArgumentException("MCP 资源 ID 格式错误");
        long id;
        try { id = Long.parseLong(resourceId.substring("scinode:".length())); }
        catch (NumberFormatException error) { throw new IllegalArgumentException("SciNode MCP ID 格式错误"); }
        McpToolConfig entry = authorizedScinodeMcp(user, projectId).stream().filter(item -> Objects.equals(item.getId(), id)).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("SciNode MCP 尚未在当前项目或全局范围授权并启用"));
        if (!"stdio".equalsIgnoreCase(entry.getTransport())) throw new IllegalArgumentException("当前仅支持 stdio MCP；此服务器传输方式为 " + entry.getTransport());
        McpToolConfig config = copyConfig(entry);
        Map<String, String> env = scinodeMcp.parseEnv(entry);
        return new McpHandle(resourceId, config, secretValues(env));
    }

    private JSONObject findToolSchema(JSONObject response, String toolName) {
        JSONArray tools = response == null ? null : response.getJSONArray("tools");
        if (tools != null) for (int i = 0; i < tools.size(); i++) {
            JSONObject tool = tools.getJSONObject(i);
            if (tool != null && toolName.equals(tool.getString("name"))) return tool.getJSONObject("inputSchema");
        }
        throw new IllegalArgumentException("所选 MCP 工具不在服务器当前 tools/list 中");
    }

    private void validateRequiredArguments(JSONObject schema, JSONObject args) {
        JSONArray required = schema == null ? null : schema.getJSONArray("required");
        if (required == null) return;
        for (Object field : required) {
            String name = Objects.toString(field, "");
            if (name.isBlank() || !args.containsKey(name) || args.get(name) == null) throw new IllegalArgumentException("MCP 参数缺少必需字段: " + name);
        }
    }

    private List<McpToolConfig> authorizedScinodeMcp(String user, String projectId) throws IOException {
        LinkedHashSet<Long> ids = new LinkedHashSet<>();
        JSONObject global = preferences.global(user);
        JSONObject local = null;
        if (projectId != null && !projectId.isBlank()) {
            JSONObject project = research.project(user, projectId);
            local = project.getJSONObject("settings");
        }
        if (local == null || !Boolean.FALSE.equals(local.getBoolean("inheritGlobal"))) addIds(ids, global.getJSONArray("mcpIds"));
        if (local != null) addIds(ids, local.getJSONArray("mcpIds"));
        List<McpToolConfig> result = new ArrayList<>();
        for (Long id : ids) {
            try {
                McpToolConfig config = scinodeMcp.requireConfig(id);
                if (Integer.valueOf(1).equals(config.getEnabled())) result.add(config);
            } catch (IllegalArgumentException ignored) {
                // A removed authorized item disappears from the live catalog; no stored setting is rewritten.
            }
        }
        return result;
    }

    private void addIds(Set<Long> ids, JSONArray values) {
        if (values == null) return;
        for (Object value : values) {
            try { long id = Long.parseLong(value.toString()); if (id > 0) ids.add(id); }
            catch (RuntimeException error) { throw new IllegalArgumentException("MCP 授权设置包含无效 ID"); }
        }
    }

    private JSONObject codexMcpSummary(CodexServer server) {
        String transport = server.url() == null ? "stdio" : "http";
        String state = !server.enabled() ? "disabled" : server.url() != null ? "unsupported" :
                server.cwd() != null && !server.cwd().isBlank() ? "unsupported" :
                        server.command() == null || server.command().isBlank() ? "invalid" : "ready";
        return new JSONObject(Map.of("id", "codex:" + server.name(), "name", server.name(), "source", "codex",
                "enabled", server.enabled(), "transport", transport, "status", state));
    }

    private JSONObject scinodeMcpSummary(McpToolConfig config) {
        String transport = Objects.toString(config.getTransport(), "stdio").toLowerCase();
        String state = "stdio".equals(transport) ? "ready" : "unsupported";
        JSONObject item = new JSONObject(); item.put("id", "scinode:" + config.getId()); item.put("name", config.getName());
        item.put("source", "scinode"); item.put("enabled", true); item.put("transport", transport); item.put("status", state); return item;
    }

    private McpToolConfig copyConfig(McpToolConfig source) {
        McpToolConfig result = new McpToolConfig(); result.setId(source.getId()); result.setName(source.getName()); result.setDescription(source.getDescription());
        result.setToolType(source.getToolType()); result.setToolName(source.getToolName()); result.setTransport(source.getTransport()); result.setCommand(source.getCommand());
        result.setArgs(source.getArgs()); result.setEnv(source.getEnv()); result.setEnabled(source.getEnabled()); result.setPreset(source.getPreset()); return result;
    }

    private List<CodexServer> codexServersRequired(String user) throws IOException {
        Path config = configLink(user); if (config == null) throw new IllegalArgumentException("请先链接当前账户的 Codex Home"); return codexServers(config);
    }

    private List<CodexServer> codexServers(Path configPath) throws IOException {
        TomlParseResult parsed = Toml.parse(configPath);
        if (parsed.hasErrors()) throw new IllegalArgumentException("Codex config.toml 格式错误，请检查 TOML 语法");
        TomlTable table = parsed.getTable("mcp_servers"); if (table == null) return List.of();
        List<CodexServer> servers = new ArrayList<>();
        for (String name : table.keySet()) {
            TomlTable entry = table.getTable(name); if (entry == null) continue;
            requireTomlType(entry, "command", !entry.contains("command") || entry.isString("command"), "字符串");
            requireTomlType(entry, "url", !entry.contains("url") || entry.isString("url"), "字符串");
            requireTomlType(entry, "cwd", !entry.contains("cwd") || entry.isString("cwd"), "字符串");
            requireTomlType(entry, "enabled", !entry.contains("enabled") || entry.isBoolean("enabled"), "布尔值");
            requireTomlType(entry, "args", !entry.contains("args") || (entry.isArray("args") && isStringArray(entry.getArray("args"))), "字符串数组");
            requireTomlType(entry, "env_vars", !entry.contains("env_vars") || (entry.isArray("env_vars") && isStringArray(entry.getArray("env_vars"))), "字符串数组");
            String command = entry.getString("command"), url = entry.getString("url"), cwd = entry.getString("cwd");
            boolean enabled = !Boolean.FALSE.equals(entry.getBoolean("enabled"));
            List<String> args = tomlStrings(entry.getArray("args"));
            List<String> envVars = tomlStrings(entry.getArray("env_vars"));
            Map<String, String> env = new LinkedHashMap<>(); TomlTable envTable = entry.getTable("env");
            if (entry.contains("env") && envTable == null) throw new IllegalArgumentException("Codex MCP env 应为 TOML 表");
            if (envTable != null) for (String key : envTable.keySet()) {
                if (!envTable.isString(key)) throw new IllegalArgumentException("Codex MCP env 值应为字符串");
                env.put(key, envTable.getString(key));
            }
            servers.add(new CodexServer(name, command, args, env, envVars, enabled, cwd, url));
        }
        servers.sort(Comparator.comparing(CodexServer::name)); return servers;
    }

    private List<String> tomlStrings(TomlArray values) {
        if (values == null) return List.of(); List<String> result = new ArrayList<>();
        for (int i = 0; i < values.size(); i++) { String value = values.getString(i); if (value == null) throw new IllegalArgumentException("Codex MCP args/env_vars 应为字符串数组"); result.add(value); }
        return List.copyOf(result);
    }

    private void requireTomlType(TomlTable table, String key, boolean valid, String expected) {
        if (!valid) throw new IllegalArgumentException("Codex MCP " + key + " 应为" + expected);
    }

    private boolean isStringArray(TomlArray values) {
        for (int i = 0; i < values.size(); i++) if (!(values.get(i) instanceof String)) return false;
        return true;
    }

    private List<String> serverWarnings(List<CodexServer> servers) {
        List<String> warnings = new ArrayList<>();
        for (CodexServer server : servers) {
            if (server.url() != null && server.enabled()) warnings.add("Codex HTTP MCP 当前列入目录但暂不支持执行: " + server.name());
            else if (server.cwd() != null && !server.cwd().isBlank() && server.enabled()) warnings.add("Codex MCP 使用 cwd；当前 MCP 客户端不支持 cwd: " + server.name());
            else if (server.command() == null && server.url() == null && server.enabled()) warnings.add("Codex stdio MCP 缺少 command: " + server.name());
        }
        return warnings;
    }

    private List<Path> codexSkillFolders(Path root) throws IOException {
        if (!Files.isDirectory(root)) return List.of(); Path rootReal = root.toRealPath();
        List<Path> candidates = new ArrayList<>();
        try (var children = Files.list(root)) {
            for (Path child : children.toList()) {
                if (!SAFE_FOLDER.matcher(child.getFileName().toString()).matches() || !Files.isDirectory(child)) continue;
                if (".system".equals(child.getFileName().toString())) {
                    try (var official = Files.list(child)) {
                        for (Path nested : official.toList()) if (SAFE_FOLDER.matcher(nested.getFileName().toString()).matches() && Files.isDirectory(nested)) candidates.add(nested);
                    }
                } else candidates.add(child);
            }
        }
        return candidates.stream().filter(folder -> {
            try { Path real = folder.toRealPath(); return real.startsWith(rootReal) && Files.isRegularFile(safeSkillFile(real, Path.of("SKILL.md"))); }
            catch (Exception error) { return false; }
        }).sorted(Comparator.comparing(folder -> skillIdentifier(root, folder))).toList();
    }

    private String skillIdentifier(Path root, Path folder) { return root.toAbsolutePath().normalize().relativize(folder.toAbsolutePath().normalize()).toString().replace('\\', '/'); }

    private boolean safeSkillIdentifier(String id) {
        if (id == null || id.isBlank() || id.startsWith("/") || id.contains("\\")) return false;
        String[] parts = id.split("/", -1);
        if (parts.length == 1) return SAFE_FOLDER.matcher(parts[0]).matches();
        return parts.length == 2 && ".system".equals(parts[0]) && SAFE_FOLDER.matcher(parts[1]).matches();
    }

    private SkillMetadata skillMetadata(Path folder) throws IOException {
        String raw = readBounded(safeSkillFile(folder.toRealPath(), Path.of("SKILL.md")), SKILL_FILE_LIMIT);
        String name = folder.getFileName().toString(), description = "";
        if (raw.startsWith("---")) {
            int end = raw.indexOf("\n---", 3);
            String[] lines = end < 0 ? new String[0] : raw.substring(3, end).split("\\R");
            for (int i = 0; i < lines.length; i++) {
                String trimmed = lines[i].trim(); int colon = trimmed.indexOf(':');
                if (colon <= 0) continue; String key = trimmed.substring(0, colon).trim(); String value = unquote(trimmed.substring(colon + 1).trim());
                if ("name".equals(key) && !value.isBlank()) name = value;
                if ("description".equals(key)) {
                    if (Set.of("|", "|-", "|+", ">", ">-", ">+").contains(value)) {
                        StringBuilder text = new StringBuilder();
                        while (i + 1 < lines.length && (lines[i + 1].isBlank() || Character.isWhitespace(lines[i + 1].charAt(0)))) {
                            String part = lines[++i].trim();
                            if (!part.isBlank()) { if (!text.isEmpty()) text.append(' '); text.append(part); }
                        }
                        value = text.toString();
                    }
                    description = value;
                }
            }
        }
        return new SkillMetadata(name, description);
    }

    private LinkedHashSet<String> markdownReferences(String content) {
        LinkedHashSet<String> result = new LinkedHashSet<>(); Matcher matcher = MARKDOWN_LINK.matcher(content);
        while (matcher.find()) {
            String reference = matcher.group(1).trim(); int suffix = reference.indexOf(' '); if (suffix >= 0) reference = reference.substring(0, suffix);
            if (reference.startsWith("<") && reference.endsWith(">")) reference = reference.substring(1, reference.length() - 1);
            if (!reference.contains("://") && !reference.startsWith("/") && !reference.startsWith("#")) {
                int fragment = reference.indexOf('#'); if (fragment >= 0) reference = reference.substring(0, fragment);
                int query = reference.indexOf('?'); if (query >= 0) reference = reference.substring(0, query);
                if (reference.toLowerCase().endsWith(".md")) result.add(reference);
            }
        }
        return result;
    }

    private Path safeSkillFile(Path folder, Path relative) throws IOException {
        if (relative.isAbsolute() || relative.toString().contains("\\")) throw new IllegalArgumentException("Codex Skill 引用必须为相对路径");
        Path normalized = relative.normalize(); if (normalized.startsWith("..")) throw new IllegalArgumentException("Codex Skill 引用超出 Skill 目录");
        Path result = folder.resolve(normalized).normalize();
        if (!result.startsWith(folder) || !Files.isRegularFile(result)) throw new IllegalArgumentException("Codex Skill 引用文件不存在或路径无效");
        Path real = result.toRealPath(); if (!real.startsWith(folder.toRealPath())) throw new IllegalArgumentException("Codex Skill 引用超出来源目录");
        return real;
    }

    private String readBounded(Path path, int limit) throws IOException {
        long size = Files.size(path); if (size > limit) throw new IllegalArgumentException("Codex Skill 文件超过" + limit + "字节限制");
        String value = Files.readString(path); if (value.length() > limit) throw new IllegalArgumentException("Codex Skill 文件超过" + limit + "字符限制"); return value;
    }

    private JSONObject sanitize(JSONObject value, List<String> secrets) {
        if (value == null) return new JSONObject(); JSONObject copy = JSON.parseObject(value.toJSONString());
        for (String key : new ArrayList<>(copy.keySet())) copy.put(key, sanitizeValue(copy.get(key), secrets));
        return copy;
    }

    private Object sanitizeValue(Object value, List<String> secrets) {
        if (value instanceof String string) return redact(string, secrets);
        if (value instanceof JSONObject object) return sanitize(object, secrets);
        if (value instanceof JSONArray array) { JSONArray result = new JSONArray(); for (Object item : array) result.add(sanitizeValue(item, secrets)); return result; }
        if (value instanceof Map<?, ?> map) { JSONObject result = new JSONObject(); map.forEach((key, item) -> result.put(key.toString(), sanitizeValue(item, secrets))); return result; }
        if (value instanceof List<?> list) { JSONArray result = new JSONArray(); for (Object item : list) result.add(sanitizeValue(item, secrets)); return result; }
        return value;
    }

    private String redact(String value, List<String> secrets) {
        if (value == null) return ""; String result = value;
        for (String secret : secrets) if (secret != null && secret.length() >= 4) result = result.replace(secret, "[凭据隐藏]");
        result = SECRET_TOKEN.matcher(result).replaceAll("[凭据隐藏]");
        result = SECRET_ASSIGNMENT.matcher(result).replaceAll("$1[凭据隐藏]");
        result = PRIVATE_PATH.matcher(result).replaceAll("[本地路径隐藏]");
        return result;
    }

    private List<String> secretValues(Map<String, String> configured) {
        LinkedHashSet<String> result = new LinkedHashSet<>();
        configured.values().stream().filter(value -> value != null && value.length() >= 4).forEach(result::add);
        System.getenv().values().stream().filter(value -> value != null && value.length() >= 8).forEach(result::add);
        return List.copyOf(result);
    }

    private Path skillLink(String user) throws IOException { Path path = linksDirectory(user).resolve("skills"); return Files.isSymbolicLink(path) && Files.isDirectory(path) ? path : null; }
    private Path configLink(String user) throws IOException { Path path = linksDirectory(user).resolve("config.toml"); return Files.isSymbolicLink(path) && Files.isRegularFile(path) ? path : null; }
    private Path linksDirectory(String user) { if (user == null || user.isBlank()) throw new IllegalArgumentException("登录状态已失效"); return store.owner(user).resolve("codex-links"); }
    private String configuredHome() { return configuredCodexHome == null || configuredCodexHome.isBlank() ? defaultCodexHome().toString() : configuredCodexHome; }
    private Path defaultCodexHome() { return Path.of(System.getProperty("user.home"), ".codex").toAbsolutePath().normalize(); }

    private Path linkedHome(Path skills, Path config) {
        try { if (Files.isSymbolicLink(config)) return config.getParent().resolve(Files.readSymbolicLink(config)).normalize().getParent(); } catch (Exception ignored) { }
        try { if (Files.isSymbolicLink(skills)) return skills.getParent().resolve(Files.readSymbolicLink(skills)).normalize().getParent(); } catch (Exception ignored) { }
        return null;
    }

    private boolean ensureLink(Path link, Path target) throws IOException {
        if (Files.exists(link, LinkOption.NOFOLLOW_LINKS)) {
            if (Files.isSymbolicLink(link) && link.toRealPath().equals(target.toRealPath())) return false;
            throw new IllegalStateException("SciNode Codex 链接目标已存在且不匹配: " + link.getFileName());
        }
        Files.createSymbolicLink(link, target); return true;
    }

    private void restrictPrivate(Path path) throws IOException {
        if (Files.getFileStore(path).supportsFileAttributeView("posix")) Files.setPosixFilePermissions(path, PosixFilePermissions.fromString("rwx------"));
    }

    private String unquote(String value) {
        if (value.length() >= 2 && ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'")))) return value.substring(1, value.length() - 1);
        return value;
    }

    private record CodexServer(String name, String command, List<String> args, Map<String, String> env,
                               List<String> envVars, boolean enabled, String cwd, String url) { }
    private record SkillMetadata(String name, String description) { }
    private record McpHandle(String resourceId, McpToolConfig config, List<String> secrets) { }
}
