package com.scinode.research;

import com.alibaba.fastjson2.*;
import com.scinode.engine.WorkflowConfigParser;
import com.scinode.engine.dag.DAGParser;
import com.scinode.engine.model.WorkflowNode;
import com.scinode.engine.llm.ChatClientFactory;
import com.scinode.service.LLMGlobalConfigService;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ResearchServiceTest {
    @TempDir Path temp;
    ResearchStore store;ResearchService service;ResearchToolExecutor tools;com.scinode.service.LLMGlobalConfigService models;
    @BeforeEach void setup()throws Exception{
        store=new ResearchStore(temp.resolve("data").toString());tools=mock(ResearchToolExecutor.class);
        models=mock(LLMGlobalConfigService.class);when(models.list()).thenReturn(List.of());
        service=new ResearchService(store,tools,new WorkflowConfigParser(),new DAGParser(),mock(ChatClientFactory.class),models,new ResearchPreferences(store,mock(com.scinode.engine.skill.SkillRegistry.class),mock(com.scinode.service.McpToolConfigService.class),mock(com.scinode.service.SearchInfinityMcpClient.class)));
        when(tools.execute(any(),any())).thenAnswer(call->{WorkflowNode n=call.getArgument(0);Map<String,Object> input=call.getArgument(1);
            if("export".equals(n.getData().get("kind"))){Path out=Path.of((String)input.get("_workDir")).resolve("output");Files.createDirectories(out);Files.writeString(out.resolve("report.md"),input.get("text").toString());return Map.of("text","exported");}
            return Map.of("text",Objects.toString(n.getData().get("text"),"result"));});
    }
    @AfterEach void teardown(){service.close();}
    JSONObject node(String id,String kind,JSONObject config){config.put("kind",kind);config.put("label",id);return new JSONObject(Map.of("id",id,"type","research","data",config));}
    JSONObject flow(JSONObject...nodes){JSONArray ns=new JSONArray(Arrays.asList(nodes)),es=new JSONArray();for(int i=1;i<nodes.length;i++)es.add(new JSONObject(Map.of("id","e"+i,"source",nodes[i-1].getString("id"),"target",nodes[i].getString("id"))));return new JSONObject(Map.of("nodes",ns,"edges",es));}
    JSONObject project(boolean human)throws Exception{JSONObject p=service.create("admin",new JSONObject(Map.of("name","test","template","blank")));
        JSONObject input=node("source","input",new JSONObject(Map.of("text","original"))),approve=node("confirm","approve",new JSONObject(Map.of("inputs",Map.of("text","{{source.text}}")))),export=node("report","export",new JSONObject(Map.of("inputs",Map.of("text",human?"{{confirm.text}}":"{{source.text}}"))));
        JSONObject config=human?flow(input,approve,export):flow(input,export);p.putAll(config);return service.save("admin",p.getString("id"),p);}
    JSONObject start(JSONObject p)throws Exception{return service.start("admin",p.getString("id"),new JSONObject(Map.of("revision",p.getInteger("revision"),"authorized",true,"inputs",Map.of("text",""))));}
    JSONObject waitFor(String rid,String status)throws Exception{for(int i=0;i<150;i++){JSONObject r=service.run("admin",rid);if(status.equals(r.getString("status"))){Thread.sleep(20);return r;}if("FAILED".equals(r.getString("status"))&&!"FAILED".equals(status))fail(r.getString("error"));Thread.sleep(20);}fail("Timed out waiting for "+status);return null;}
    @Test void customFlowCreatesSingleVersionAndRejectsInvalidBeforeWriting()throws Exception{
        JSONObject body=flow(node("source","input",new JSONObject(Map.of("text","Synthetic fixture"))),node("confirm","approve",new JSONObject(Map.of("inputs",Map.of("text","{{source.text}}")))));
        body.put("name","Assistant fixture");JSONObject p=service.create("admin",body);
        assertEquals(1,p.getIntValue("revision"));assertEquals(1,p.getJSONArray("versions").size());assertEquals(2,p.getJSONArray("nodes").size());
        int count=service.projects("admin").size();body.getJSONArray("edges").getJSONObject(0).put("target","missing");
        assertThrows(IllegalArgumentException.class,()->service.create("admin",body));assertEquals(count,service.projects("admin").size());
    }
    @Test void approvalPausesThenContinuesAndFreezeDetectsTamper()throws Exception{
        JSONObject p=project(true),r=start(p);r=waitFor(r.getString("id"),"WAITING_APPROVAL");
        assertNull(r.getJSONObject("nodeResults").getJSONObject("report"));String waitingId=r.getString("id");assertThrows(IllegalArgumentException.class,()->service.freeze("admin",waitingId));
        String rid=r.getString("id");service.proceed("admin",rid,new JSONObject(Map.of("approved",true,"note","confirmed scope")));r=waitFor(rid,"SUCCESS");
        assertEquals(1,r.getJSONArray("decisions").size());r=service.freeze("admin",rid);assertTrue(r.getBooleanValue("frozen"));
        Path artifact=service.artifact("admin",rid,0);assertEquals("original",Files.readString(artifact));Files.writeString(artifact,"tampered");assertThrows(IllegalArgumentException.class,()->service.artifact("admin",rid,0));
    }
    private String rId(JSONObject r){return r.getString("id");}
    @Test void rerunCreatesChildAndReusesOnlyUnchangedUpstream()throws Exception{
        JSONObject p=project(false),old=start(p);old=waitFor(old.getString("id"),"SUCCESS");String originalJson=store.read("admin","runs",old.getString("id")).toJSONString();
        JSONObject request=new JSONObject(Map.of("revision",p.getInteger("revision"),"authorized",true,"inputs",Map.of("text",""),"fromRunId",old.getString("id"),"startNodeId","report"));
        JSONObject next=service.start("admin",p.getString("id"),request);next=waitFor(next.getString("id"),"SUCCESS");assertNotEquals(old.getString("id"),next.getString("id"));assertEquals(old.getString("id"),next.getJSONObject("nodeResults").getJSONObject("source").getString("reusedFrom"));assertEquals(originalJson,store.read("admin","runs",old.getString("id")).toJSONString());
        p.getJSONArray("nodes").getJSONObject(0).getJSONObject("data").put("text","changed");p=service.save("admin",p.getString("id"),p);request.put("revision",p.getInteger("revision"));
        JSONObject changed=service.start("admin",p.getString("id"),request);changed=waitFor(changed.getString("id"),"SUCCESS");assertNull(changed.getJSONObject("nodeResults").getJSONObject("source").get("reusedFrom"));assertEquals("changed",changed.getJSONObject("nodeResults").getJSONObject("source").getJSONObject("output").getString("text"));
    }
    @Test void rejectAndStopKeepDecisionsAndPermitNewAttempt()throws Exception{
        JSONObject p=project(true),r=start(p);r=waitFor(r.getString("id"),"WAITING_APPROVAL");String rid=r.getString("id");r=service.proceed("admin",rid,new JSONObject(Map.of("approved",false,"note","needs revision")));assertEquals("REJECTED",r.getString("status"));assertEquals(1,r.getJSONArray("decisions").size());
        JSONObject other=start(p);waitFor(other.getString("id"),"WAITING_APPROVAL");assertEquals("CANCELLED",service.stop("admin",other.getString("id")).getString("status"));
    }
    @Test void invalidGraphsAndDanglingReferencesFailBeforeExecution(){
        JSONObject a=node("a","input",new JSONObject()),b=node("b","export",new JSONObject(Map.of("inputs",Map.of("text","{{missing.text}}"))));assertThrows(IllegalArgumentException.class,()->service.validateGraph(flow(a,b)));
        JSONObject cycle=flow(a,b);cycle.getJSONArray("edges").add(new JSONObject(Map.of("source","b","target","a")));assertThrows(RuntimeException.class,()->service.validateGraph(cycle));
        assertThrows(IllegalArgumentException.class,()->service.validateGraph(flow(a,a)));
    }
    @Test void lifecyclePreservesHistoryAndBlocksActiveDecisions()throws Exception{
        JSONObject p=project(false);String pid=p.getString("id");int count=p.getJSONArray("versions").size();
        JSONObject body=new JSONObject(Map.of("revision",p.getInteger("revision"),"updatedAt",p.getString("updatedAt"),"lifecycle","TRASHED"));
        JSONObject deleted=service.lifecycle("admin",pid,body);assertEquals(count,deleted.getJSONArray("versions").size());assertThrows(IllegalArgumentException.class,()->start(deleted));
        body.put("updatedAt",deleted.getString("updatedAt"));body.put("lifecycle","ACTIVE");p=service.lifecycle("admin",pid,body);assertEquals("ACTIVE",p.getString("lifecycle"));
        JSONObject human=project(true);JSONObject r=start(human);waitFor(r.getString("id"),"WAITING_APPROVAL");JSONObject request=new JSONObject(Map.of("revision",human.getInteger("revision"),"updatedAt",human.getString("updatedAt"),"lifecycle","ARCHIVED"));assertThrows(IllegalArgumentException.class,()->service.lifecycle("admin",human.getString("id"),request));
    }
    @Test void modelIdentitySurvivesJsonPersistence(){
        com.scinode.entity.LLMGlobalConfig c=new com.scinode.entity.LLMGlobalConfig();c.setId(2L);c.setProvider("openai");c.setModel("fixture");c.setApiUrl("http://localhost:8317");c.setApiKey("test-only-key");c.setTemperature(new java.math.BigDecimal("0.20"));
        JSONObject identity=service.modelIdentity(c);assertEquals(identity,ResearchService.copy(identity));assertFalse(identity.toJSONString().contains("test-only-key"));
    }
    @Test void nodeModelOverrideUsesPrivateRuntimeCopyAndHonorsDefaultConfigScope(){
        com.scinode.entity.LLMGlobalConfig saved=new com.scinode.entity.LLMGlobalConfig();saved.setId(7L);saved.setProvider("openai");saved.setConfigName("saved");saved.setApiUrl("http://localhost:8317");saved.setApiKey("local-secret");saved.setModel("saved-default");
        when(models.getById(anyLong())).thenAnswer(call->{Long id=call.getArgument(0,Long.class);if(id==7L)return saved;if(id==8L){var other=new com.scinode.entity.LLMGlobalConfig();org.springframework.beans.BeanUtils.copyProperties(saved,other);other.setId(8L);return other;}return null;});
        JSONObject settings=new JSONObject(Map.of("defaultConfigId",7L,"defaultModel","settings-default"));
        com.scinode.entity.LLMGlobalConfig selected=service.modelForNode(new JSONObject(Map.of("configId",7L,"model","node-selected")),settings);
        assertEquals("node-selected",selected.getModel());assertEquals("saved-default",saved.getModel());assertNotSame(saved,selected);
        assertEquals("node-selected",service.modelIdentity(selected).getString("model"));
        assertEquals("settings-default",service.modelForNode(new JSONObject(Map.of("configId",7L)),settings).getModel());
        assertEquals("saved-default",service.modelForNode(new JSONObject(Map.of("configId",8L)),settings).getModel());
    }
    @Test void jacksonRequestNestedMapsAreAccepted()throws Exception{
        JSONObject p=project(false);JSONObject request=new com.fasterxml.jackson.databind.ObjectMapper().readValue(p.toJSONString(),JSONObject.class);
        JSONObject saved=service.save("admin",p.getString("id"),request);assertEquals(2,saved.getJSONArray("nodes").size());
    }
    @Test void typedReferencesPreserveObjectsAndFailOnUnknown(){
        JSONObject context=new JSONObject(Map.of("source",Map.of("summary",Map.of("missing",1),"text","$x\\y")));
        assertTrue(ResearchService.resolve("{{source.summary}}",context) instanceof Map);
        assertEquals("result $x\\y",ResearchService.resolve("result {{source.text}}",context));assertThrows(IllegalArgumentException.class,()->ResearchService.resolve("{{source.unknown}}",context));
    }
    @Test void ownerAndOptimisticRevisionAreEnforced()throws Exception{
        JSONObject p=project(false);assertThrows(IllegalArgumentException.class,()->service.project("other",p.getString("id")));
        JSONObject stale=ResearchService.copy(p);service.save("admin",p.getString("id"),p);assertThrows(IllegalArgumentException.class,()->service.save("admin",p.getString("id"),stale));
        assertThrows(IllegalArgumentException.class,()->store.read("admin","runs","../escape"));
    }
    @Test void scriptFailureIsPersistedAndDownstreamWaits()throws Exception{
        JSONObject p=project(false);doThrow(new IllegalStateException("exit code 7")).when(tools).execute(any(),any());JSONObject r=start(p);r=waitFor(r.getString("id"),"FAILED");assertTrue(r.getString("error").contains("exit code 7"));assertNull(r.getJSONObject("nodeResults").getJSONObject("report"));
    }
}
