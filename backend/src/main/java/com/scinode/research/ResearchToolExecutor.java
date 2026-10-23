package com.scinode.research;

import com.alibaba.fastjson2.*;
import com.scinode.engine.executor.NodeExecutor;
import com.scinode.engine.model.WorkflowNode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.core.io.ClassPathResource;
import java.nio.file.*;
import java.net.*;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.TimeUnit;

/** Research nodes use the existing NodeExecutor contract. Local scripts are explicitly configured by the user. */
@Component
public class ResearchToolExecutor implements NodeExecutor {
    private final String python, rscript, documentPython;
    @Value("${scinode.previous-root:}") private String previousRoot = "";
    @Value("${scinode.current-root:}") private String currentRoot = "";
    public ResearchToolExecutor(
        @Value("${scinode.python:python3}") String python,
        @Value("${scinode.rscript:Rscript}") String rscript,
        @Value("${scinode.document-python:python3}") String documentPython) {
        this.python=python; this.rscript=rscript; this.documentPython=documentPython;
    }
    public String getSupportedNodeType() { return "research"; }
    public Map<String,Object> execute(WorkflowNode node, Map<String,Object> input) throws Exception {
        JSONObject config=new JSONObject(node.getData());
        String kind=config.getString("kind");
        Path dir=Path.of((String)input.get("_workDir"));
        JSONObject values=new JSONObject(input); values.remove("_workDir");
        Files.createDirectories(dir);
        if ("input".equals(kind)) return new JSONObject(Map.of("text",config.getString("text")==null?"":config.getString("text")));
        if ("pubmed".equals(kind)) {
            JSONObject output=pubmed(config);Files.createDirectories(dir.resolve("output"));Files.writeString(dir.resolve("output/pubmed-records.json"),output.toJSONString());return output;
        }
        if ("check".equals(kind)) {
            JSONArray rules=config.getJSONArray("requiredFields");
            if(rules==null||rules.isEmpty()) throw new IllegalArgumentException("请配置至少一个必需字段");
            JSONArray checks=new JSONArray();
            for(Object rule:rules){ Object value=values.get(rule.toString()); boolean ok=value!=null && !value.toString().isBlank();
                checks.add(Map.of("field",rule.toString(),"passed",ok)); }
            boolean passed=checks.stream().allMatch(x->((Map<?,?>)x).get("passed").equals(true));
            if(!passed) throw new IllegalArgumentException("必需字段检查失败: "+checks);
            return new JSONObject(Map.of("passed",true,"checks",checks,"text","质量检查通过"));
        }
        boolean document=Set.of("document","export","package").contains(kind);
        if (!document && !Set.of("python","r").contains(kind)) throw new IllegalArgumentException("请选择有效的科研执行方式");
        String script;
        if(document) {
            try(var stream=new ClassPathResource("scinode/document_tool.py").getInputStream()){ script=new String(stream.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8); }
            values.put("operation",kind);
            values.put("format",config.getString("format"));
        } else {
            script=config.getString("script");
            if(script==null||script.isBlank()) throw new IllegalArgumentException("请填写待执行脚本");
        }
        Path scriptFile=dir.resolve("r".equals(kind)?"script.R":"script.py");
        Files.writeString(scriptFile,script);
        Files.writeString(dir.resolve("input.json"),values.toJSONString());
        int timeout=Math.max(1,Math.min(config.getIntValue("timeout",120),3600));
        String binary=document?documentPython:("r".equals(kind)?rscript:python);
        ProcessBuilder builder=new ProcessBuilder(binary,scriptFile.toString());
        builder.directory(dir.toFile());
        builder.environment().put("SCINODE_INPUT",dir.resolve("input.json").toString());
        builder.environment().put("SCINODE_OUTPUT",dir.resolve("output").toString());
        builder.environment().put("PYTHONUNBUFFERED","1");
        builder.environment().put("SCINODE_PREVIOUS_ROOT",previousRoot);
        builder.environment().put("SCINODE_CURRENT_ROOT",currentRoot);
        builder.redirectOutput(dir.resolve("stdout.log").toFile());
        builder.redirectError(dir.resolve("stderr.log").toFile());
        Process process=builder.start();
        boolean completed;
        try { completed=process.waitFor(timeout,TimeUnit.SECONDS); }
        catch(InterruptedException e){process.descendants().forEach(ProcessHandle::destroyForcibly);process.destroyForcibly();Thread.currentThread().interrupt();throw e;}
        if(!completed){
            process.descendants().forEach(ProcessHandle::destroyForcibly); process.destroyForcibly();
            throw new IllegalStateException("脚本超时 ("+timeout+" 秒)，运行日志已保留");
        }
        String stdout=readLog(dir.resolve("stdout.log")),stderr=readLog(dir.resolve("stderr.log"));
        if(process.exitValue()!=0) throw new IllegalStateException("脚本退出码 "+process.exitValue()+"\n"+stderr+"\n"+stdout);
        JSONObject output=new JSONObject(Map.of("stdout",stdout,"stderr",stderr,"exitCode",0));
        if(document) {
            Path result=dir.resolve("output/result.json");if(!Files.isRegularFile(result))throw new IllegalStateException("文档节点缺少result.json产物");JSONObject doc=JSON.parseObject(Files.readString(result)); output.putAll(doc);
        } else {
            Path result=dir.resolve("output/result.json");
            if(Files.isRegularFile(result)) output.putAll(JSON.parseObject(Files.readString(result)));
            else output.put("text",stdout);
        }
        return output;
    }
    static String readLog(Path path) throws java.io.IOException {
        try(var in=Files.newInputStream(path)){ return new String(in.readNBytes(512*1024),java.nio.charset.StandardCharsets.UTF_8)+(Files.size(path)>512*1024?"\n[界面预览截取前512KB，完整日志保存在成果文件]":""); }
    }
    private JSONObject pubmed(JSONObject config) throws Exception {
        String term=config.getString("query");
        if(term==null||term.isBlank()) throw new IllegalArgumentException("请填写 PubMed 检索式");
        int limit=Math.max(1,Math.min(config.getIntValue("limit",10),100));
        HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();
        String base="https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
        JSONObject search=getJson(client,base+"esearch.fcgi?db=pubmed&retmode=json&retmax="+limit+"&term="+URLEncoder.encode(term,java.nio.charset.StandardCharsets.UTF_8));
        JSONObject result=search.getJSONObject("esearchresult");
        if(result==null||result.getJSONObject("errorlist")!=null||result.getString("ERROR")!=null) throw new IllegalStateException("PubMed 检索返回错误: "+search);
        JSONArray ids=result.getJSONArray("idlist"),papers=new JSONArray();
        if(ids!=null&&!ids.isEmpty()){
            String joined=String.join(",",ids.toJavaList(String.class));
            JSONObject summary=getJson(client,base+"esummary.fcgi?db=pubmed&retmode=json&id="+joined).getJSONObject("result");
            if(summary==null) throw new IllegalStateException("PubMed 摘要响应缺少 result");
            for(Object id:ids){ JSONObject p=summary.getJSONObject(id.toString());
                if(p==null||p.containsKey("error"))throw new IllegalStateException("PubMed 文献记录获取失败: "+id);
                p.put("url","https://pubmed.ncbi.nlm.nih.gov/"+id+"/"); papers.add(p); }
        }
        return new JSONObject(Map.of("query",term,"searchedAt",java.time.Instant.now().toString(),"total",result.getString("count"),"papers",papers,"text",papers.toJSONString()));
    }
    private JSONObject getJson(HttpClient client,String url)throws Exception{
        var response=client.send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(45)).header("User-Agent","SciNode/1.0 personal-research").GET().build(),HttpResponse.BodyHandlers.ofString());
        if(response.statusCode()!=200)throw new IllegalStateException("PubMed HTTP "+response.statusCode()+": "+response.body());
        JSONObject json=JSON.parseObject(response.body());
        if(json.getString("error")!=null) throw new IllegalStateException("PubMed: "+json.getString("error"));
        return json;
    }
}
