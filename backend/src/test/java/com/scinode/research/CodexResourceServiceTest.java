package com.scinode.research;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.scinode.engine.skill.SkillRegistry;
import com.scinode.entity.McpToolConfig;
import com.scinode.service.McpToolConfigService;
import com.scinode.service.SearchInfinityMcpClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class CodexResourceServiceTest {
    @TempDir Path temp;

    private CodexResourceService service(Path data) throws Exception {
        ResearchStore store = new ResearchStore(data.toString());
        ResearchPreferences preferences = mock(ResearchPreferences.class);
        when(preferences.global(anyString())).thenReturn(new JSONObject(Map.of("mcpIds", new JSONArray())));
        SkillRegistry builtins = mock(SkillRegistry.class); when(builtins.getAllSkills()).thenReturn(List.of());
        return new CodexResourceService(store, mock(ResearchService.class), preferences, builtins,
                mock(McpToolConfigService.class), new SearchInfinityMcpClient(), "");
    }

    private Path createHome(String leaf) throws Exception {
        Path home = temp.resolve(leaf); Files.createDirectories(home.resolve("skills"));
        Files.writeString(home.resolve("config.toml"), ""); return home;
    }

    @Test void linksArePrivateToEachUserAndFollowCurrentSkillFiles() throws Exception {
        Path home = createHome("codex-home");
        Path officialSkill = Files.createDirectories(home.resolve("skills/.system/imagegen"));
        Files.writeString(officialSkill.resolve("SKILL.md"), "---\nname: Image Generation\ndescription: >-\n  fixture skill\n  with details\n---\nold content\n\n[details](references/details.md)\n");
        Path refs = Files.createDirectories(officialSkill.resolve("references")); Files.writeString(refs.resolve("details.md"), "old reference");
        CodexResourceService service = service(temp.resolve("data"));
        JSONObject linked = service.link("alice", home.toString());
        assertTrue(linked.getBooleanValue("linked")); assertEquals(1, linked.getIntValue("skillsCount"));
        assertFalse(service.status("bob").getBooleanValue("linked"));
        JSONObject catalog = service.resources("alice", null);
        JSONObject skill = catalog.getJSONArray("skills").getJSONObject(0);
        assertEquals("codex:.system/imagegen", skill.getString("id"));
        assertEquals("fixture skill with details", skill.getString("description"));
        String first = service.skillContent("alice", skill.getString("id"), null);
        assertTrue(first.contains("old content")); assertTrue(first.contains("old reference"));
        Files.writeString(officialSkill.resolve("SKILL.md"), "---\nname: Image Generation\ndescription: updated\n---\nnew content\n");
        assertTrue(service.skillContent("alice", skill.getString("id"), null).contains("new content"));
        assertThrows(IllegalArgumentException.class, () -> service.skillContent("bob", skill.getString("id"), null));
        assertTrue(Files.isSymbolicLink(temp.resolve("data").resolve(java.util.Base64.getUrlEncoder().withoutPadding().encodeToString("alice".getBytes())).resolve("codex-links/skills")));
        JSONObject unlinked = service.unlink("alice"); assertFalse(unlinked.getBooleanValue("linked"));
        assertTrue(Files.exists(officialSkill.resolve("SKILL.md"))); assertTrue(Files.exists(home.resolve("config.toml")));
    }

    @Test void referencesCannotEscapeSkillSourceDirectory() throws Exception {
        Path home = createHome("unsafe-home"); Path skill = Files.createDirectories(home.resolve("skills/escape"));
        Files.writeString(skill.resolve("SKILL.md"), "---\nname: Escape\n---\n[bad](../outside.md)\n");
        Files.writeString(home.resolve("skills/outside.md"), "outside");
        CodexResourceService service = service(temp.resolve("data-unsafe")); service.link("alice", home.toString());
        assertThrows(IllegalArgumentException.class, () -> service.skillContent("alice", "codex:escape", null));
    }

    @Test void stdioMcpRequiresCurrentToolAndRequiredArgumentsAndRedactsOutputs() throws Exception {
        Path home = createHome("mcp-home");
        Path server = temp.resolve("fixture_mcp.py");
        Files.writeString(server, """
                import json, sys
                for line in sys.stdin:
                    message = json.loads(line)
                    method = message.get("method")
                    if "id" not in message:
                        continue
                    if method == "initialize":
                        result = {"protocolVersion":"2024-11-05","capabilities":{},"serverInfo":{"name":"fixture","version":"1"}}
                    elif method == "tools/list":
                        result = {"tools":[{"name":"echo_fixture","description":"fixture","inputSchema":{"type":"object","required":["query"],"properties":{"query":{"type":"string"}}}}]}
                    elif method == "tools/call":
                        result = {"content":[{"type":"text","text":"key=fixture-secret private=/Users/test/private"}],"structuredContent":{"key":"fixture-secret"},"isError":False}
                    else:
                        result = {}
                    print(json.dumps({"jsonrpc":"2.0","id":message["id"],"result":result}), flush=True)
                """);
        Files.writeString(home.resolve("config.toml"), """
                [mcp_servers.fixture]
                command = "python3"
                args = ["%s"]
                [mcp_servers.fixture.env]
                API_TOKEN = "fixture-secret"

                [mcp_servers.disabled]
                command = "python3"
                enabled = false

                [mcp_servers.remote]
                url = "https://example.invalid/mcp"
                """.formatted(server));
        CodexResourceService service = service(temp.resolve("data-mcp")); service.link("alice", home.toString());
        JSONObject catalog = service.resources("alice", null); JSONArray servers = catalog.getJSONArray("mcp");
        assertEquals("disabled", servers.stream().map(o -> (JSONObject)o).filter(o -> "codex:disabled".equals(o.getString("id"))).findFirst().orElseThrow().getString("status"));
        assertEquals("unsupported", servers.stream().map(o -> (JSONObject)o).filter(o -> "codex:remote".equals(o.getString("id"))).findFirst().orElseThrow().getString("status"));
        JSONObject tools = service.inspectMcp("alice", "codex:fixture", null); assertEquals("echo_fixture", tools.getJSONArray("tools").getJSONObject(0).getString("name"));
        assertThrows(IllegalArgumentException.class, () -> service.callMcp("alice", "codex:fixture", "missing", new JSONObject(), null));
        assertThrows(IllegalArgumentException.class, () -> service.callMcp("alice", "codex:fixture", "echo_fixture", new JSONObject(), null));
        JSONObject result = service.callMcp("alice", "codex:fixture", "echo_fixture", new JSONObject(Map.of("query", "ok")), null);
        assertFalse(result.toJSONString().contains("fixture-secret")); assertFalse(result.toJSONString().contains("/Users/test/private"));
        String material = service.toolResultContent("alice", List.of(result.getString("id")));
        assertTrue(material.contains("[凭据隐藏]"));
        assertThrows(IllegalArgumentException.class, () -> service.toolResultContent("bob", List.of(result.getString("id"))));
        assertThrows(IllegalArgumentException.class, () -> service.inspectMcp("alice", "codex:disabled", null));
        assertThrows(IllegalArgumentException.class, () -> service.inspectMcp("alice", "codex:remote", null));
    }
}
