import {useCallback,useEffect,useMemo,useRef,useState,type MouseEvent as ReactMouseEvent} from 'react';
import {useNavigate,useParams,useSearchParams} from 'react-router-dom';
import {ReactFlow,Background,Controls,MiniMap,Handle,Position,applyNodeChanges,applyEdgeChanges,addEdge,type NodeProps,type Connection,type Edge} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {Alert,Button,Card,Checkbox,Divider,Drawer,Input,Modal,Popconfirm,Select,Space,Spin,Tag,Tabs,message} from 'antd';
import {PlusOutlined,PlayCircleOutlined,PauseOutlined,SaveOutlined,ArrowLeftOutlined,DeleteOutlined,CopyOutlined,UndoOutlined,DownloadOutlined,LockOutlined,LoadingOutlined,ClockCircleOutlined,PauseCircleOutlined,CheckCircleOutlined,CloseCircleOutlined,RobotOutlined} from '@ant-design/icons';
import {useAuthStore} from '../store/authStore';
import LLMConfigModal from '../components/LLMConfigModal';
import {getAllConfigs,type LLMGlobalConfig} from '../api/llmConfig';
import {catalog,categories} from '../research/catalog';
import {ReadableValue} from '../research/StructuredFields';
import NodeConfiguration from '../research/NodeConfiguration';
import {research,errorText} from '../research/api';
import {type ResearchNode,type ResearchData,type Kind,type Project,type Run,type NodeTemplate,type AgentSettings,statusName,statusColor} from '../research/types';
import ProjectDashboard from '../research/ProjectDashboard';
import ResearchSettingsModal from '../research/ResearchSettingsModal';
import ProjectAssistant from '../research/ProjectAssistant';
import ApprovalReview from '../research/ApprovalReview';
import QueryResultPreview from '../research/QueryResultPreview';
import type {AssistantDraft} from '../research/types';
import {activeRunEdges,nodeRunState,runProgress,runStatusAnnouncement,runStatusLabel,runStatusTransition} from '../research/runPresentation.mjs';
import {getMcpTools,type McpToolConfig} from '../api/mcpTools';
import './ResearchPage.css';

function ResearchCard({data,selected}:NodeProps<ResearchNode>){const info=catalog[data.kind],r=data.preview,state=data.runVisualState||'idle';const activity=state==='active'?<><LoadingOutlined spin/> 执行中</>:state==='waiting'?<><ClockCircleOutlined/> 等待确认</>:state==='paused'?<><PauseCircleOutlined/> 已暂停</>:state==='failed'?<><CloseCircleOutlined/> 失败</>:state==='success'?<><CheckCircleOutlined/> 已完成</>:null;return <div className={`science-node ${selected?'selected':''} run-node-${state} ${r?.status==='FAILED'?'failed':''}`} data-run-state={state}><Handle type="target" position={Position.Left}/><div className="node-heading"><span>{info.icon}</span><strong>{data.label}</strong>{activity&&<span className="node-run-indicator" aria-label={state==='active'?'当前节点正在执行':state==='waiting'?'当前节点等待人工确认':state==='paused'?'当前运行已暂停':state==='failed'?'节点执行失败':'节点已完成'}>{activity}</span>}</div><div className="node-kind">{info.label}<Tag color={statusColor[r?.status||'']}>{r?statusName[r.status]:'待执行'}</Tag></div><small className="summary-label">{r?'实际结果摘录':'执行前概况'}</small><p className="node-summary" title={r?.summary||info.description}>{r?.summary||data.description||info.description}</p><div className="node-foot"><small>{r?.elapsedMs!==undefined?`${(r.elapsedMs/1000).toFixed(1)}秒`:'点击查看设置与示例'}{r?.reusedFrom?' · 历史复用':''}</small><button className="nodrag" title="添加下一步" onClick={()=>data.onAppend?.()}>＋</button></div><Handle type="source" position={Position.Right}/></div>;}
const nodeTypes={research:ResearchCard},uid=()=>`n_${crypto.randomUUID().replace(/-/g,'').slice(0,12)}`,pretty=(v:unknown)=>JSON.stringify(v,null,2);
const clean=(ns:ResearchNode[])=>ns.map(n=>{const data={...n.data};delete data.preview;delete data.onAppend;delete data.runVisualState;return {...n,selected:false,data};});
function descendants(es:Edge[],id:string){const set=new Set([id]);let change=true;while(change){change=false;es.forEach(e=>{if(set.has(e.source)&&!set.has(e.target)){set.add(e.target);change=true;}});}return set;}
function layout(ns:ResearchNode[],es:Edge[]){const depth=new Map(ns.map(n=>[n.id,0]));for(let i=0;i<ns.length;i++)es.forEach(e=>depth.set(e.target,Math.max(depth.get(e.target)||0,(depth.get(e.source)||0)+1)));const rows=new Map<number,number>();return ns.map(n=>{const d=depth.get(n.id)||0,r=rows.get(d)||0;rows.set(d,r+1);return {...n,position:{x:d*310,y:r*200}};});}
const presets=[{value:'patent',label:'专利修订'},{value:'literature',label:'文献整理'},{value:'analysis',label:'数据分析（合成示例）'},{value:'blank',label:'空白流程'}];
const PENDING_ASSISTANT_PROJECTS_KEY='scinode.assistant.pendingProjectLinks';
function loadPendingAssistantProjects(){try{return new Map<string,string>(Object.entries(JSON.parse(sessionStorage.getItem(PENDING_ASSISTANT_PROJECTS_KEY)||'{}')));}catch{return new Map<string,string>();}}
function persistPendingAssistantProjects(pending:Map<string,string>){try{sessionStorage.setItem(PENDING_ASSISTANT_PROJECTS_KEY,JSON.stringify(Object.fromEntries(pending)));}catch{/* Keep the in-memory retry path available for this page. */}}

