package com.scinode.research;

import com.alibaba.fastjson2.*;
import com.scinode.engine.WorkflowConfigParser;
import com.scinode.engine.dag.DAGParser;
import com.scinode.engine.llm.ChatClientFactory;
import com.scinode.service.LLMGlobalConfigService;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockMultipartFile;
import java.nio.file.*;
import java.util.*;
import java.util.zip.ZipFile;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ResearchToolExecutorTest {
    @TempDir Path temp;
    @Test void realClinicalRunIncludesCodeAndCanReproduceAfterFreezeAndRelocation()throws Exception{
        String python=System.getProperty("scinode.test-python");
        Assumptions.assumeTrue(python!=null,"设置 -Dscinode.test-python 指向已安装临床依赖的 Python 以运行完整执行测试");
        ResearchStore store=new ResearchStore(temp.resolve("store").toString());
        var models=mock(LLMGlobalConfigService.class);when(models.list()).thenReturn(List.of());
        var preferences=new ResearchPreferences(store,mock(com.scinode.engine.skill.SkillRegistry.class),mock(com.scinode.service.McpToolConfigService.class),mock(com.scinode.service.SearchInfinityMcpClient.class));
        ResearchService service=new ResearchService(store,new ResearchToolExecutor(python,"Rscript",python),new WorkflowConfigParser(),new DAGParser(),mock(ChatClientFactory.class),models,preferences);
        try{
            JSONObject project=service.create("tester",new JSONObject(Map.of("name","Clinical fixture","template","blank","clinicalData",true)));
            JSONObject file=service.upload("tester",project.getString("id"),new MockMultipartFile("file","patients.csv","text/csv","id,age,event\n1,20,0\n2,40,1\n3,,0\n".getBytes()));
            JSONArray nodes=new JSONArray();
            ResearchTemplates.add(nodes,"table","document","Data",Map.of("fileId",file.getString("id")));
            ResearchTemplates.add(nodes,"quality","python","Quality",Map.of("analysisPreset","quality","analysis",Map.of("idColumn","id"),"inputs",Map.of("dataPath","{{table.dataPath}}")));
            ResearchTemplates.add(nodes,"report","export","Report",Map.of("format","md","inputs",Map.of("text","{{quality.text}}")));
            ResearchTemplates.add(nodes,"package","package","Package",Map.of());
            JSONArray edges=new JSONArray();for(int i=1;i<nodes.size();i++)edges.add(new JSONObject(Map.of("id","e"+i,"source",nodes.getJSONObject(i-1).getString("id"),"target",nodes.getJSONObject(i).getString("id"))));
            project.put("nodes",nodes);project.put("edges",edges);project=service.save("tester",project.getString("id"),project);
            JSONObject run=service.start("tester",project.getString("id"),new JSONObject(Map.of("authorized",true,"revision",project.getInteger("revision"))));
            String rid=run.getString("id");run=await(service,rid);
            assertEquals(3,run.getJSONObject("nodeResults").getJSONObject("quality").getJSONObject("output").getIntValue("n"));
            assertFalse(run.getJSONObject("nodeResults").getJSONObject("table").getJSONObject("output").getString("text").contains("1,20,0"));
            service.freeze("tester",rid);
            JSONObject branch=service.start("tester",project.getString("id"),new JSONObject(Map.of("authorized",true,"revision",project.getInteger("revision"),"fromRunId",rid,"startNodeId","package")));
            branch=await(service,branch.getString("id"));assertEquals(rid,branch.getJSONObject("nodeResults").getJSONObject("quality").getString("reusedFrom"));
            Path zip=null;for(Object item:branch.getJSONArray("artifacts")){JSONObject artifact=(JSONObject)item;if("research-package.zip".equals(artifact.getString("name")))zip=Path.of(artifact.getString("path"));}
            assertNotNull(zip);Path extracted=temp.resolve("relocated");Files.createDirectories(extracted);
            try(ZipFile archive=new ZipFile(zip.toFile())){
                var entries=archive.entries();while(entries.hasMoreElements()){var entry=entries.nextElement();Path path=extracted.resolve(entry.getName());Files.createDirectories(path.getParent());try(var input=archive.getInputStream(entry)){Files.copy(input,path);}}
            }
            assertTrue(Files.isRegularFile(extracted.resolve("tasks/quality/src/script.py")));
            assertTrue(Files.isRegularFile(extracted.resolve("tasks/quality/config/requirements.txt")));
            assertTrue(Files.isRegularFile(extracted.resolve("config/decisions.json")));
            Files.delete(Path.of(file.getString("path")));
            Process process=new ProcessBuilder(python,extracted.resolve("reproduce.py").toString(),"quality","--output",temp.resolve("reproduced").toString()).redirectErrorStream(true).start();
            String output=new String(process.getInputStream().readAllBytes());assertEquals(0,process.waitFor(),output);
            assertEquals(3,JSON.parseObject(Files.readString(temp.resolve("reproduced/result.json"))).getIntValue("n"));
        }finally{service.close();}
    }
    private JSONObject await(ResearchService service,String rid)throws Exception{
        for(int i=0;i<600;i++){
            JSONObject run=service.run("tester",rid);
            if("SUCCESS".equals(run.getString("status"))){Thread.sleep(50);return run;}
            if("FAILED".equals(run.getString("status")))fail(run.getString("error"));
            Thread.sleep(50);
        }
        throw new AssertionError("Local clinical execution timed out");
    }
}
