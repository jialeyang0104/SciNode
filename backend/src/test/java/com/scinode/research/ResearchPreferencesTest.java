package com.scinode.research;

import com.alibaba.fastjson2.*;
import com.scinode.engine.skill.*;
import com.scinode.service.*;
import com.scinode.entity.McpToolConfig;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ResearchPreferencesTest {
 @TempDir Path temp;
 ResearchStore store;ResearchPreferences prefs;SkillRegistry skills;McpToolConfigService mcp;SearchInfinityMcpClient client;
 @BeforeEach void setup()throws Exception{store=new ResearchStore(temp.toString());skills=mock(SkillRegistry.class);mcp=mock(McpToolConfigService.class);client=mock(SearchInfinityMcpClient.class);prefs=new ResearchPreferences(store,skills,mcp,client);}
 @Test void inheritanceAndSnapshotsAreExplicitAndOwnerIsolated()throws Exception{
  JSONObject g=prefs.global("admin");g.put("agentRules","global-rule");g.put("customSkills",List.of(Map.of("name","custom","content","original-skill")));prefs.saveGlobal("admin",g);
  JSONObject local=new JSONObject(Map.of("agentRules","project-rule"));JSONObject snapshot=prefs.snapshot("admin",local);
  assertTrue(snapshot.getString("systemPrompt").contains("global-rule"));assertTrue(snapshot.getString("systemPrompt").contains("project-rule"));assertTrue(snapshot.getString("systemPrompt").contains("original-skill"));
  JSONObject newer=prefs.global("admin");newer.put("agentRules","new-rule");prefs.saveGlobal("admin",newer);assertFalse(snapshot.getString("systemPrompt").contains("new-rule"));
  local.put("inheritGlobal",false);assertFalse(prefs.snapshot("admin",local).getString("systemPrompt").contains("new-rule"));assertEquals("",prefs.global("other").getString("agentRules"));
  assertThrows(IllegalArgumentException.class,()->prefs.saveGlobal("admin",g));
 }
 @Test void missingSkillAndInvalidCustomInstructionsFail()throws Exception{
  when(skills.getSkill("missing")).thenReturn(Optional.empty());assertThrows(IllegalArgumentException.class,()->prefs.snapshot("admin",new JSONObject(Map.of("skills",List.of("missing")))));
  assertThrows(IllegalArgumentException.class,()->prefs.normalize(new JSONObject(Map.of("customSkills",List.of(Map.of("name","x","content",""))))));
 }
 @Test void mcpRequiresAuthorizationAndUnchangedConfiguration()throws Exception{
  McpToolConfig c=new McpToolConfig();c.setId(1L);c.setName("fixture");c.setToolName("echo");c.setCommand("python3");c.setTransport("stdio");c.setEnabled(1);c.setEnv("{\"API_KEY\":\"private-key\"}");c.setArgs("[]");when(mcp.requireConfig(1L)).thenReturn(c);
  JSONObject snapshot=prefs.snapshot("admin",new JSONObject(Map.of("mcpIds",List.of(1))));assertFalse(snapshot.toJSONString().contains("private-key"));
  when(client.callConfiguredTool(eq(c),any())).thenReturn(Map.of("text","ok"));assertEquals("ok",prefs.execute(snapshot,1L,new JSONObject()).get("text"));
  assertThrows(IllegalArgumentException.class,()->prefs.execute(snapshot,2L,new JSONObject()));c.setCommand("changed");assertThrows(IllegalArgumentException.class,()->prefs.execute(snapshot,1L,new JSONObject()));
 }
 @Test void selectedSkillIncludesExactReferences()throws Exception{
  Skill skill=Skill.builder().name("fixture").description("test").content("main-instructions").references(List.of("evidence.md")).build();when(skills.getSkill("fixture")).thenReturn(Optional.of(skill));when(skills.loadReference("fixture","evidence.md")).thenReturn("reference-evidence");
  String prompt=prefs.snapshot("admin",new JSONObject(Map.of("skills",List.of("fixture")))).getString("systemPrompt");assertTrue(prompt.contains("main-instructions"));assertTrue(prompt.contains("reference-evidence"));
 }
}
