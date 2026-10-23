package com.scinode.research;

import com.alibaba.fastjson2.*;
import com.scinode.engine.WorkflowConfigParser;
import com.scinode.engine.dag.DAGParser;
import com.scinode.engine.model.*;
import com.scinode.engine.llm.ChatClientFactory;
import com.scinode.service.LLMGlobalConfigService;
import com.scinode.entity.LLMGlobalConfig;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.multipart.MultipartFile;
import java.io.IOException;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.regex.*;

@Service
public class ResearchService {
    private final ResearchPreferences preferences;
    private final ResearchStore store;
    private final ResearchToolExecutor tools;
    private final WorkflowConfigParser parser;
    private final DAGParser dag;
    private final ChatClientFactory clients;
    private final LLMGlobalConfigService models;
    private final ModelDiscovery modelDiscovery;
    private final ExecutorService workers=Executors.newFixedThreadPool(2);
    private final Set<String> active=ConcurrentHashMap.newKeySet();
    private final Set<String> pauseRequests=ConcurrentHashMap.newKeySet();
    private static final Pattern REF=Pattern.compile("\\{\\{\\s*([a-zA-Z0-9_.-]+)\\s*}}");
    private static final Set<String> KINDS=Set.of("input","document","llm","pubmed","python","r","check","approve","export","package","mcp");
    public ResearchService(ResearchStore store,ResearchToolExecutor tools,WorkflowConfigParser parser,DAGParser dag,ChatClientFactory clients,LLMGlobalConfigService models,ResearchPreferences preferences){
        this(store,tools,parser,dag,clients,models,new ModelDiscovery(models),preferences);
    }
    @Autowired
    public ResearchService(ResearchStore store,ResearchToolExecutor tools,WorkflowConfigParser parser,DAGParser dag,ChatClientFactory clients,LLMGlobalConfigService models,ModelDiscovery modelDiscovery,ResearchPreferences preferences){
        this.store=store;this.tools=tools;this.parser=parser;this.dag=dag;this.clients=clients;this.models=models;this.modelDiscovery=modelDiscovery;this.preferences=preferences;
    }
    @PostConstruct public void recover() throws IOException {
        // Persisted RUNNING records from a previous process are exposed as interrupted.
        Path root=store.owner("admin").getParent();
        if(!Files.exists(root))return;
        try(var owners=Files.list(root)){
            for(Path owner:owners.filter(Files::isDirectory).toList()){
                String user=new String(Base64.getUrlDecoder().decode(owner.getFileName().toString()),java.nio.charset.StandardCharsets.UTF_8);
                for(JSONObject run:store.list(user,"runs"))if(Set.of("RUNNING","QUEUED").contains(run.getString("status"))){
                    run.put("status","INTERRUPTED"); run.put("error","服务重启中断了此次运行；可创建新运行继续处理");persistRun(user,run);
                }
            }
        }
    }
    @PreDestroy public void close(){workers.shutdownNow();}
    private static String id(){return UUID.randomUUID().toString();}
    private static String now(){return Instant.now().toString();}
    static JSONObject copy(JSONObject obj){return JSON.parseObject(obj.toJSONString());}
    private static String required(JSONObject o,String key){String value=o.getString(key);if(value==null||value.isBlank())throw new IllegalArgumentException("请填写 "+key);return value;}
    private void persistRun(String user,JSONObject run)throws IOException{run.put("updatedAt",now());store.write(user,"runs",run);}
    public List<JSONObject> projects(String user)throws IOException{return store.list(user,"projects").stream().map(this::projectDefaults).toList();}
    public synchronized JSONObject lifecycle(String user,String pid,JSONObject body)throws IOException{
        JSONObject p=project(user,pid);String state=required(body,"lifecycle");
        if(!Set.of("ACTIVE","ARCHIVED","TRASHED").contains(state))throw new IllegalArgumentException("请选择有效的项目状态");
        if(!Objects.equals(body.getInteger("revision"),p.getInteger("revision"))||!Objects.equals(body.getString("updatedAt"),p.getString("updatedAt")))throw new IllegalArgumentException("项目已更新，请刷新后操作");
        if(runs(user,pid).stream().anyMatch(r->Set.of("RUNNING","QUEUED","WAITING_APPROVAL","PAUSED").contains(r.getString("status"))))throw new IllegalArgumentException("请完成或结束当前运行后调整项目状态；已有记录将保留");
        p.put("lifecycle",state);p.put("updatedAt",now());store.write(user,"projects",p);return p;
    }
    private void editable(JSONObject p){if(!"ACTIVE".equals(p.getOrDefault("lifecycle","ACTIVE")))throw new IllegalArgumentException("请先恢复项目到进行中列表，再修改或执行");}
    public JSONObject project(String user,String id)throws IOException{return projectDefaults(store.read(user,"projects",id));}
    private JSONObject projectDefaults(JSONObject p){
        if(p.getString("category")==null){String name=Objects.toString(p.getString("name"),"");String category="其他科研";
            if(name.contains("专利")||name.contains("方案"))category="专利与方案";
            else if(p.getJSONArray("nodes").stream().map(o->((JSONObject)o).getJSONObject("data").getString("kind")).anyMatch(k->"pubmed".equals(k)))category="文献研究";
            else if(p.getJSONArray("nodes").stream().map(o->((JSONObject)o).getJSONObject("data").getString("kind")).anyMatch(k->Set.of("python","r").contains(k)))category="数据分析";
            p.put("category",category);
        }
        return p;
    }
    public synchronized JSONObject create(String user,JSONObject body)throws IOException{
        body=copy(body);
        required(body,"name");
        JSONObject flow=body.containsKey("nodes")||body.containsKey("edges")?new JSONObject(Map.of("nodes",body.getJSONArray("nodes")==null?new JSONArray():body.getJSONArray("nodes"),"edges",body.getJSONArray("edges")==null?new JSONArray():body.getJSONArray("edges"))):ResearchTemplates.flow(body.getString("template"));
        validateGraph(flow);
        String pid=id();Path workspace;
        if(body.getString("workspace")!=null&&!body.getString("workspace").isBlank()){
            Path base=store.resolvePath(body.getString("workspace")).toAbsolutePath().normalize();
            if(!Files.isDirectory(base))throw new IllegalArgumentException("请选择已存在的本地工作目录");
            workspace=base.toRealPath().resolve("SciNode-"+pid);
        }else workspace=store.owner(user).resolve("workspaces").resolve(pid);
        Files.createDirectories(workspace);
        if(Files.getFileStore(workspace).supportsFileAttributeView("posix"))Files.setPosixFilePermissions(workspace,java.nio.file.attribute.PosixFilePermissions.fromString("rwx------"));
        Files.createDirectories(workspace.resolve("inputs"));Files.createDirectories(workspace.resolve("runs"));
        JSONObject p=new JSONObject();p.put("id",pid);p.put("name",required(body,"name"));p.put("workspace",workspace.toAbsolutePath().toString());
        p.put("category",body.getString("category")==null?switch(Objects.toString(body.getString("template"),"blank")){case "patent"->"专利与方案";case "literature"->"文献研究";case "analysis"->"数据分析";default->"其他科研";}:body.getString("category"));p.put("description",Objects.toString(body.getString("description"),""));p.put("lifecycle","ACTIVE");p.put("settings",preferences.normalize(body.getJSONObject("settings")));
        p.put("createdAt",now());p.put("updatedAt",now());p.put("revision",1);p.put("clinicalData",body.getBooleanValue("clinicalData"));
        p.put("nodes",flow.getJSONArray("nodes"));p.put("edges",flow.getJSONArray("edges"));p.put("files",new JSONArray());p.put("versions",new JSONArray());
        version(p,"创建项目");store.write(user,"projects",p);return p;
    }
    private void version(JSONObject p,String note){
        JSONObject v=new JSONObject();v.put("revision",p.getInteger("revision"));v.put("createdAt",now());v.put("note",note);
        v.put("name",p.getString("name"));v.put("category",p.getString("category"));v.put("description",p.getString("description"));v.put("clinicalData",p.getBooleanValue("clinicalData"));v.put("settings",p.getJSONObject("settings")==null?new JSONObject():copy(p.getJSONObject("settings")));
        v.put("nodes",JSON.parseArray(p.getJSONArray("nodes").toJSONString()));v.put("edges",JSON.parseArray(p.getJSONArray("edges").toJSONString()));
        v.put("sha256",ResearchStore.hash(v.toJSONString().getBytes(java.nio.charset.StandardCharsets.UTF_8)));p.getJSONArray("versions").add(v);
    }
    public synchronized JSONObject save(String user,String pid,JSONObject body)throws IOException{
        body=copy(body);
        JSONObject p=project(user,pid);editable(p);
        if(!Objects.equals(body.getInteger("revision"),p.getInteger("revision")))throw new IllegalArgumentException("项目版本已更新，请刷新后保存");
        validateGraph(body);
        for(String key:List.of("category","description"))if(body.containsKey(key))p.put(key,body.getString(key));
        if(body.containsKey("settings"))p.put("settings",preferences.normalize(body.getJSONObject("settings")));
        p.put("name",required(body,"name"));p.put("clinicalData",body.getBooleanValue("clinicalData"));
        p.put("nodes",body.getJSONArray("nodes"));p.put("edges",body.getJSONArray("edges"));p.put("revision",p.getIntValue("revision")+1);p.put("updatedAt",now());
        version(p,body.getString("note")==null?"调整工作流":body.getString("note"));store.write(user,"projects",p);return p;
    }
    public synchronized JSONObject upload(String user,String pid,MultipartFile upload)throws IOException{
        JSONObject p=project(user,pid);editable(p);String name=upload.getOriginalFilename();
        if(name==null||name.contains("/")||name.contains("\\")||name.equals(".")||name.equals(".."))throw new IllegalArgumentException("文件名格式错误");
        if(upload.isEmpty()||upload.getSize()>50*1024*1024)throw new IllegalArgumentException("请上传1字节至50MB的文件");
        String fid=id();Path path=store.resolvePath(p.getString("workspace")).resolve("inputs").resolve(fid+"_"+name);
        upload.transferTo(path);
        JSONObject f=new JSONObject(Map.of("id",fid,"name",name,"path",path.toString(),"size",Files.size(path),"sha256",ResearchStore.hash(path),"importedAt",now()));
        p.getJSONArray("files").add(f);p.put("updatedAt",now());store.write(user,"projects",p);return f;
    }
    public List<JSONObject> runs(String user,String pid)throws IOException{
        project(user,pid);return store.list(user,"runs").stream().filter(r->pid.equals(r.getString("projectId"))).toList();
    }
    public JSONObject run(String user,String rid)throws IOException{return store.read(user,"runs",rid);}
    static Set<String> descendants(JSONObject flow,Set<String> seeds){
        Set<String> result=new HashSet<>(seeds);boolean changed;
        do{changed=false;for(Object o:flow.getJSONArray("edges")){JSONObject e=(JSONObject)o;if(result.contains(e.getString("source")))changed|=result.add(e.getString("target"));}}while(changed);
        return result;
    }
    public List<WorkflowNode> validateGraph(JSONObject flow){
        flow=copy(flow);
        JSONArray ns=flow.getJSONArray("nodes"),es=flow.getJSONArray("edges");
        if(ns==null||ns.isEmpty()||ns.size()>100||es==null)throw new IllegalArgumentException("工作流需要1至100个节点及连接列表");
        Set<String> ids=new HashSet<>();Map<String,String> kinds=new HashMap<>();
        for(Object o:ns){JSONObject n=(JSONObject)o;String nid=required(n,"id");
            if(!nid.matches("[a-zA-Z0-9_-]+")||!ids.add(nid))throw new IllegalArgumentException("节点ID重复或格式错误: "+nid);
            JSONObject d=n.getJSONObject("data");if(d==null||!KINDS.contains(d.getString("kind")))throw new IllegalArgumentException("请选择有效的节点执行方式: "+nid);
            kinds.put(nid,d.getString("kind"));
        }
        Set<String> links=new HashSet<>();
        for(Object o:es){JSONObject e=(JSONObject)o;String s=e.getString("source"),t=e.getString("target");
            if(!ids.contains(s)||!ids.contains(t)||Objects.equals(s,t)||!links.add(s+":"+t))throw new IllegalArgumentException("连接包含缺失节点、自连接或重复连接");
            if("input".equals(kinds.get(t)))throw new IllegalArgumentException("输入节点作为流程起点，请连接到处理节点");
        }
        List<WorkflowNode> order=dag.parse(parser.parse(flow.toJSONString()));
        for(Object o:ns){JSONObject n=(JSONObject)o;String nid=n.getString("id");JSONObject d=n.getJSONObject("data");
            Set<String> parents=new HashSet<>();
            for(String source:ids)if(!source.equals(nid)&&descendants(flow,Set.of(source)).contains(nid))parents.add(source);
            Matcher refs=REF.matcher(d.toJSONString());
            while(refs.find()){String[] path=refs.group(1).split("\\.",2);
                if(path.length!=2||(!"input".equals(path[0])&&!parents.contains(path[0])))throw new IllegalArgumentException("变量引用需要来自已连接的上游节点: "+refs.group(1));
            }
        }
        return order;
    }
    static Object resolve(Object value,JSONObject context){
        if(value instanceof Map<?,?> map){JSONObject out=new JSONObject();map.forEach((k,v)->out.put(k.toString(),resolve(v,context)));return out;}
        if(value instanceof List<?> list){JSONArray out=new JSONArray();list.forEach(v->out.add(resolve(v,context)));return out;}
        if(!(value instanceof String s))return value;
        Matcher matcher=REF.matcher(s);StringBuilder out=new StringBuilder();
        while(matcher.find()){
            Object found=context;for(String key:matcher.group(1).split("\\.")){if(found instanceof Map<?,?> map && map.containsKey(key))found=map.get(key);else throw new IllegalArgumentException("变量缺失: "+matcher.group(1));}
            if(found==null)throw new IllegalArgumentException("变量值为空: "+matcher.group(1));
            if(matcher.start()==0&&matcher.end()==s.length())return found;
            String text=found instanceof Map<?,?>||found instanceof List<?>?JSON.toJSONString(found):found.toString();
            matcher.appendReplacement(out,Matcher.quoteReplacement(text));
        }
        matcher.appendTail(out);return out.toString();
    }
    private JSONObject configIdentity(JSONObject node){JSONObject d=copy(node.getJSONObject("data"));d.remove("label");d.remove("description");return d;}
    public synchronized JSONObject start(String user,String pid,JSONObject body)throws Exception{
        body=copy(body);
        if(!body.getBooleanValue("authorized"))throw new IllegalArgumentException("请先确认此次执行范围");
        if(!active.isEmpty())throw new IllegalArgumentException("当前已有科研任务执行中，请等待节点完成或暂停后启动");
        JSONObject p=copy(project(user,pid));editable(p);if(!Objects.equals(body.getInteger("revision"),p.getInteger("revision")))throw new IllegalArgumentException("请保存当前流程并确认最新版本后执行");
        JSONObject settings=preferences.snapshot(user,p.getJSONObject("settings"));
        if(settings.getLong("defaultConfigId")!=null)for(int i=0;i<p.getJSONArray("nodes").size();i++){JSONObject d=p.getJSONArray("nodes").getJSONObject(i).getJSONObject("data");if("llm".equals(d.getString("kind"))&&d.getLong("configId")==null)d.put("configId",settings.getLong("defaultConfigId"));}
        for(int i=0;i<p.getJSONArray("nodes").size();i++){
            JSONObject d=p.getJSONArray("nodes").getJSONObject(i).getJSONObject("data");
            if(!"llm".equals(d.getString("kind")))continue;
            LLMGlobalConfig selected=modelForNode(d,settings);
            d.put("model",selected.getModel());
        }
        List<WorkflowNode> order=validateGraph(p);
        for(WorkflowNode n:order){JSONObject d=new JSONObject(n.getData());String kind=d.getString("kind");
            if("llm".equals(kind)){if(!body.getBooleanValue("allowModel"))throw new IllegalArgumentException("请确认本次模型发送材料后再运行");modelDiscovery.validateSelection(d.getLong("configId"),d.getString("model"));}
            if(Set.of("python","r").contains(kind))required(d,"script");
            if("check".equals(kind)&&(d.getJSONArray("requiredFields")==null||d.getJSONArray("requiredFields").isEmpty()))throw new IllegalArgumentException("请配置质量检查的必需字段");
            if("document".equals(kind))required(d,"fileId");
            if("pubmed".equals(kind))required(d,"query");
            if("llm".equals(kind))required(d,"prompt");
            if("mcp".equals(kind)){if(d.getLong("mcpId")==null)throw new IllegalArgumentException("请为 MCP 节点选择工具");if(settings.getJSONArray("mcp")==null||settings.getJSONArray("mcp").stream().map(o->(JSONObject)o).noneMatch(o->Objects.equals(o.getLong("id"),d.getLong("mcpId"))))throw new IllegalArgumentException("请在项目或全局设置启用节点所选 MCP");if(d.getJSONObject("arguments")==null)throw new IllegalArgumentException("MCP 参数需要 JSON 对象");}
        }
        JSONObject r=new JSONObject();r.put("id",id());r.put("projectId",pid);r.put("projectName",p.getString("name"));r.put("revision",p.getInteger("revision"));
        r.put("definition",copy(p));r.put("status","QUEUED");r.put("createdAt",now());r.put("updatedAt",now());r.put("inputs",body.getJSONObject("inputs")==null?new JSONObject():body.getJSONObject("inputs"));
        r.put("nodeResults",new JSONObject());r.put("artifacts",new JSONArray());r.put("decisions",new JSONArray());r.put("frozen",false);
        r.put("allowModel",body.getBooleanValue("allowModel"));r.put("scope",body.getString("scope"));
        JSONObject identities=new JSONObject();
        for(WorkflowNode node:order)if("llm".equals(node.getData().get("kind"))){LLMGlobalConfig c=modelForNode(new JSONObject(node.getData()),settings);identities.put(node.getId(),modelIdentity(c));}
        r.put("models",identities);r.put("settingsSnapshot",settings);
        verifyInputs(p);
        if(body.getString("fromRunId")!=null){
            JSONObject previous=run(user,body.getString("fromRunId"));
            if(!pid.equals(previous.getString("projectId")))throw new IllegalArgumentException("请从当前项目选择历史运行");
            if(Set.of("RUNNING","QUEUED","WAITING_APPROVAL","PAUSED").contains(previous.getString("status")))throw new IllegalArgumentException("请先结束或完成来源运行，再创建重跑分支");
            String start=required(body,"startNodeId");
            if(order.stream().noneMatch(n->n.getId().equals(start)))throw new IllegalArgumentException("重跑起点已被删除，请选择现有节点");
            JSONObject old=previous.getJSONObject("definition");Map<String,JSONObject> oldNodes=new HashMap<>();old.getJSONArray("nodes").forEach(o->oldNodes.put(((JSONObject)o).getString("id"),(JSONObject)o));
            Set<String> invalid=new HashSet<>(Set.of(start));
            boolean globalChanged=!Objects.equals(settings,previous.getJSONObject("settingsSnapshot")==null?new JSONObject():previous.getJSONObject("settingsSnapshot"))||!Objects.equals(p.getJSONArray("files").toJSONString(),old.getJSONArray("files").toJSONString())||!Objects.equals(r.getJSONObject("inputs").toJSONString(),previous.getJSONObject("inputs").toJSONString())||r.getBooleanValue("allowModel")!=previous.getBooleanValue("allowModel")||!Objects.equals(identities.toJSONString(),previous.getJSONObject("models").toJSONString());
            for(Object obj:p.getJSONArray("nodes")){JSONObject n=(JSONObject)obj;JSONObject before=oldNodes.get(n.getString("id"));
                if(globalChanged||before==null||!configIdentity(n).equals(configIdentity(before)))invalid.add(n.getString("id"));
                Set<String> incoming=new HashSet<>(),priorIncoming=new HashSet<>();
                for(Object edge:p.getJSONArray("edges"))if(n.getString("id").equals(((JSONObject)edge).getString("target")))incoming.add(((JSONObject)edge).getString("source"));
                for(Object edge:old.getJSONArray("edges"))if(n.getString("id").equals(((JSONObject)edge).getString("target")))priorIncoming.add(((JSONObject)edge).getString("source"));
                if(!incoming.equals(priorIncoming))invalid.add(n.getString("id"));
                if("approve".equals(n.getJSONObject("data").getString("kind")))invalid.add(n.getString("id"));
            }
            invalid=descendants(p,invalid);
            for(WorkflowNode n:order){JSONObject oldResult=previous.getJSONObject("nodeResults").getJSONObject(n.getId());
                if(!invalid.contains(n.getId())&&oldResult!=null&&"SUCCESS".equals(oldResult.getString("status"))){
                    JSONObject reused=copy(oldResult);reused.put("reusedFrom",previous.getString("id"));r.getJSONObject("nodeResults").put(n.getId(),reused);
                    for(Object obj:previous.getJSONArray("artifacts")){JSONObject a=(JSONObject)obj;if(n.getId().equals(a.getString("nodeId"))){verifiedArtifact(previous,a);r.getJSONArray("artifacts").add(copy(a));}}
                }
            }
            r.put("parentRunId",previous.getString("id"));r.put("rerunFrom",start);r.put("invalidatedNodes",invalid);
        }
        Path dir=store.resolvePath(p.getString("workspace")).resolve("runs").resolve(r.getString("id"));Files.createDirectories(dir);
        r.put("runDir",dir.toString());persistRun(user,r);dispatch(user,r.getString("id"));return r;
    }
    private void verifyInputs(JSONObject p)throws IOException{for(Object obj:p.getJSONArray("files")){JSONObject f=(JSONObject)obj;Path path=store.resolvePath(f.getString("path"));if(!Files.isRegularFile(path)||!ResearchStore.hash(path).equals(f.getString("sha256")))throw new IllegalArgumentException("输入文件已改变或缺失，请重新导入: "+f.getString("name"));}}
    JSONObject modelIdentity(LLMGlobalConfig c){return copy(new JSONObject(Map.of("id",c.getId(),"provider",c.getProvider(),"model",c.getModel(),"apiUrl",c.getApiUrl(),"temperature",c.getTemperature()==null?0.2:c.getTemperature(),"credentialHash",ResearchStore.hash(c.getApiKey().getBytes(java.nio.charset.StandardCharsets.UTF_8)))));}
    private LLMGlobalConfig model(Long id){if(id==null)throw new IllegalArgumentException("请为大模型节点选择模型配置");LLMGlobalConfig c=models.getById(id);if(c==null||c.getApiKey()==null||c.getApiKey().isBlank()||c.getApiUrl()==null||c.getApiUrl().isBlank()||c.getModel()==null||c.getModel().isBlank()||c.getProvider()==null||c.getProvider().isBlank())throw new IllegalArgumentException("模型配置缺失，请检查模型设置");return c;}
    LLMGlobalConfig modelForNode(JSONObject data,JSONObject settings){
        Long configId=data.getLong("configId");
        LLMGlobalConfig configured=model(configId);
        String selected=data.getString("model");
        if(selected==null||selected.isBlank()){
            Long defaultConfigId=settings==null?null:settings.getLong("defaultConfigId");
            if(Objects.equals(configId,defaultConfigId)){
                String defaultModel=settings.getString("defaultModel");
                if(defaultModel!=null&&!defaultModel.isBlank())selected=defaultModel;
            }
        }
        if(selected==null||selected.isBlank())return configured;
        LLMGlobalConfig runtime=new LLMGlobalConfig();
        runtime.setId(configured.getId());runtime.setProvider(configured.getProvider());runtime.setConfigName(configured.getConfigName());
        runtime.setApiUrl(configured.getApiUrl());runtime.setApiKey(configured.getApiKey());runtime.setModel(selected.trim());
        runtime.setTtsModel(configured.getTtsModel());runtime.setEmbeddingModel(configured.getEmbeddingModel());runtime.setImageModel(configured.getImageModel());runtime.setVideoModel(configured.getVideoModel());
        runtime.setMemoryEnabled(configured.getMemoryEnabled());runtime.setTemperature(configured.getTemperature());runtime.setIsDefault(configured.getIsDefault());
        runtime.setCreatedAt(configured.getCreatedAt());runtime.setUpdatedAt(configured.getUpdatedAt());runtime.setDeleted(configured.getDeleted());
        return runtime;
    }
    private synchronized void dispatch(String user,String rid){String key=user+":"+rid;if(!active.add(key))throw new IllegalArgumentException("该运行正在执行");workers.submit(()->{try{execute(user,rid);}catch(Exception e){try{JSONObject r=run(user,rid);r.put("status","FAILED");r.put("error",safeError(e));persistRun(user,r);}catch(IOException write){throw new IllegalStateException("运行失败状态写入失败",write);}}finally{active.remove(key);pauseRequests.remove(key);}});}
    private void execute(String user,String rid)throws Exception{
        JSONObject r=run(user,rid),p=r.getJSONObject("definition");List<WorkflowNode> order=validateGraph(p);r.put("status","RUNNING");r.put("error",null);persistRun(user,r);
        JSONObject context=new JSONObject();context.put("input",r.getJSONObject("inputs"));
        for(WorkflowNode node:order){
            String nid=node.getId();JSONObject prior=r.getJSONObject("nodeResults").getJSONObject(nid);
            if(prior!=null&&"SUCCESS".equals(prior.getString("status"))){context.put(nid,prior.getJSONObject("output"));continue;}
            if(Thread.currentThread().isInterrupted())throw new InterruptedException("服务关闭中断运行");
            if(pauseRequests.contains(user+":"+rid)){r.put("status","PAUSED");r.put("currentNodeId",nid);persistRun(user,r);return;}
            JSONObject config=(JSONObject)resolve(node.getData(),context);String kind=config.getString("kind");
            Path dir=store.resolvePath(r.getString("runDir")).resolve(nid);Files.createDirectories(dir);
            JSONObject input=config.getJSONObject("inputs");input=input==null?new JSONObject():copy(input);
            if("document".equals(kind)||config.getString("fileId")!=null){
                String fid=required(config,"fileId");JSONObject file=p.getJSONArray("files").stream().map(o->(JSONObject)o).filter(f->fid.equals(f.getString("id"))).findFirst().orElseThrow(()->new IllegalArgumentException("请重新选择已导入文件"));
                if(!ResearchStore.hash(store.resolvePath(file.getString("path"))).equals(file.getString("sha256")))throw new IllegalArgumentException("输入文件校验失败: "+file.getString("name"));
                input.put("filePath",file.getString("path"));
            }
            if("package".equals(kind)){input.put("artifacts",JSON.parseArray(r.getJSONArray("artifacts").toJSONString()));input.put("nodeResults",copy(r.getJSONObject("nodeResults")));input.put("definition",copy(p));input.put("decisions",JSON.parseArray(r.getJSONArray("decisions").toJSONString()));input.put("models",copy(r.getJSONObject("models")));input.put("settingsSnapshot",r.getJSONObject("settingsSnapshot"));}
            if("mcp".equals(kind))input.put("arguments",copy(config.getJSONObject("arguments")));
            JSONObject result=new JSONObject();result.put("status","RUNNING");result.put("label",config.getString("label"));result.put("startedAt",now());result.put("input",input);result.put("summary","正在处理");
            r.getJSONObject("nodeResults").put(nid,result);r.put("currentNodeId",nid);persistRun(user,r);
            if("approve".equals(kind)){
                result.put("status","WAITING_APPROVAL");result.put("summary",config.getString("question")==null?"等待人工确认":config.getString("question"));
                r.put("status","WAITING_APPROVAL");persistRun(user,r);return;
            }
            try{
                Map<String,Object> output;
                if("llm".equals(kind)){
                    if(!r.getBooleanValue("allowModel"))throw new IllegalArgumentException("此次运行的模型发送授权待确认");
                    LLMGlobalConfig c=modelForNode(config,r.getJSONObject("settingsSnapshot"));
                    modelDiscovery.validateSelection(config.getLong("configId"),c.getModel());
                    if(!modelIdentity(c).equals(r.getJSONObject("models").getJSONObject(nid)))throw new IllegalArgumentException("模型配置已改变，请创建新运行");
                    String prompt=required(config,"prompt");
                    if(prompt.length()>500000)throw new IllegalArgumentException("单次模型材料超过500000字符，请拆分节点");
                    result.put("sentPreview",prompt.substring(0,Math.min(prompt.length(),2000)));result.put("sentCharacters",prompt.length());persistRun(user,r);
                    String content=clients.createClient(c.getProvider(),c.getApiUrl(),c.getApiKey(),c.getModel(),c.getTemperature()==null?0.2:c.getTemperature().doubleValue()).prompt()
                        .system(ResearchPreferences.systemPrompt(r.getJSONObject("settingsSnapshot")))
                        .user(prompt).call().content();
                    if(content==null||content.isBlank())throw new IllegalStateException("模型返回空内容");
                    output=new JSONObject(Map.of("text",content,"model",c.getModel()));
                    Files.createDirectories(dir.resolve("output"));Files.writeString(dir.resolve("output/model-output.md"),content);
                }else if("mcp".equals(kind)){
                    output=preferences.execute(r.getJSONObject("settingsSnapshot"),config.getLong("mcpId"),config.getJSONObject("arguments"));
                    Files.createDirectories(dir.resolve("output"));Files.writeString(dir.resolve("output/mcp-result.json"),JSON.toJSONString(output));
                }else{
                    input.put("_workDir",dir.toString());node.setData(config);output=tools.execute(node,input);input.remove("_workDir");
                }
                result.put("output",new JSONObject(output));result.put("status","SUCCESS");result.put("finishedAt",now());
                result.put("elapsedMs",java.time.Duration.between(Instant.parse(result.getString("startedAt")),Instant.now()).toMillis());
                String text=Objects.toString(output.get("text"),Objects.toString(output.get("stdout"),JSON.toJSONString(output)));result.put("summary",text.substring(0,Math.min(text.length(),240)));
                context.put(nid,new JSONObject(output));collectArtifacts(r,nid,dir);persistRun(user,r);
            }catch(Exception e){input.remove("_workDir");result.put("status","FAILED");result.put("finishedAt",now());result.put("error",safeError(e));result.put("summary","执行失败，请查看日志");collectArtifacts(r,nid,dir);r.put("status","FAILED");r.put("error",safeError(e));persistRun(user,r);return;}
        }
        verifyInputs(p);r.put("status","SUCCESS");r.put("finishedAt",now());r.put("currentNodeId",null);persistRun(user,r);
    }
    private String safeError(Exception e){String text=e.getMessage()==null?e.getClass().getSimpleName():e.getMessage();for(LLMGlobalConfig c:models.list())if(c.getApiKey()!=null&&!c.getApiKey().isBlank())text=text.replace(c.getApiKey(),"[密钥隐藏]");return text.substring(0,Math.min(text.length(),6000));}
    private void collectArtifacts(JSONObject run,String nid,Path dir)throws IOException{
        try(var files=Files.walk(dir)){
            for(Path f:files.filter(Files::isRegularFile).filter(f->f.startsWith(dir.resolve("output"))||f.getFileName().toString().endsWith(".log")).toList()){
                if(!f.toRealPath().startsWith(dir.toRealPath()))throw new IllegalArgumentException("成果文件应位于当前节点目录");
                if(Files.size(f)>100*1024*1024)throw new IllegalArgumentException("单个成果文件超过100MB，请分批输出");
                run.getJSONArray("artifacts").add(new JSONObject(Map.of("nodeId",nid,"name",f.getFileName().toString(),"path",f.toString(),"size",Files.size(f),"sha256",ResearchStore.hash(f))));
            }
        }
    }
    public synchronized JSONObject stop(String user,String rid)throws IOException{
        JSONObject r=run(user,rid);
        if(active.contains(user+":"+rid))throw new IllegalArgumentException("请先暂停，等待当前节点完成后结束运行");
        if(!Set.of("PAUSED","WAITING_APPROVAL","INTERRUPTED").contains(r.getString("status")))throw new IllegalArgumentException("请选择暂停、等待确认或中断的运行");
        r.put("status","CANCELLED");r.put("finishedAt",now());r.getJSONArray("decisions").add(Map.of("action","stop","by",user,"at",now()));persistRun(user,r);return r;
    }
    public synchronized JSONObject pause(String user,String rid)throws IOException{
        JSONObject r=run(user,rid);if(!Set.of("RUNNING","QUEUED").contains(r.getString("status")))throw new IllegalArgumentException("当前运行状态为 "+r.getString("status"));pauseRequests.add(user+":"+rid);return new JSONObject(Map.of("pauseRequested",true,"message","当前节点完成后暂停"));
    }
    public synchronized JSONObject proceed(String user,String rid,JSONObject body)throws IOException{
        body=copy(body);
        JSONObject r=run(user,rid);String status=r.getString("status");
        if(!Set.of("PAUSED","WAITING_APPROVAL").contains(status))throw new IllegalArgumentException("请选择暂停或等待确认的运行");
        if(active.contains(user+":"+rid))throw new IllegalArgumentException("当前节点正在保存状态，请稍后重试");
        verifyInputs(r.getJSONObject("definition"));
        if("WAITING_APPROVAL".equals(status)){
            String nid=r.getString("currentNodeId"),note=required(body,"note");boolean approved=body.getBooleanValue("approved");
            JSONObject decision=new JSONObject(Map.of("nodeId",nid,"approved",approved,"note",note,"by",user,"at",now()));r.getJSONArray("decisions").add(decision);
            JSONObject result=r.getJSONObject("nodeResults").getJSONObject(nid);result.put("finishedAt",now());
            if(!approved){result.put("status","REJECTED");result.put("summary",note);r.put("status","REJECTED");persistRun(user,r);return r;}
            result.put("status","SUCCESS");JSONObject output=new JSONObject(result.getJSONObject("input"));output.put("approved",true);output.put("decision",note);output.putIfAbsent("text",note);result.put("output",output);result.put("summary",note);
        }
        r.put("status","QUEUED");persistRun(user,r);dispatch(user,rid);return r;
    }
    public synchronized JSONObject freeze(String user,String rid)throws IOException{
        JSONObject r=run(user,rid);if(!"SUCCESS".equals(r.getString("status")))throw new IllegalArgumentException("请先完成运行并确认成果");
        if(r.getBooleanValue("frozen"))return r;
        verifyInputs(r.getJSONObject("definition"));
        Path freezeDir=store.resolvePath(r.getString("runDir")).resolve("frozen");Files.createDirectories(freezeDir);
        JSONArray frozen=new JSONArray();int i=0;
        for(Object obj:r.getJSONArray("artifacts")){JSONObject a=(JSONObject)obj;Path original=verifiedArtifact(r,a),target=freezeDir.resolve(String.format("%03d_",i++)+a.getString("name"));
            Files.copy(original,target);if(!ResearchStore.hash(target).equals(a.getString("sha256")))throw new IllegalArgumentException("冻结副本校验失败，请检查文件变化: "+a.getString("name"));JSONObject cloned=copy(a);cloned.put("path",target.toString());frozen.add(cloned);}
        r.put("artifacts",frozen);r.put("frozen",true);r.put("frozenAt",now());r.put("frozenBy",user);
        JSONObject manifest=copy(r);manifest.remove("frozenManifestSha256");Path file=freezeDir.resolve("manifest.json");Files.writeString(file,manifest.toJSONString());
        r.put("frozenManifestSha256",ResearchStore.hash(file));
        r.getJSONArray("artifacts").add(new JSONObject(Map.of("nodeId","freeze","name","manifest.json","path",file.toString(),"size",Files.size(file),"sha256",ResearchStore.hash(file))));
        persistRun(user,r);return r;
    }
    private Path verifiedArtifact(JSONObject run,JSONObject a)throws IOException{
        Path path=store.resolvePath(a.getString("path"));if(!Files.isRegularFile(path))throw new IllegalArgumentException("成果文件缺失: "+a.getString("name"));
        Path workspace=store.resolvePath(run.getJSONObject("definition").getString("workspace")).toRealPath();
        if(!path.toRealPath().startsWith(workspace.resolve("runs")))throw new IllegalArgumentException("成果路径超出项目运行目录");
        if(!ResearchStore.hash(path).equals(a.getString("sha256")))throw new IllegalArgumentException("成果文件校验失败: "+a.getString("name"));return path;
    }
    public Path artifact(String user,String rid,int index)throws IOException{JSONObject r=run(user,rid);if(index<0||index>=r.getJSONArray("artifacts").size())throw new IllegalArgumentException("成果索引错误");return verifiedArtifact(r,r.getJSONArray("artifacts").getJSONObject(index));}
    public List<JSONObject> templates(String user)throws IOException{return store.list(user,"templates");}
    public JSONObject template(String user,JSONObject body)throws IOException{
        body=copy(body);
        JSONObject data=body.getJSONObject("data");if(data==null||!KINDS.contains(data.getString("kind")))throw new IllegalArgumentException("请选择模板执行方式");
        JSONObject t=new JSONObject(Map.of("id",id(),"name",required(body,"name"),"data",data,"updatedAt",now()));store.write(user,"templates",t);return t;
    }
    public void deleteTemplate(String user,String tid)throws IOException{store.read(user,"templates",tid);Files.delete(store.file(user,"templates",tid));}
    public JSONObject testModel(Long configId){
        long started=System.nanoTime();JSONObject report=new JSONObject();LLMGlobalConfig c=model(configId);
        report.put("model",c.getModel());report.put("configName",c.getConfigName());
        try{
            String text=clients.createClient(c.getProvider(),c.getApiUrl(),c.getApiKey(),c.getModel(),c.getTemperature()==null?0.2:c.getTemperature().doubleValue()).prompt().user("连接测试。只输出JSON对象: {\"connected\":true,\"message\":\"SciNode连接成功\"}").call().content();
            boolean call=text!=null&&!text.isBlank();report.put("connected",call);report.put("callSucceeded",call);report.put("reply",text);
            boolean structured=false;
            if(call){String clean=text.trim();if(clean.startsWith("```")){clean=clean.substring(clean.indexOf('\n')+1);clean=clean.substring(0,clean.lastIndexOf("```"));}
                try{JSONObject parsed=JSON.parseObject(clean);structured=parsed.getBooleanValue("connected")&&parsed.getString("message")!=null;}catch(JSONException error){report.put("structureError",error.getMessage());}}
            report.put("structuredOutput",structured);if(!call)report.put("error","模型返回空内容");
        }catch(Exception error){report.put("connected",false);report.put("callSucceeded",false);report.put("structuredOutput",false);report.put("error",safeError(error));}
        report.put("elapsedMs",TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-started));return report;
    }
}
