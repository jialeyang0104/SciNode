package com.scinode.research;

import com.alibaba.fastjson2.*;
import com.scinode.engine.executor.NodeExecutor;
import com.scinode.engine.model.WorkflowNode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.core.io.ClassPathResource;
import java.nio.file.*;
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
            JSONObject output=new PubMedClient().search(config);Files.createDirectories(dir.resolve("output"));TaskWorkspace.json(dir.resolve("output/pubmed-records.json"),output);Files.writeString(dir.resolve("output/pubmed-cards.md"),output.getString("text"));return output;
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
        boolean table="table-preview".equals(kind)||("document".equals(kind)&&!config.getBooleanValue("rawDocument")&&Objects.toString(values.get("filePath"),"").toLowerCase().matches(".*\\.(csv|xlsx)$"));
        boolean clinical=Set.of("python","r").contains(kind)&&config.getString("analysisPreset")!=null;
        if (!document && !table && !Set.of("python","r").contains(kind)) throw new IllegalArgumentException("请选择有效的科研执行方式");
        Files.createDirectories(dir.resolve("src"));Files.createDirectories(dir.resolve("config"));Files.createDirectories(dir.resolve("logs"));
        String script;
        if(table) {
            resource(dir,"tabular_data.py");
            values.put("sheet",config.getString("sheet"));
            script="import json, os\nfrom pathlib import Path\nfrom tabular_data import inspect_table\np=json.loads(Path(os.environ['SCINODE_INPUT']).read_text())\nr=inspect_table(p['filePath'],p.get('sheet'))\nout=Path(os.environ['SCINODE_OUTPUT']); out.mkdir(exist_ok=True)\nr.update(sourceName=Path(p['filePath']).name)\n(out/'result.json').write_text(json.dumps(r,ensure_ascii=False,indent=2),encoding='utf-8')\n(out/'data-dictionary.md').write_text(r['text'],encoding='utf-8')\nprint(r['text'])\n";
        } else if(clinical) {
            script=resourceText("clinical_analysis.py");resource(dir,"tabular_data.py");
            values.put("analysisPreset",config.getString("analysisPreset"));
            values.put("analysis",config.getJSONObject("analysis"));
        } else if(document) {
            script=resourceText("document_tool.py");
            if("package".equals(kind)){resource(dir,"task_package.py");resource(dir,"reproduce.py");}
            values.put("operation",kind);values.put("format",config.getString("format"));
        } else {
            script=config.getString("script");
            if(script==null||script.isBlank()) throw new IllegalArgumentException("请填写待执行脚本或选择临床统计任务");
        }
        boolean isR="r".equals(kind)&&!clinical;
        Path scriptFile=dir.resolve(isR?"src/script.R":"src/script.py");
        Files.writeString(scriptFile,script);
        TaskWorkspace.json(dir.resolve("config/input.json"),values);
        int timeout=Math.max(1,Math.min(config.getIntValue("timeout",120),3600));
        String binary=(table||clinical)?python:document?documentPython:isR?rscript:python;
        TaskWorkspace.json(dir.resolve("config/execution.json"),Map.of("language",isR?"r":"python","script",dir.relativize(scriptFile).toString(),"binary",binary,"timeout",timeout));
        ProcessBuilder builder;
        if(isR){
            Path runner=dir.resolve("src/run.R");
            Files.writeString(runner,"tryCatch(source('src/script.R'), finally={sink('logs/session-info.log'); print(sessionInfo()); sink()})");
            builder=new ProcessBuilder(binary,runner.toString());
        } else {
            resource(dir,"execution_runner.py");
            builder=new ProcessBuilder(binary,dir.resolve("src/execution_runner.py").toString(),scriptFile.toString());
        }
        builder.directory(dir.toFile());
        builder.environment().put("SCINODE_INPUT",dir.resolve("config/input.json").toString());
        builder.environment().put("SCINODE_OUTPUT",dir.resolve("output").toString());
        builder.environment().put("PYTHONUNBUFFERED","1");
        builder.environment().put("SCINODE_PREVIOUS_ROOT",previousRoot);
        builder.environment().put("SCINODE_CURRENT_ROOT",currentRoot);
        builder.redirectOutput(dir.resolve("logs/stdout.log").toFile());
        builder.redirectError(dir.resolve("logs/stderr.log").toFile());
        Process process=builder.start();
        boolean completed;
        try { completed=process.waitFor(timeout,TimeUnit.SECONDS); }
        catch(InterruptedException e){process.descendants().forEach(ProcessHandle::destroyForcibly);process.destroyForcibly();Thread.currentThread().interrupt();throw e;}
        if(!completed){
            process.descendants().forEach(ProcessHandle::destroyForcibly); process.destroyForcibly();
            throw new IllegalStateException("脚本超时 ("+timeout+" 秒)，运行日志已保留");
        }
        String stdout=readLog(dir.resolve("logs/stdout.log")),stderr=readLog(dir.resolve("logs/stderr.log"));
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
    private static String resourceText(String name) throws java.io.IOException {
        try(var stream=new ClassPathResource("scinode/"+name).getInputStream()){return new String(stream.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);}
    }
    private static void resource(Path dir,String name) throws java.io.IOException {Files.writeString(dir.resolve("src").resolve(name),resourceText(name));}
    public Map<String,Object> inspectTable(Path file,String sheet,Path dir) throws Exception {
        WorkflowNode node=new WorkflowNode();node.setData(new JSONObject(Map.of("kind","table-preview","sheet",sheet==null?"":sheet)));
        return execute(node,new JSONObject(Map.of("filePath",file.toString(),"_workDir",dir.toString())));
    }
    static String readLog(Path path) throws java.io.IOException {
        try(var in=Files.newInputStream(path)){ return new String(in.readNBytes(512*1024),java.nio.charset.StandardCharsets.UTF_8)+(Files.size(path)>512*1024?"\n[界面预览截取前512KB，完整日志保存在成果文件]":""); }
    }
}