export default function ResearchPage(){
 const nav=useNavigate(),{id}=useParams(),auth=useAuthStore(),[searchParams]=useSearchParams();
 const requestedAssistantSession=searchParams.get('assistantSession')||undefined;
 const [projects,setProjects]=useState<Project[]>([]),[project,setProject]=useState<Project|null>(null),[nodes,setNodes]=useState<ResearchNode[]>([]),[edges,setEdges]=useState<Edge[]>([]),[selectedId,setSelectedId]=useState<string>();
 const [runs,setRuns]=useState<Run[]>([]),[run,setRun]=useState<Run|null>(null),[latest,setLatest]=useState<Record<string,Run|undefined>>({});
 const [frozenTotal,setFrozenTotal]=useState(0),[globalSettings,setGlobalSettings]=useState<AgentSettings>({});
 const [settingsOpen,setSettingsOpen]=useState(false),[settingsProject,setSettingsProject]=useState<Project>(),[newCategory,setNewCategory]=useState('专利与方案'),[newDescription,setNewDescription]=useState(''),[mcpTools,setMcpTools]=useState<McpToolConfig[]>([]);
 const loadMcp=useCallback(async()=>{const r=await getMcpTools();if(r.code!==200)throw new Error(r.message);setMcpTools(r.data);},[]);
 const showSettings=(p?:Project)=>{if(p?.id===project?.id&&dirty){message.info('请先保存当前草稿，再打开项目设置');return;}setSettingsProject(p);setSettingsOpen(true);};
 const [configs,setConfigs]=useState<LLMGlobalConfig[]>([]),[templates,setTemplates]=useState<NodeTemplate[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[dirty,setDirty]=useState(false);
 const [assistantOpen,setAssistantOpen]=useState(()=>!!new URLSearchParams(window.location.search).get('assistantSession')),[assistantInitialRun,setAssistantInitialRun]=useState<{run:Run;nodeId?:string;key:string}>();
 const [runNotice,setRunNotice]=useState<{runId:string;status:string}>();
 const [modelsOpen,setModelsOpen]=useState(false),[createOpen,setCreateOpen]=useState(false),[newName,setNewName]=useState(''),[preset,setPreset]=useState('patent'),[workspace,setWorkspace]=useState(''),[clinical,setClinical]=useState(false);
 const [addOpen,setAddOpen]=useState(false),[kind,setKind]=useState<Kind>('llm'),[nodeName,setNodeName]=useState(''),[append,setAppend]=useState<string>();
 const [runOpen,setRunOpen]=useState(false),[authorized,setAuthorized]=useState(false),[allowModel,setAllowModel]=useState(false),[scope,setScope]=useState('执行当前节点配置，保留原文件，结果另存。'),[runText,setRunText]=useState(''),[rerun,setRerun]=useState(false),[startNode,setStartNode]=useState<string>();
 const [drawer,setDrawer]=useState(false),[tab,setTab]=useState('results'),[note,setNote]=useState('');
 const [canvasFocus,setCanvasFocus]=useState(false),[versionsOpen,setVersionsOpen]=useState(false),[snapshot,setSnapshot]=useState(false);
 const [nodeMenu,setNodeMenu]=useState<{nodeId:string;x:number;y:number;width:number;maxHeight:number}>(),[nodePreviewId,setNodePreviewId]=useState<string>(),[connectSourceId,setConnectSourceId]=useState<string>(),[connectTargetId,setConnectTargetId]=useState<string>();
 const canvasRef=useRef<HTMLElement>(null),nodeMenuRef=useRef<HTMLDivElement>(null),nodeEditorRef=useRef<HTMLFieldSetElement>(null);
 const [artifactPreview,setArtifactPreview]=useState<{name:string;url?:string;text?:string;type?:string}|null>(null);
 const previewUrl=useRef<string>();
 useEffect(()=>()=>{if(previewUrl.current)URL.revokeObjectURL(previewUrl.current);},[]);
 const undoStack=useRef<{nodes:ResearchNode[];edges:Edge[]}[]>([]),uploadRef=useRef<HTMLInputElement>(null),runRef=useRef<Run|null>(null),createdAssistantProjects=useRef(loadPendingAssistantProjects());runRef.current=run;
 const announceRunTransition=useCallback((before:Run|undefined,after:Run,source:'live'|'history'='live')=>{
  const current=runRef.current?.id===after.id?runRef.current:before;
  const transition=runStatusTransition(current,after,source);
  if(!transition){runRef.current=after;return;}
  runRef.current=after;
  const eventKey=transition.key;
  const content=runStatusAnnouncement(after.status);const type=after.status==='FAILED'?'error':after.status==='SUCCESS'?'success':['WAITING_APPROVAL','PAUSED'].includes(after.status)?'warning':'info';
  message.open({key:eventKey,type,content:`${runStatusLabel(after.status)} · ${content}`,duration:5});setRunNotice({runId:after.id,status:after.status});
 },[]);
 const diagnoseRun=useCallback((source:Run,nodeId?:string)=>{setDrawer(false);setAssistantInitialRun({run:source,nodeId,key:crypto.randomUUID()});setAssistantOpen(true);},[]);
 const fail=useCallback((e:unknown)=>{const t=errorText(e);setError(t);message.error(t);},[]);
 const act=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await fn();}catch(e){fail(e);}finally{setBusy(false);}};
 const loadModels=useCallback(async()=>{const r=await getAllConfigs();if(r.code!==200)throw new Error(r.message);setConfigs(r.data);},[]);
 const loadProjects=useCallback(async()=>{const ps=await research.projects();setProjects(ps);const histories=await Promise.all(ps.map(p=>research.runs(p.id)));setLatest(Object.fromEntries(ps.map((p,i)=>[p.id,histories[i][0]])));setFrozenTotal(histories.reduce((n,rs)=>n+rs.filter(r=>r.frozen).length,0));},[]);
 useEffect(()=>{if(!auth.isAuthenticated){nav('/login');return;}Promise.all([loadModels(),research.templates(),loadMcp(),research.settings().then(setGlobalSettings)]).then(([,ts])=>setTemplates(ts)).catch(fail);},[auth.isAuthenticated,nav,loadModels,loadMcp,fail]);
 useEffect(()=>{if(!id&&auth.isAuthenticated)loadProjects().catch(fail);},[id,auth.isAuthenticated,loadProjects,fail]);
 useEffect(()=>{if(id||!Object.values(latest).some(r=>r&&['RUNNING','QUEUED'].includes(r.status)))return;const timer=setInterval(()=>loadProjects().catch(fail),4000);return()=>clearInterval(timer);},[id,latest,loadProjects,fail]);
 useEffect(()=>{let current=true;setRunNotice(undefined);runRef.current=null;setRun(null);setRuns([]);if(!id){setProject(null);return;}setProject(null);setBusy(true);undoStack.current=[];Promise.all([research.project(id),research.runs(id)]).then(([p,rs])=>{if(current){setProject(p);setNodes(p.nodes);setEdges(p.edges);setRuns(rs);runRef.current=rs[0]||null;setRun(rs[0]||null);setDirty(false);setSnapshot(false);setSelectedId(undefined);}}).catch(fail).finally(()=>{if(current)setBusy(false);});return()=>{current=false;};},[id,fail]);
 useEffect(()=>{if(!runRef.current||!['RUNNING','QUEUED'].includes(runRef.current.status))return;let stopped=false;const rid=runRef.current!.id,timer=setInterval(()=>{research.run(rid).then(r=>{if(!stopped&&runRef.current?.id===rid){const before=runRef.current;if(before&&before.status!==r.status)announceRunTransition(before,r);setRun(r);setRuns(rs=>[r,...rs.filter(x=>x.id!==r.id)]);}}).catch(e=>{if(!stopped){clearInterval(timer);fail(e);}});},1800);return()=>{stopped=true;clearInterval(timer);};},[run?.id,run?.status,fail,announceRunTransition]);
 useEffect(()=>{if(run)setRuns(rs=>rs.map(r=>r.id===run.id?run:r));},[run]);
 const approvalNodeId=run?.status==='WAITING_APPROVAL'?run.currentNodeId:run?.definition.nodes.slice().reverse().find(n=>n.data.kind==='approve'&&run.nodeResults[n.id])?.id;
 const visibleNodes=snapshot&&run?run.definition.nodes:nodes;
 const selected=visibleNodes.find(n=>n.id===selectedId),active=runs.some(r=>['RUNNING','QUEUED','WAITING_APPROVAL','PAUSED'].includes(r.status));
 const progress=runProgress(run),currentNodeLabel=run?.definition.nodes.find(n=>n.id===run.currentNodeId)?.data.label||run?.nodeResults[run.currentNodeId||'']?.label||run?.currentNodeId;
 const lifecycleLocked=project?.lifecycle==='ARCHIVED'||project?.lifecycle==='TRASHED';
 const mutationDisabled=snapshot||lifecycleLocked||busy||active;
 const mutationReason=snapshot?'历史运行快照为只读。':lifecycleLocked?'项目归档或位于回收站，恢复项目后可编辑。':busy?'当前操作完成后可编辑节点。':active?'当前运行结束后开放节点编辑。':undefined;
 const contextNode=nodeMenu?visibleNodes.find(n=>n.id===nodeMenu.nodeId):undefined;
 const previewRun=run,previewRunNode=nodePreviewId?run?.definition.nodes.find(n=>n.id===nodePreviewId):undefined,previewNode=previewRunNode||visibleNodes.find(n=>n.id===nodePreviewId),previewResult=previewRunNode&&nodePreviewId?previewRun?.nodeResults[nodePreviewId]:undefined;
 const effectiveDefaultConfigId=project?.settings?.defaultConfigId??(project?.settings?.inheritGlobal!==false?globalSettings.defaultConfigId:undefined);
 const effectiveDefaultModel=project?.settings?.defaultConfigId!==undefined?project.settings.defaultModel:(project?.settings?.inheritGlobal!==false?globalSettings.defaultModel:undefined);
 const modelForNode=(data:ResearchData)=>{const configId=data.configId??effectiveDefaultConfigId,config=configs.find(item=>item.id===configId),model=data.model??(configId===effectiveDefaultConfigId?effectiveDefaultModel:undefined)??config?.model;return {configId,config,model};};
 const history=()=>{undoStack.current.push({nodes:clean(nodes),edges:[...edges]});if(undoStack.current.length>30)undoStack.current.shift();};
 const update=(d:Partial<ResearchData>)=>{if(mutationDisabled)return;setNodes(ns=>ns.map(n=>n.id===selectedId?{...n,data:{...n.data,...d}}:n));setDirty(true);};
 const save=async()=>{const p=await research.save(project!.id,{...project,nodes:clean(nodes),edges});setProject(p);setDirty(false);message.success(`已保存v${p.revision}`);return p;};
 const valid=(c:Connection|Edge)=>!!c.source&&!!c.target&&nodes.some(n=>n.id===c.source)&&nodes.some(n=>n.id===c.target)&&c.source!==c.target&&nodes.find(n=>n.id===c.target)?.data.kind!=='input'&&!edges.some(e=>e.source===c.source&&e.target===c.target)&&!descendants(edges,c.target).has(c.source);
 const contextConnectTargets=contextNode?nodes.filter(n=>valid({source:contextNode.id,target:n.id,sourceHandle:null,targetHandle:null})):[];
 const selectedResult=selected&&run?.definition.nodes.some(n=>n.id===selected.id)?run.nodeResults[selected.id]:undefined;
 const connectTargets=connectSourceId?nodes.filter(n=>valid({source:connectSourceId,target:n.id,sourceHandle:null,targetHandle:null})):[];
 const variables=selected?nodes.filter(n=>n.id!==selected.id&&descendants(edges,n.id).has(selected.id)).flatMap(n=>Array.from(new Set([...catalog[n.data.kind].outputs,...(n.data.outputFields||[]),...Object.keys(run?.nodeResults[n.id]?.output||{})])).map(f=>({value:`{{${n.id}.${f}}}`,label:`${n.data.label} → ${f}`}))):[];
 variables.unshift({value:'{{input.text}}',label:'运行输入 → text'});
 const showAdd=useCallback((k:Kind,source?:string)=>{if(mutationDisabled)return;setNodeMenu(undefined);setKind(k);setAppend(source);setNodeName('');setAddOpen(true);},[mutationDisabled]);
 const add=(template?:ResearchData)=>{if(mutationDisabled)return;history();const nid=uid(),k=template?.kind||kind;const data:ResearchData=template?{...template}:{...catalog[k].example,kind:k,label:nodeName||catalog[k].label,inputs:append?{text:`{{${append}.text}}`}:{}};
  if(k==='llm'&&!template)data.prompt=append?`依据以下资料完成科研任务，保留证据与待确认项。\n{{${append}.text}}`:'请处理本次科研任务：\n{{input.text}}';
  if(k==='llm'&&!data.configId&&effectiveDefaultConfigId)data.configId=effectiveDefaultConfigId;
  if(k==='llm'&&!data.configId&&configs.length===1)data.configId=configs[0].id;
  if(k==='llm'&&!data.model)data.model=modelForNode(data).model;
  setNodes(ns=>[...ns,{id:nid,type:'research',position:{x:(ns.length%3)*310,y:Math.floor(ns.length/3)*200},data}]);if(append)setEdges(es=>[...es,{id:uid(),source:append,target:nid}]);setDirty(true);setSelectedId(nid);setAddOpen(false);
 };
 const visibleCanvasEdges=snapshot&&run?run.definition.edges:edges;
 const flowingEdgeIds=useMemo(()=>new Set(activeRunEdges(visibleCanvasEdges,run).map(edge=>edge.id)),[visibleCanvasEdges,run]);
 const displayEdges=useMemo(()=>visibleCanvasEdges.map(edge=>({...edge,animated:flowingEdgeIds.has(edge.id),className:`${edge.className||''} ${flowingEdgeIds.has(edge.id)?'execution-edge-flow':''}`.trim()})),[visibleCanvasEdges,flowingEdgeIds]);
 const displayNodes=useMemo(()=>(snapshot&&run?run.definition.nodes:nodes).map(n=>({...n,type:'research',data:{...n.data,preview:run?.nodeResults[n.id],runVisualState:nodeRunState(run,n.id),onAppend:()=>{if(!mutationDisabled)showAdd('llm',n.id);}}})),[nodes,run,snapshot,mutationDisabled,showAdd]);
 const openRun=(branch:boolean,branchNodeId?:string)=>{setRerun(branch);setAuthorized(false);setAllowModel(false);setRunText(branch?String(run?.inputs.text||''):'');setStartNode(branch?(branchNodeId||selectedId):undefined);setRunOpen(true);};
 const closeNodeMenu=()=>setNodeMenu(undefined);
 const openNodeMenu=(event:ReactMouseEvent,node:ResearchNode)=>{
  event.preventDefault();event.stopPropagation();setSelectedId(node.id);
  const bounds=canvasRef.current?.getBoundingClientRect();if(!bounds)return;
  const width=Math.min(258,Math.max(180,bounds.width-16)),availableHeight=Math.max(140,Math.min(bounds.height-8,window.innerHeight-bounds.top-16)),height=Math.min(430,availableHeight);
  const x=Math.max(8,Math.min(event.clientX-bounds.left,Math.max(8,bounds.width-width-8)));
  const y=Math.max(8,Math.min(event.clientY-bounds.top,Math.max(8,availableHeight-height)));
  setNodeMenu({nodeId:node.id,x,y,width,maxHeight:height});
 };
 const copyNode=(node:ResearchNode)=>{if(mutationDisabled)return;history();const nid=uid();setNodes(ns=>[...ns,{...node,id:nid,position:{x:node.position.x+35,y:node.position.y+180},selected:false,data:{...node.data,label:node.data.label+' 副本'}}]);setSelectedId(nid);setDirty(true);};
 const saveNodeTemplate=(node:ResearchNode)=>act(async()=>{if(mutationDisabled)return;await research.template({name:node.data.label,data:clean([node])[0].data});setTemplates(await research.templates());message.success('节点模板已保存');});
 const removeNode=(node:ResearchNode)=>{if(mutationDisabled)return;history();setNodes(ns=>ns.filter(n=>n.id!==node.id));setEdges(es=>es.filter(e=>e.source!==node.id&&e.target!==node.id));setSelectedId(undefined);setDirty(true);};
 const confirmDeleteNode=(node:ResearchNode)=>{const downstream=Math.max(0,descendants(edges,node.id).size-1);Modal.confirm({title:`删除“${node.data.label}”？`,content:`将同时移除与此节点相连的连线。${downstream}个下游节点需检查输入映射；此操作可撤销。`,okText:'删除节点',cancelText:'取消',okButtonProps:{danger:true},onOk:()=>removeNode(node)});};
 const beginConnect=(node:ResearchNode)=>{if(mutationDisabled)return;setConnectSourceId(node.id);setConnectTargetId(undefined);setNodeMenu(undefined);};
 const connectExisting=()=>{if(mutationDisabled||!connectSourceId||!connectTargetId||!nodes.some(n=>n.id===connectSourceId)||!nodes.some(n=>n.id===connectTargetId)||!valid({source:connectSourceId,target:connectTargetId,sourceHandle:null,targetHandle:null})){message.warning('源节点或目标节点已变化，请重新选择符合依赖规则的节点。');return;}history();setEdges(es=>addEdge({id:uid(),source:connectSourceId,target:connectTargetId},es));setDirty(true);setConnectSourceId(undefined);setConnectTargetId(undefined);};
 const openNodePreview=(node:ResearchNode)=>{setNodePreviewId(node.id);setNodeMenu(undefined);};
 useEffect(()=>{setNodeMenu(undefined);setNodePreviewId(undefined);setConnectSourceId(undefined);setConnectTargetId(undefined);},[id,project?.id,snapshot,run?.id,run?.status]);
 useEffect(()=>{if(!nodeMenu)return;const menu=nodeMenuRef.current;menu?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  const outside=(event:PointerEvent)=>{if(!nodeMenuRef.current?.contains(event.target as Node))setNodeMenu(undefined);};
  const keys=(event:KeyboardEvent)=>{if(event.key==='Escape'||event.key==='Tab'){if(event.key==='Escape')event.preventDefault();setNodeMenu(undefined);return;}if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;const items=Array.from(nodeMenuRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')||[]);if(!items.length)return;event.preventDefault();const current=items.indexOf(document.activeElement as HTMLButtonElement);const next=event.key==='Home'?0:event.key==='End'?items.length-1:event.key==='ArrowDown'?(current+1)%items.length:(current<=0?items.length-1:current-1);items[next].focus();};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',keys);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',keys);};
 },[nodeMenu]);
 useEffect(()=>{setNodeMenu(undefined);},[nodes,edges]);
 const start=async()=>{const p=dirty?await save():project!;const r=await research.start(p.id,{revision:p.revision,authorized,allowModel,scope,inputs:{text:runText},...(rerun?{fromRunId:run?.id,startNodeId:startNode}:{})});announceRunTransition(runRef.current||undefined,r);setRun(r);setRuns(rs=>[r,...rs]);setRunOpen(false);setSnapshot(false);setTab('results');};
 const updateRunFromAction=async(action:()=>Promise<Run>)=>{const before=runRef.current||undefined;const next=await action();announceRunTransition(before,next);setRun(next);setRuns(rs=>rs.map(item=>item.id===next.id?next:item));return next;};
 const selectHistoricalRun=async(id:string)=>{const before=runRef.current||undefined;setRunNotice(undefined);runRef.current=null;setRun(null);try{const selected=await research.run(id);announceRunTransition(before,selected,'history');setRun(selected);setNote('');}catch(reason){runRef.current=before||null;setRun(before||null);throw reason;}};
 const previewArtifact=async(r:Run,i:number)=>{
  const a=r.artifacts[i],ext=a.name.split('.').pop()?.toLowerCase();
  const blob=await research.blob(r,i);
  if(previewUrl.current){URL.revokeObjectURL(previewUrl.current);previewUrl.current=undefined;}
  if(['png','jpg','jpeg','gif','webp','pdf'].includes(ext||'')){
   const type=ext==='pdf'?'application/pdf':`image/${ext==='jpg'?'jpeg':ext}`;
   previewUrl.current=URL.createObjectURL(new Blob([blob],{type}));setArtifactPreview({name:a.name,url:previewUrl.current,type});
  }else if(['txt','md','json','csv','log'].includes(ext||''))setArtifactPreview({name:a.name,text:(await blob.text()).slice(0,200000)});
  else throw new Error('此格式请下载后在本地查看；文字和图像成果支持界面预览');
 };
 const changeFile=(fileId:string|undefined)=>{if(mutationDisabled)return;update({fileId});if(selected?.data.kind==='document')setNodes(ns=>ns.map(n=>n.data.kind==='export'&&n.data.inputs?.patches?{...n,data:{...n.data,fileId}}:n));};
 const back=()=>{if(dirty)Modal.confirm({title:'当前草稿待保存',content:'返回项目总览将放弃未保存修改。',onOk:()=>nav('/research')});else nav('/research');};
 const applyAssistant=async(draft:AssistantDraft,session:{id:string;revision:number})=>{
  if(project){
   if(mutationDisabled)throw new Error(mutationReason||'当前工作区暂不可修改');
   const latestProject=await research.project(project.id);
   if(latestProject.revision!==project.revision||latestProject.updatedAt!==project.updatedAt)throw new Error('项目已在其他窗口更新，已停止载入，当前工作区保持原样。重新打开项目后，可在原对话中复核最新版并载入草案。');
   history();setProject({...project,name:draft.name,category:draft.category,description:draft.description,clinicalData:draft.clinicalData,settings:draft.settings});
   setNodes(draft.nodes);setEdges(draft.edges);setSelectedId(undefined);setDirty(true);setSnapshot(false);
   message.success('模型配置已载入草稿，可继续调整并保存为新版本');
   return {status:'applied' as const};
  }else{
   let projectId=createdAssistantProjects.current.get(session.id);
   if(!projectId){const created=await research.create({...draft,template:'blank'});projectId=created.id;createdAssistantProjects.current.set(session.id,projectId);persistPendingAssistantProjects(createdAssistantProjects.current);}
   try{
    const latestSession=await research.assistantSession(session.id);
    if(latestSession.projectId&&latestSession.projectId!==projectId)throw new Error('这段对话已关联到另一个项目。');
    if(latestSession.projectId!==projectId)await research.associateAssistantSession(session.id,projectId,latestSession.revision);
   }catch(reason){void loadProjects().catch(()=>undefined);return {status:'association_pending' as const,projectId,projectName:draft.name,error:errorText(reason)};}
   createdAssistantProjects.current.delete(session.id);persistPendingAssistantProjects(createdAssistantProjects.current);
   nav(`/research/${projectId}?assistantSession=${encodeURIComponent(session.id)}`);message.success('项目已创建；原对话、草案与附件已保留在项目内，可继续修改或查看。');
   return {status:'applied' as const,projectId};
  }
 };
 const retryAssistantAssociation=async(sessionId:string,projectId:string)=>{
  const retainedId=createdAssistantProjects.current.get(sessionId);
  if(retainedId&&retainedId!==projectId)throw new Error('重试项目与已保留的项目不一致，请返回原对话处理。');
  const session=await research.assistantSession(sessionId);
  if(session.projectId&&session.projectId!==projectId)throw new Error('这段对话已关联到另一个项目。');
  if(session.projectId!==projectId)await research.associateAssistantSession(sessionId,projectId,session.revision);
  createdAssistantProjects.current.delete(sessionId);persistPendingAssistantProjects(createdAssistantProjects.current);
  nav(`/research/${projectId}?assistantSession=${encodeURIComponent(sessionId)}`);message.success('对话已关联，正在打开新项目。');
 };
 const openAssistant=()=>{if(project&&dirty){Modal.confirm({title:'保存当前调整后打开助手？',content:'助手会读取最新保存的项目配置。保存将生成一个新版本，历史记录保留。',okText:'保存并打开助手',cancelText:'留在工作区',onOk:async()=>{setBusy(true);try{await save();setAssistantOpen(true);}catch(reason){fail(reason);throw reason;}finally{setBusy(false);}}});return;}setAssistantOpen(true);};
 return <div className="scinode-app"><header className="science-header"><div className="science-brand" onClick={back}><img className="brand-mark" src="/brand/scinode-icon.png" alt="SciNode 图标"/><div><strong>SciNode</strong><small>个人科研 AI 工作流</small></div></div><Space><Button type="primary" onClick={openAssistant}>对话助手</Button><Button onClick={()=>setModelsOpen(true)}>模型设置</Button><Button onClick={()=>showSettings()}>全局设置</Button><span>{auth.username}</span><Button type="text" onClick={()=>{auth.clearAuth();nav('/login');}}>退出</Button></Space></header>
 {error&&<Alert type="error" message={error} closable onClose={()=>setError('')} showIcon/>}
 {!id?<ProjectDashboard projects={projects} latest={latest} frozenTotal={frozenTotal} open={p=>nav(`/research/${p.id}`)} create={()=>setCreateOpen(true)} settings={showSettings} lifecycle={(p,state)=>act(async()=>{await research.lifecycle(p,state);await loadProjects();message.success(state==='TRASHED'?'项目已移入回收站':state==='ARCHIVED'?'项目已归档':'项目已恢复');})}/>:busy&&!project?<Spin/>:project&&<>
 <div className="project-toolbar"><Space><Button icon={<ArrowLeftOutlined/>} onClick={back}>项目</Button><Input aria-label="项目名称" value={project.name} disabled={mutationDisabled} onChange={e=>{setProject({...project,name:e.target.value});setDirty(true);}} style={{width:240}}/><Tag>v{project.revision}</Tag>{dirty&&<Tag color="orange">草稿待保存</Tag>}</Space><Space><Button onClick={()=>showSettings(project)} disabled={mutationDisabled}>项目设置</Button><Button onClick={()=>setVersionsOpen(true)}>版本记录</Button><Button icon={<SaveOutlined/>} disabled={mutationDisabled} onClick={()=>act(save)}>保存</Button><Button onClick={()=>setDrawer(true)}>运行与成果</Button><Button type="primary" icon={<PlayCircleOutlined/>} disabled={active||snapshot||project.lifecycle==='ARCHIVED'||project.lifecycle==='TRASHED'||busy} onClick={()=>openRun(false)}>运行流程</Button></Space></div>
 {project.lifecycle&&project.lifecycle!=='ACTIVE'&&<Alert type="info" message="项目处于归档或回收站，恢复后可修改和执行。" action={<Button onClick={()=>act(async()=>{setProject(await research.lifecycle(project,'ACTIVE'));})}>恢复项目</Button>}/>}
 <div className="project-status"><Tag color={run?.frozen?'cyan':statusColor[run?.status||'']}>{run?.frozen?'成果已冻结':run?statusName[run.status]:'待执行'}</Tag><span>{run?`${progress.complete}/${progress.total} 节点完成`:'导入资料 → 设置节点 → 保存 → 运行'}</span>{run?.currentNodeId&&<span>当前：{currentNodeLabel}</span>}{run&&progress.total>0&&<div className="run-progress-wrap"><span>{progress.percent}%</span><div className="run-progress-track" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100} aria-label="运行节点进度"><span style={{width:`${progress.percent}%`}}/></div></div>}{run&&run.revision!==project.revision&&<Tag color="orange">预览来自v{run.revision}</Tag>}{snapshot&&<Tag color="purple">历史快照</Tag>}<Space className="project-status-actions">{run&&(['FAILED','INTERRUPTED'].includes(run.status)||!!run.error||Object.values(run.nodeResults).some(result=>result.status==='FAILED'))&&<Button size="small" icon={<RobotOutlined/>} onClick={()=>diagnoseRun(run,run.currentNodeId||Object.entries(run.nodeResults).find(([,result])=>result.status==='FAILED')?.[0])}>交给助手排查</Button>}{run&&['RUNNING','QUEUED'].includes(run.status)&&<Button size="small" icon={<PauseOutlined/>} onClick={()=>act(async()=>message.info((await research.pause(run.id)).message))}>节点完成后暂停</Button>}{run?.status==='PAUSED'&&<Button size="small" onClick={()=>act(async()=>{await updateRunFromAction(()=>research.proceed(run.id,{}));})}>继续运行</Button>}{run?.status==='WAITING_APPROVAL'&&<Button size="small" type="primary" onClick={()=>{setDrawer(true);setTab('approval');}}>处理待确认事项</Button>}</Space></div>
 {runNotice&&runNotice.runId===run?.id&&<div className="run-transition-live" aria-live="polite"><Alert className="run-transition-notice" type={runNotice.status==='FAILED'?'error':runNotice.status==='SUCCESS'?'success':['WAITING_APPROVAL','PAUSED'].includes(runNotice.status)?'warning':'info'} showIcon message={`${runStatusLabel(runNotice.status)} · ${runStatusAnnouncement(runNotice.status)}`} closable onClose={()=>setRunNotice(undefined)}/></div>}
 <div className={`research-layout ${canvasFocus?'canvas-focus':''}`}><aside className="research-palette"><h3>科研节点</h3><p>点击添加，拖线连接。</p>{Object.entries(catalog).map(([k,c])=><button key={k} disabled={mutationDisabled} onClick={()=>showAdd(k as Kind)}><span>{c.icon}</span><strong>{c.label}</strong><PlusOutlined/></button>)}<Divider/><Button block disabled={mutationDisabled} onClick={()=>showAdd('llm')}>＋ 自定义节点</Button><h4>我的节点模板</h4>{templates.map(t=><div className="template-row" key={t.id}><Button type="text" disabled={mutationDisabled} onClick={()=>{setAppend(undefined);history();const nid=uid();setNodes(ns=>[...ns,{id:nid,type:'research',position:{x:0,y:ns.length*180},data:t.data}]);setDirty(true);setSelectedId(nid);}}>{t.name}</Button><Popconfirm title="删除节点模板？" onConfirm={()=>act(async()=>{if(mutationDisabled)return;await research.deleteTemplate(t.id);setTemplates(await research.templates());})}><Button size="small" type="text" icon={<DeleteOutlined/>} disabled={mutationDisabled}/></Popconfirm></div>)}<Divider/><Button block onClick={()=>{setDrawer(true);setTab('files');}}>输入文件</Button></aside>
 <section className="research-canvas" ref={canvasRef}><div className="canvas-tools"><Space><Button size="small" onClick={()=>setCanvasFocus(!canvasFocus)}>{canvasFocus?'显示节点设置':'放大画布'}</Button><Button size="small" disabled={mutationDisabled} onClick={()=>{history();setNodes(layout(nodes,edges));setDirty(true);}}>自动排列</Button><Button size="small" icon={<UndoOutlined/>} disabled={mutationDisabled||!undoStack.current.length} onClick={()=>{const s=undoStack.current.pop();if(s){setNodes(s.nodes);setEdges(s.edges);setDirty(true);}}}>{snapshot?'只读快照':'撤销'}</Button>{snapshot&&<Button size="small" onClick={()=>setSnapshot(false)}>返回当前草稿</Button>}</Space><small>连接表示依赖；右侧选择输入字段</small></div>
 <ReactFlow nodes={displayNodes} edges={displayEdges} nodeTypes={nodeTypes} fitView minZoom={0.15} deleteKeyCode={null} nodesDraggable={!mutationDisabled} nodesConnectable={!mutationDisabled} isValidConnection={valid} onMoveStart={closeNodeMenu} onNodesChange={cs=>{if(mutationDisabled)return;setNodeMenu(undefined);setNodes(ns=>applyNodeChanges(cs,ns));if(cs.some(c=>c.type==='position'&&c.dragging===false))setDirty(true);}} onEdgesChange={cs=>{if(mutationDisabled)return;if(cs.some(c=>c.type==='remove')){history();setDirty(true);}setEdges(es=>applyEdgeChanges(cs,es));}} onConnect={c=>{if(mutationDisabled||!valid(c))return;setNodeMenu(undefined);history();setEdges(es=>addEdge({...c,id:uid()},es));setDirty(true);}} onNodeClick={(_,n)=>{setNodeMenu(undefined);setSelectedId(n.id);setCanvasFocus(false);}} onNodeContextMenu={openNodeMenu} onPaneClick={()=>{setNodeMenu(undefined);setSelectedId(undefined);}} onEdgeDoubleClick={(_,edge)=>{if(mutationDisabled)return;Modal.confirm({title:'删除此连接？',content:'请检查下游输入映射。可撤销。',onOk:()=>{history();setEdges(es=>es.filter(e=>e.id!==edge.id));setDirty(true);}});}}><Background gap={24} color="#dce6ee"/><Controls/><MiniMap nodeColor="#b2d9d6" pannable zoomable/></ReactFlow>
 {nodeMenu&&contextNode&&<div ref={nodeMenuRef} className="node-context-menu" role="menu" aria-label={`${contextNode.data.label} 节点操作`} style={{left:nodeMenu.x,top:nodeMenu.y,width:nodeMenu.width,maxHeight:nodeMenu.maxHeight}} onPointerDown={event=>event.stopPropagation()} onContextMenu={event=>event.preventDefault()}>
  <div className="node-context-heading"><strong>{contextNode.data.label}</strong><span>{catalog[contextNode.data.kind].label} · 节点操作</span></div>
  {mutationReason&&<p className="node-context-note">{mutationReason}</p>}{!mutationDisabled&&run?.frozen&&<p className="node-context-note frozen">已冻结成果保留原记录；编辑当前草稿并保存后生成新版本。</p>}
  <button role="menuitem" onClick={()=>{setSelectedId(contextNode.id);setCanvasFocus(false);setNodeMenu(undefined);}}>{mutationDisabled?'查看节点设置':'编辑节点设置'}</button>
  <button role="menuitem" onClick={()=>openNodePreview(contextNode)}>查看本节点输入、输出与日志</button>
  {run?.status==='WAITING_APPROVAL'&&run.currentNodeId===contextNode.id&&contextNode.data.kind==='approve'&&<button role="menuitem" onClick={()=>{setDrawer(true);setTab('approval');setNodeMenu(undefined);}}>打开当前待确认事项</button>}
  {(run?.nodeResults[contextNode.id]?.status==='FAILED'||!!run?.nodeResults[contextNode.id]?.error)&&run&&<button role="menuitem" onClick={()=>{diagnoseRun(run,contextNode.id);setNodeMenu(undefined);}}>交给助手排查此节点</button>}
  <div className="node-context-divider" role="separator"/>
  <button role="menuitem" disabled={mutationDisabled} title={mutationDisabled?mutationReason:undefined} onClick={()=>showAdd('llm',contextNode.id)}>添加下一步</button>
  <button role="menuitem" disabled={mutationDisabled} title={mutationDisabled?mutationReason:undefined} onClick={()=>{setNodeMenu(undefined);copyNode(contextNode);}}><CopyOutlined/> 复制节点</button>
  <button role="menuitem" disabled={mutationDisabled} title={mutationDisabled?mutationReason:undefined} onClick={()=>{setNodeMenu(undefined);void saveNodeTemplate(contextNode);}}>存为节点模板</button>
  <button role="menuitem" disabled={mutationDisabled||contextConnectTargets.length===0} title={mutationDisabled?mutationReason:contextConnectTargets.length===0?'没有符合 DAG 规则的目标节点':undefined} onClick={()=>beginConnect(contextNode)}>连接到已有节点</button>
  <button role="menuitem" disabled={mutationDisabled} title={mutationDisabled?mutationReason:undefined} className="danger" onClick={()=>{setNodeMenu(undefined);confirmDeleteNode(contextNode);}}><DeleteOutlined/> 删除节点</button>
  <button role="menuitem" disabled={mutationDisabled||!run} title={mutationDisabled?mutationReason:!run?'当前没有可作为来源的运行记录':undefined} onClick={()=>{const target=contextNode.id;setNodeMenu(undefined);openRun(true,target);}}>从此节点创建重跑分支</button>
 </div>}
 </section>
 {selected?<NodeConfiguration key={selected.id}
  selected={selected}
  project={project}
  run={run}
  selectedResult={selectedResult}
  mutationDisabled={mutationDisabled}
  mutationReason={mutationReason}
  snapshot={snapshot}
  frozenRevision={run?.frozen?run.revision:undefined}
  nodeEditorRef={nodeEditorRef}
  configs={configs}
  modelForNode={modelForNode}
  mcpTools={mcpTools}
  variables={variables}
  onUpdate={update}
  onFileChange={changeFile}
  onPreview={()=>openNodePreview(selected)}
  onCopy={()=>copyNode(selected)}
  onSaveTemplate={()=>void saveNodeTemplate(selected)}
  onDelete={()=>confirmDeleteNode(selected)}
  onRerun={()=>openRun(true,selected.id)}
 />:<aside className="research-config config-placeholder"><h3>{snapshot?'查看历史运行快照':'选择一个节点'}</h3><p>查看节点用途、科研预设、输入资料和输出预览。</p></aside>}
 </div></>}
 <ResearchSettingsModal open={settingsOpen} project={settingsProject} configs={configs} onClose={()=>setSettingsOpen(false)} onToolsChange={()=>loadMcp().catch(fail)} onSave={async(settings,metadata)=>{if(settingsProject){const p=await research.save(settingsProject.id,{...settingsProject,...metadata,settings,note:'更新科研项目与 Agent 设置'});if(project?.id===p.id){setProject(p);setNodes(p.nodes);setEdges(p.edges);setDirty(false);}await loadProjects();message.success(`项目设置已保存为 v${p.revision}`);}else{setGlobalSettings(await research.saveSettings(settings));message.success('全局科研设置已保存');}}}/>
 <Modal title="新建科研项目" open={createOpen} confirmLoading={busy} onCancel={()=>setCreateOpen(false)} onOk={()=>act(async()=>{const p=await research.create({name:newName,template:preset,workspace,clinicalData:clinical,category:newCategory,description:newDescription});setCreateOpen(false);setNewName('');await loadProjects();nav(`/research/${p.id}`);})}><label className="modal-field">项目名称 *<Input value={newName} onChange={e=>setNewName(e.target.value)}/></label><label className="modal-field">科研分类<Select value={newCategory} options={categories.map(v=>({value:v,label:v}))} onChange={setNewCategory}/></label><label className="modal-field">项目简介<Input.TextArea rows={2} value={newDescription} onChange={e=>setNewDescription(e.target.value)}/></label><label className="modal-field">流程模板<Select value={preset} options={presets} onChange={v=>{setPreset(v);setNewCategory(v==='patent'?'专利与方案':v==='literature'?'文献研究':v==='analysis'?'数据分析':'其他科研');}}/></label><label className="modal-field">本地工作目录<Input value={workspace} onChange={e=>setWorkspace(e.target.value)} placeholder="留空使用SciNode目录；或填写已有目录绝对路径"/></label><Checkbox checked={clinical} onChange={e=>setClinical(e.target.checked)}>包含临床个体级数据（默认本地处理）</Checkbox><p>工作目录下创建独立SciNode子目录，导入资料保留副本。</p></Modal>
 <Modal title="创建科研／自定义节点" open={addOpen} onCancel={()=>setAddOpen(false)} onOk={()=>add()}><label className="modal-field">执行方式<Select value={kind} options={Object.entries(catalog).map(([value,c])=>({value,label:c.label}))} onChange={setKind}/></label><label className="modal-field">节点名称<Input value={nodeName} placeholder={catalog[kind].label} onChange={e=>setNodeName(e.target.value)}/></label><Alert type="info" message={catalog[kind].description}/><p>添加后配置输入、提示词或脚本；保存为节点模板即可复用。</p></Modal>
 <Modal title={rerun?'创建重跑分支':'确认执行范围'} open={runOpen} width={720} onCancel={()=>setRunOpen(false)} confirmLoading={busy} onOk={()=>act(start)} okText="按此范围执行" okButtonProps={{disabled:!authorized||rerun&&!startNode}}><Alert type="info" message={`项目v${project?.revision}${dirty?'（执行前保存新版本）':''}`} description={project?.workspace}/>{rerun&&<label className="modal-field">重跑起点<Select value={startNode} options={nodes.map(n=>({value:n.id,label:n.data.label}))} onChange={setStartNode}/></label>}<label className="modal-field">此次任务输入（input.text）<Input.TextArea rows={3} value={runText} onChange={e=>setRunText(e.target.value)}/></label><label className="modal-field">执行范围<Input.TextArea rows={2} value={scope} onChange={e=>setScope(e.target.value)}/></label><div className="execution-model-summary">{nodes.filter(n=>n.data.kind==='llm').map(n=>{const {config,model}=modelForNode(n.data);return <div key={n.id}><strong>{n.data.label}</strong><span>实际模型：{config?.configName||'待配置'}.{model||'待选择'}</span></div>;})}</div><div className="execution-scope">{nodes.map(n=>{const nodeModel=n.data.kind==='llm'?modelForNode(n.data):undefined;return <div key={n.id}><strong>{n.data.label} · {catalog[n.data.kind].label}</strong>{['python','r','llm'].includes(n.data.kind)&&<details><summary>{n.data.kind==='llm'?`模型：${nodeModel?.config?.configName||'待配置'}.${nodeModel?.model||'待选择'} · 查看发送配置`:'查看待执行脚本'}</summary><pre>{n.data.prompt||n.data.script}</pre></details>}{n.data.kind==='mcp'&&<details><summary>MCP：{mcpTools.find(t=>t.id===n.data.mcpId)?.name||'待选择'} · 查看调用参数</summary><ReadableValue value={n.data.arguments}/></details>}{n.data.kind==='pubmed'&&<small>联网检索：{n.data.query}</small>}</div>;})}</div>{nodes.some(n=>n.data.kind==='llm')&&<><Checkbox checked={allowModel} onChange={e=>setAllowModel(e.target.checked)}>允许本次提示词及其中引用的材料发送到所选模型服务</Checkbox>{project?.clinicalData&&<Alert type="warning" message="临床项目：发送材料采用字段说明、汇总结果或已确认内容，个体级资料保留本地。"/>}</>}<Divider/><Checkbox checked={authorized} onChange={e=>setAuthorized(e.target.checked)}>已检查输入文件、节点代码与执行范围，确认按此范围运行</Checkbox></Modal>
 <Drawer title="运行、文件与成果" width={tab==='approval'?'min(1100px, 96vw)':760} open={drawer} onClose={()=>setDrawer(false)}><Tabs activeKey={tab} onChange={setTab} items={[
 {key:'results',label:'运行记录',children:<><Select style={{width:'100%'}} value={run?.id} options={runs.map(r=>({value:r.id,label:`${new Date(r.createdAt).toLocaleString()} · v${r.revision} · ${statusName[r.status]}${r.frozen?' · 已冻结':''}`}))} onChange={rid=>act(()=>selectHistoricalRun(rid))}/>{run&&<><div className="run-actions"><Tag color={statusColor[run.status]}>{statusName[run.status]}</Tag><span>运行{run.id.slice(0,8)} · v{run.revision}</span>{['PAUSED','WAITING_APPROVAL','INTERRUPTED'].includes(run.status)&&<Popconfirm title="结束此运行并保留已有记录？" onConfirm={()=>act(async()=>{await updateRunFromAction(()=>research.stop(run.id));})}><Button size="small">结束此运行</Button></Popconfirm>}<Button size="small" onClick={()=>{setSnapshot(true);setDrawer(false);}}>查看运行快照</Button>{!['RUNNING','QUEUED','WAITING_APPROVAL','PAUSED'].includes(run.status)&&<Button size="small" onClick={()=>openRun(true)}>创建重跑分支</Button>}</div>{run.settingsSnapshot&&<details><summary>实际 Agent 规则、Skills 与 MCP 快照</summary><ReadableValue value={run.settingsSnapshot}/></details>}{run.parentRunId&&<Alert type="info" message={`来源运行：${run.parentRunId}`}/>} {run.error&&<Alert type="error" message={run.error}/>} {run.definition.nodes.map(n=>{const r=run.nodeResults[n.id];return <Card className="result-card" key={n.id} size="small" title={<Space>{n.data.label}<Tag color={statusColor[r?.status||'']}>{r?statusName[r.status]:'待执行'}</Tag></Space>}><p>{r?.summary||catalog[n.data.kind].description}</p>{r?.error&&<Alert type="error" message={r.error}/>}<details><summary>配置与输入</summary><ReadableValue value={{config:n.data,input:r?.input}}/></details>{r?.sentPreview&&<details><summary>实际模型发送：{r.sentCharacters}字符（预览前2000字符）</summary><pre>{r.sentPreview}</pre></details>}{r?.output&&<details><summary>完整输出与日志</summary><ReadableValue value={r.output}/></details>}</Card>;})}</>}</>},
 {key:'approval',label:'人工确认',children:run?<ApprovalReview key={run.id} input={run.nodeResults[approvalNodeId||'']?.input} summary={run.nodeResults[approvalNodeId||'']?.summary} status={run.status} artifacts={run.artifacts} decisions={run.decisions} projectName={run.projectName} runId={run.id} revision={run.revision} busy={busy} actionError={error} note={note} onNoteChange={setNote} onApprove={value=>act(async()=>{await updateRunFromAction(()=>research.proceed(run.id,{approved:true,note:value}));setTab('results');setNote('');})} onReturn={value=>act(async()=>{await updateRunFromAction(()=>research.proceed(run.id,{approved:false,note:value}));setNote('');})}/>:<p>选择运行记录后查看待确认材料与决策。</p>},
 {key:'files',label:'输入文件',children:<><Alert type="info" message="保留原文件，导入副本记录SHA-256。"/><input ref={uploadRef} type="file" style={{display:'none'}} onChange={e=>{const f=e.target.files?.[0];if(f&&project)act(async()=>{await research.upload(project.id,f);const p=await research.project(project.id);setProject(p);message.success('已导入，请在节点中选择文件');});e.target.value='';}}/><Button icon={<PlusOutlined/>} onClick={()=>uploadRef.current?.click()}>导入项目资料</Button>{project?.files.map(f=><Card key={f.id} size="small" title={f.name} className="result-card"><p>{(f.size/1024).toFixed(1)}KB</p><code>{f.sha256}</code><p className="file-path">{f.path}</p></Card>)}</>},
 {key:'artifacts',label:'成果与冻结',children:run&&<><Alert type={run.frozen?'success':'info'} message={run.frozen?'成果已冻结':'检查成果后可冻结此次运行'} description={run.frozen?`记录校验值：${run.frozenManifestSha256}`:'保存成果副本、配置、来源和人工决策；后续调整创建新版本。'}/><Popconfirm title="确认冻结此次成果？" description="请先检查成果内容与证据边界。" onConfirm={()=>act(async()=>{const r=await research.freeze(run.id);setRun(r);setRuns(rs=>rs.map(x=>x.id===r.id?r:x));message.success('成果已冻结');})}><Button icon={<LockOutlined/>} disabled={run.status!=='SUCCESS'||run.frozen}>确认并冻结</Button></Popconfirm>{run.artifacts.map((a,i)=><Card size="small" className="result-card" key={`${a.path}_${i}`} title={a.name} extra={<Space>{/\.(png|jpe?g|gif|webp|pdf|txt|md|json|csv|log)$/i.test(a.name)&&<Button size="small" onClick={()=>act(()=>previewArtifact(run,i))}>预览</Button>}<Button size="small" icon={<DownloadOutlined/>} onClick={()=>act(()=>research.download(run,i))}>下载</Button></Space>}><p>节点：{run.definition.nodes.find(n=>n.id===a.nodeId)?.data.label||a.nodeId} · {(a.size/1024).toFixed(1)}KB</p><code>{a.sha256}</code></Card>)}{!run.artifacts.length&&<p>运行节点后，成果与日志显示在这里。</p>}</>}
 ]}/></Drawer>
 <Modal title="版本与调整影响" open={versionsOpen} width={800} onCancel={()=>setVersionsOpen(false)} footer={null}><Alert type="info" message="每次保存生成新版本。重跑重新执行起点、发生变化的节点及其后续步骤；人工确认重新收集。"/>{project?.versions.slice().reverse().map(v=><Card size="small" className="result-card" key={v.revision} title={`v${v.revision} · ${new Date(v.createdAt).toLocaleString()}`} extra={<Popconfirm title="以此版本创建新草稿？" onConfirm={()=>{history();setNodes(v.nodes);setEdges(v.edges);if(project)setProject({...project,name:v.name||project.name,category:v.category||project.category,description:v.description??project.description,settings:v.settings||project.settings,clinicalData:v.clinicalData??project.clinicalData});setDirty(true);setSnapshot(false);setVersionsOpen(false);}}><Button size="small">恢复为新草稿</Button></Popconfirm>}><p>{v.note} · {v.nodes.length}节点 · {v.edges.length}连接</p>{v.settings&&<details><summary>科研项目与 Agent 设置快照</summary><ReadableValue value={{name:v.name,category:v.category,description:v.description,settings:v.settings}}/></details>}<details><summary>与当前草稿比较</summary><ReadableValue value={v.nodes.map(n=>({id:n.id,name:n.data.label,state:!nodes.some(x=>x.id===n.id)?'当前已删除':pretty(nodes.find(x=>x.id===n.id)?.data)===pretty(n.data)?'配置相同':'配置已调整',config:n.data}))}/></details></Card>)}</Modal>
 <Modal title={artifactPreview?.name} open={!!artifactPreview} width={900} footer={null} onCancel={()=>{setArtifactPreview(null);if(previewUrl.current)URL.revokeObjectURL(previewUrl.current);previewUrl.current=undefined;}}>{artifactPreview?.url?(artifactPreview.type==='application/pdf'?<iframe title="PDF成果预览" src={artifactPreview.url} style={{width:'100%',height:600,border:0}}/>:<img src={artifactPreview.url} alt={artifactPreview.name} style={{maxWidth:'100%'}}/>):<pre>{artifactPreview?.text}</pre>}</Modal>
 <Modal title={`连接“${nodes.find(n=>n.id===connectSourceId)?.data.label||'节点'}”到已有节点`} open={!!connectSourceId} onCancel={()=>{setConnectSourceId(undefined);setConnectTargetId(undefined);}} onOk={connectExisting} okText="建立连接" okButtonProps={{disabled:mutationDisabled||!connectTargetId||!connectTargets.some(n=>n.id===connectTargetId)}}>
  <Alert type="info" message="连线建立依赖关系；新目标的输入映射仍需在节点设置中检查。"/>
  <label className="modal-field">符合依赖规则的目标节点<Select aria-label="目标节点" value={connectTargetId} options={connectTargets.map(n=>({value:n.id,label:`${n.data.label} · ${catalog[n.data.kind].label}`}))} onChange={setConnectTargetId} placeholder="选择目标节点"/></label>
  {!connectTargets.length&&<Alert type="warning" message="当前图中没有可连接的目标节点。"/>}
 </Modal>
 <Modal title={`${previewNode?.data.label||'节点'} · 输入、输出与日志`} open={!!nodePreviewId} width={840} footer={null} onCancel={()=>setNodePreviewId(undefined)}>
  {previewRun?<Alert type="info" message={`运行 ${previewRun.id.slice(0,8)} · 项目版本 v${previewRun.revision}${project&&previewRun.revision!==project.revision?` · 当前草稿 v${project.revision}`:''}`} description={`本页配置和结果使用运行定义 v${previewRun.revision}；状态：${statusName[previewResult?.status||'']||'此节点尚无结果'}。`}/>:<Alert type="info" message="当前项目尚无运行记录；以下仅显示节点配置。"/>}
  <QueryResultPreview value={previewResult?.output?.preview}/>
  {previewNode&&<details open={!previewResult?.output?.preview}><summary>运行定义中的节点配置</summary><ReadableValue value={{id:previewNode.id,kind:previewNode.data.kind,label:previewNode.data.label,config:clean([previewNode])[0].data}}/></details>}
  <details open={!previewResult?.output?.preview}><summary>完整输入</summary><ReadableValue value={previewResult?.input} emptyLabel="此运行尚未记录本节点的实际输入。"/></details>
  <details open={!previewResult?.output?.preview}><summary>完整输出</summary><ReadableValue value={previewResult?.output} emptyLabel="此运行尚未记录本节点的输出。"/></details>
  <details open><summary>执行日志与错误</summary><ReadableValue value={previewResult?.error||previewResult?.output?.stdout||previewResult?.output?.stderr?{error:previewResult.error,stdout:previewResult.output?.stdout,stderr:previewResult.output?.stderr}:undefined} emptyLabel="此节点结果未包含独立日志或错误文本。"/></details>
  {previewResult?.sentPreview&&<details><summary>实际发送内容预览 · {previewResult.sentCharacters} 字符（最多展示前 2000 字符）</summary><pre>{previewResult.sentPreview}</pre></details>}
  {previewRun&&previewRun.artifacts.some(a=>a.nodeId===nodePreviewId)&&<div className="node-preview-artifacts"><strong>本节点成果文件</strong>{previewRun.artifacts.map((a,i)=>({a,i})).filter(({a})=>a.nodeId===nodePreviewId).map(({a,i})=><div className="node-artifact-download" key={`${a.path}-${i}`}><span>{a.name}</span>{/\.(png|jpe?g|gif|webp|pdf|txt|md|json|csv|log)$/i.test(a.name)&&<Button size="small" onClick={()=>act(()=>previewArtifact(previewRun,i))}>预览</Button>}<Button size="small" icon={<DownloadOutlined/>} onClick={()=>act(()=>research.download(previewRun,i))}>下载</Button></div>)}</div>}
 </Modal>
 <ProjectAssistant open={assistantOpen} onClose={()=>setAssistantOpen(false)} project={project||undefined} workingDraft={project?{...project,nodes:clean(nodes),edges}:undefined} hasUnsavedChanges={dirty} run={run||undefined} initialRunContext={assistantInitialRun} initialSessionId={requestedAssistantSession} configs={configs} onApply={applyAssistant} onRetryAssociate={retryAssistantAssociation}/>
 <LLMConfigModal visible={modelsOpen} onClose={()=>{setModelsOpen(false);loadModels().catch(fail);}}/>
 <footer className="science-footer"><span>SciNode · 科研过程可追溯</span></footer>
 </div>;
}
