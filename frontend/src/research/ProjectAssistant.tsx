import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {DragEvent,KeyboardEvent} from 'react';
import {Alert,Button,Checkbox,Empty,Input,Modal,Radio,Select,Tag,Tooltip,message,Spin,Popconfirm} from 'antd';
import {BulbOutlined,DeleteOutlined,LoadingOutlined,ReloadOutlined,RobotOutlined,SendOutlined,PlusOutlined,PaperClipOutlined,ToolOutlined,FileSearchOutlined,HistoryOutlined,FolderOutlined,RollbackOutlined,MenuFoldOutlined,UnorderedListOutlined} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {LLMGlobalConfig} from '../api/llmConfig';
import {categories} from './catalog';
import {errorText,research} from './api';
import {statusName,type AssistantChatMessage,type AssistantContextCard,type AssistantDraft,type AssistantFileAttachment,type AssistantModelCatalogEntry,type AssistantReasoningEffort,type AssistantRequestPhase,type AssistantResource,type AssistantResources,type AssistantSelection,type AssistantSession,type AssistantSessionSummary,type AssistantTask,type AssistantMcpTool,type AssistantMcpCallResult,type Project,type ResearchNode,type Run} from './types';
import ModelSelection from './ModelSelection';
import LocalFilePicker from './LocalFilePicker';
import WorkflowChangePreview from './WorkflowChangePreview';
import {sameWorkflowValue,type WorkflowDefinition} from './workflowReview';
import {assistantRequestMessages} from './assistantConversation';
import {createProjectContextCard,createRunErrorContextCard,contextCardsCharacters,formatContextCardsForModel,materialOnlyPrompt} from './assistantContext.mjs';
import {ReadableValue,TypedParameters} from './StructuredFields';
import './ProjectAssistant.css';

export interface ProjectAssistantProps {
 open:boolean;
 onClose:()=>void;
 project?:Project;
 workingDraft?:WorkflowDefinition;
 hasUnsavedChanges?:boolean;
 run?:Run;
 initialRunContext?:{run:Run;nodeId?:string;key:string};
 initialSessionId?:string;
 configs:LLMGlobalConfig[];
 onApply:(draft:AssistantDraft,session:{id:string;revision:number})=>Promise<{status?:'applied'|'association_pending';projectId?:string;projectName?:string;error?:string}|void>;
 onRetryAssociate?:(sessionId:string,projectId:string)=>Promise<void>;
}

interface PendingRequest {taskId?:string;configId:number;model?:string;reasoningEffort?:AssistantReasoningEffort;messages:Pick<AssistantChatMessage,'role'|'content'|'contextCards'>[];projectId?:string;scopeKey:string;sessionId:string;userText:string;attachments:string[];selections:AssistantSelection;sessionSnapshot:AssistantSession}
interface QuestionAnswer {choice?:string;freeText?:string;modelIds?:number[];uniformCurrent?:boolean}
interface SessionToken {id:string;generation:number}
interface PendingAssociation {sessionId:string;projectId:string;projectName:string;error?:string}
const MAX_MESSAGE_CHARS=12000,MAX_TOTAL_MESSAGE_CHARS=32000,MAX_MESSAGES=20;
const MAX_CONTEXT_CARD_CHARS=8000,MAX_CONTEXT_CARDS=4;
const phaseLabels:Record<AssistantRequestPhase,string>={PREPARING:'正在准备请求',GENERATING:'模型正在生成',VALIDATING:'正在校验草案',REPAIRING:'正在修正草案格式',COMPLETED:'模型响应已完成',CANCELED:'请求已中断',FAILED:'请求处理失败',NOT_FOUND:'正在等待服务端登记'};

function pauseForPoll(signal:AbortSignal,delay=2000){
 return new Promise<void>(resolve=>{
  if(signal.aborted){resolve();return;}
  const timer=window.setTimeout(finish,delay);
  function finish(){window.clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();}
  signal.addEventListener('abort',finish,{once:true});
 });
}

function topologicalOrder(nodes:ResearchNode[],edges:AssistantDraft['edges']){
 const originalOrder=new Map(nodes.map((node,index)=>[node.id,index])),incoming=new Map(nodes.map(node=>[node.id,0])),outgoing=new Map(nodes.map(node=>[node.id,[] as string[]]));
 edges.forEach(edge=>{if(originalOrder.has(edge.source)&&originalOrder.has(edge.target)){outgoing.get(edge.source)?.push(edge.target);incoming.set(edge.target,(incoming.get(edge.target)||0)+1);}});
 const queue=nodes.filter(node=>incoming.get(node.id)===0).map(node=>node.id);let cursor=0;
 while(cursor<queue.length){const id=queue[cursor++];for(const target of outgoing.get(id)||[]){incoming.set(target,(incoming.get(target)||1)-1);if(incoming.get(target)===0)queue.push(target);}}
 if(queue.length!==nodes.length)return undefined;
 return queue.map(id=>nodes[originalOrder.get(id)!]);
}

function topologicalLayout(nodes:ResearchNode[],edges:AssistantDraft['edges'],mode:'horizontal'|'vertical'|'grouped'){
 const ordered=topologicalOrder(nodes,edges);if(!ordered)throw new Error('节点连线中存在循环，修复依赖关系后再排列。');
 const depth=new Map(nodes.map(node=>[node.id,0]));
 for(const node of ordered){for(const edge of edges.filter(item=>item.target===node.id)){depth.set(node.id,Math.max(depth.get(node.id)||0,(depth.get(edge.source)||0)+1));}}
 const groups=new Map<number,ResearchNode[]>();nodes.forEach(node=>{const level=depth.get(node.id)||0;const group=groups.get(level)||[];group.push(node);groups.set(level,group);});
 const kindOrder=['input','document','pubmed','llm','python','r','mcp','check','approve','export','package'];
 return nodes.map(node=>{
  const level=depth.get(node.id)||0,group=groups.get(level)||[];
  const sorted=mode==='grouped'?[...group].sort((a,b)=>kindOrder.indexOf(a.data.kind)-kindOrder.indexOf(b.data.kind)||ordered.indexOf(a)-ordered.indexOf(b)):group;
  const index=sorted.findIndex(candidate=>candidate.id===node.id),position=mode==='vertical'?{x:index*300,y:level*205}:{x:level*310,y:index*205};
  return {...node,position};
 });
}

const suggestions=[
 {label:'规划一个科研项目',text:'请帮我规划一个科研工作流。研究问题：【填写】；已有资料：【填写】；希望交付：【填写】。请先推荐节点数量、节点分工、布局与模型分配，只询问仍需我决定的关键事项。'},
 {label:'检查并完善当前流程',text:'请检查当前流程的节点职责、资料引用、模型分配与人工审核位置，优先修复配置缺口。保留无须改动的节点 ID、现有资料和设置；列出具体改动后生成完整草案。'},
 {label:'文献检索与证据整理',text:'我需要整理【研究问题】的文献证据。请设计检索、文献提取、证据核对、人工确认和导出的流程，并先确认检索范围、交付格式和模型选择。'},
 {label:'修改指定节点',text:'我想调整【节点名称】：【修改要求】。请只修改这一处及必要的上下游连接，保留其余节点 ID 和设置，说明变更后更新草案。'},
];
function assistantError(reason:unknown){
 const text=errorText(reason);
 return /context.{0,18}(length|limit|window)|maximum.{0,20}(token|context)|token.{0,20}(limit|maximum)|prompt.{0,18}(too long|length|limit)|input.{0,18}too long|payload too large|request entity too large|上下文.{0,8}(长度|上限)|提示词.{0,8}(过长|上限)|输入.{0,8}(过长|上限)|413/i.test(text)?`${text} 请缩短输入或清空会话，减少请求上下文后重试。`:text;
}

function runHasDiagnostics(run?:Run){
 return !!run&&(run.status==='FAILED'||!!run.error||Object.values(run.nodeResults).some(result=>result.status==='FAILED'));
}

function sampleMcpArgs(schema:Record<string,unknown>):Record<string,unknown>{
 const properties=(schema.properties&&typeof schema.properties==='object'?schema.properties:{}) as Record<string,{type?:string;default?:unknown;description?:string}>;
 const required=Array.isArray(schema.required)?schema.required as string[]:[];
 return Object.fromEntries(required.map(key=>{
  const property=properties[key]||{};
  const value=property.default!==undefined?property.default:property.type==='integer'||property.type==='number'?0:property.type==='boolean'?false:property.type==='array'?[]:property.type==='object'?{}:'';
  return [key,value];
 }));
}

export default function ProjectAssistant({open,onClose,project,workingDraft,hasUnsavedChanges,run,initialRunContext,initialSessionId,configs,onApply,onRetryAssociate}:ProjectAssistantProps){
 const scopeKey=project?.id||'home';
 const [historyVisible,setHistoryVisible]=useState(()=>window.innerWidth>=1380),[draftVisible,setDraftVisible]=useState(()=>window.innerWidth>680),[reviewOpen,setReviewOpen]=useState(false);
 const previousDraft=workingDraft||project;
 const contextRef=useRef({open,scopeKey});contextRef.current={open,scopeKey};
 const scopeSeen=useRef(scopeKey),requestGeneration=useRef(0),pendingRequest=useRef<PendingRequest>(),taskStartPending=useRef(new Set<string>()),runningTaskSessions=useRef(new Set<string>()),stopAfterStart=useRef(new Set<string>());
 const scrollRef=useRef<HTMLDivElement>(null),latestAssistantRef=useRef<HTMLElement|null>(null);
 const [messages,setMessages]=useState<AssistantChatMessage[]>([]),[input,setInput]=useState(''),[configId,setConfigId]=useState<number>(),[model,setModel]=useState(''),[reasoningEffort,setReasoningEffort]=useState<AssistantReasoningEffort>(),[draft,setDraft]=useState<AssistantDraft>(),[contextCards,setContextCards]=useState<AssistantContextCard[]>([]);
 const [contextPicker,setContextPicker]=useState<'project'|'run'>(),[contextProjects,setContextProjects]=useState<Project[]>([]),[contextProjectId,setContextProjectId]=useState(''),[contextRuns,setContextRuns]=useState<Run[]>([]),[contextRunId,setContextRunId]=useState(''),[contextPickerBusy,setContextPickerBusy]=useState(false),[contextPickerError,setContextPickerError]=useState('');
 const [busy,setBusy]=useState(false),[applying,setApplying]=useState(false),[error,setError]=useState(''),[stoppedNotice,setStoppedNotice]=useState(''),[applyError,setApplyError]=useState('');
 const [retryAvailable,setRetryAvailable]=useState(false),[responseModel,setResponseModel]=useState(''),[applyNotice,setApplyNotice]=useState(''),[applied,setApplied]=useState(false),[clinicalReviewed,setClinicalReviewed]=useState(false),[pendingAssociation,setPendingAssociation]=useState<PendingAssociation>(),[associationRetryBusy,setAssociationRetryBusy]=useState(false),[associationRetryError,setAssociationRetryError]=useState('');
 const [pollingRequestId,setPollingRequestId]=useState(''),[requestPhase,setRequestPhase]=useState<AssistantRequestPhase>(),[statusError,setStatusError]=useState('');
 const [questionAnswers,setQuestionAnswers]=useState<Record<string,QuestionAnswer>>({}),[layoutMode,setLayoutMode]=useState<'suggested'|'horizontal'|'vertical'|'grouped'>('suggested');
 const [modelCatalog,setModelCatalog]=useState<AssistantModelCatalogEntry[]>([]);
 const [sessions,setSessions]=useState<AssistantSessionSummary[]>([]),[sessionId,setSessionId]=useState(''),[sessionTitle,setSessionTitle]=useState('新对话'),[sessionSearch,setSessionSearch]=useState(''),[sessionError,setSessionError]=useState(''),[sessionSaving,setSessionSaving]=useState(false),[sessionRevision,setSessionRevision]=useState(0),[sessionStateError,setSessionStateError]=useState(''),[sessionView,setSessionView]=useState<'active'|'archived'>('active'),[sessionArchived,setSessionArchived]=useState(false),[assistantTask,setAssistantTask]=useState<AssistantTask>();
 const [resources,setResources]=useState<AssistantResources>({skills:[],mcp:[]}),[selectedSkills,setSelectedSkills]=useState<string[]>([]),[toolResults,setToolResults]=useState<AssistantMcpCallResult[]>([]);
 const [resourceMenu,setResourceMenu]=useState(false),[resourceQuery,setResourceQuery]=useState(''),[resourceCursor,setResourceCursor]=useState(0),[mcpOpen,setMcpOpen]=useState(false),[mcpResource,setMcpResource]=useState<AssistantResource>(),[mcpTools,setMcpTools]=useState<AssistantMcpTool[]>([]),[mcpToolName,setMcpToolName]=useState(''),[mcpArgs,setMcpArgs]=useState<Record<string,unknown>>({}),[mcpBusy,setMcpBusy]=useState(false),[mcpError,setMcpError]=useState('');
 const [attachments,setAttachments]=useState<AssistantFileAttachment[]>([]),[attachmentErrors,setAttachmentErrors]=useState<string[]>([]),[uploadsBusy,setUploadsBusy]=useState(0),[uploadError,setUploadError]=useState(''),[localFilesOpen,setLocalFilesOpen]=useState(false),[previewFile,setPreviewFile]=useState<AssistantFileAttachment>();
 const contextPickerGeneration=useRef(0);
 const busyRef=useRef(busy);busyRef.current=busy;
 const sessionViewRef=useRef(sessionView);sessionViewRef.current=sessionView;
 const sessionListGeneration=useRef(0);
 const nativeFileRef=useRef<HTMLInputElement>(null),uploadSlots=useRef(0),sessionRevisionRef=useRef(new Map<string,number>()),sessionSaveTasks=useRef(new Map<string,{timer?:number;pending?:AssistantSession;inFlight?:Promise<void>}>()),sessionHydratedRef=useRef(''),activeSessionRef=useRef(''),sessionGeneration=useRef(0),sessionSnapshotRef=useRef<AssistantSession>(),configsRef=useRef(configs);
 configsRef.current=configs;
 const sessionScopeRef=useRef<string>(),contextCardsRef=useRef(contextCards);
 contextCardsRef.current=contextCards;
 const initialRunHandled=useRef('');
 activeSessionRef.current=sessionId;
 const isTaskStartPending=useCallback((id:string)=>taskStartPending.current.has(id),[]);
 const isSessionTaskBusy=useCallback((id:string)=>taskStartPending.current.has(id)||runningTaskSessions.current.has(id),[]);
 const captureSession=():SessionToken=>({id:activeSessionRef.current,generation:sessionGeneration.current});
 const isCurrentSession=(token:SessionToken)=>!!token.id&&token.id===activeSessionRef.current&&token.generation===sessionGeneration.current;
 sessionSnapshotRef.current=sessionId&&sessionHydratedRef.current===sessionId?{
  id:sessionId,title:sessionTitle,projectId:sessionScopeRef.current==='home'?undefined:sessionScopeRef.current,revision:sessionRevisionRef.current.get(sessionId)||sessionRevision,
  messageCount:messages.length,updatedAt:new Date().toISOString(),configId,model,reasoningEffort:reasoningEffort??null,messages,draft,questionAnswers,layoutMode,attachments,selections:{skills:selectedSkills,mcpResultIds:toolResults.filter(result=>!result.error).map(result=>result.id)},toolResults,input,
  contextCards,
 }:undefined;

 const persistSession=useCallback((snapshot:AssistantSession):Promise<void>=>{
  const id=snapshot.id,task=sessionSaveTasks.current.get(id)||{};
  task.pending={...snapshot};sessionSaveTasks.current.set(id,task);
  if(task.timer){window.clearTimeout(task.timer);task.timer=undefined;}
  if(task.inFlight)return task.inFlight.then(async()=>{if(task.pending)await persistSession(task.pending);});
  const work=(async()=>{
   while(task.pending){
    const next=task.pending;task.pending=undefined;const revision=sessionRevisionRef.current.get(id)??next.revision;
    setSessionSaving(id===activeSessionRef.current);
    try{
     const saved=await research.saveAssistantSession(id,{...next,revision});
     sessionRevisionRef.current.set(id,saved.revision);
     if(activeSessionRef.current===id){setSessionRevision(saved.revision);setSessionStateError('');}
     setSessions(current=>current.map(item=>item.id===id?{...item,title:saved.title,revision:saved.revision,updatedAt:saved.updatedAt,messageCount:saved.messages?.length??next.messages.length}:item));
    }catch(reason){
     task.pending=next;
     if(activeSessionRef.current===id)setSessionStateError(errorText(reason));
     throw reason;
    }finally{setSessionSaving(false);}
   }
  })();
  task.inFlight=work;
  void work.finally(()=>{if(task.inFlight===work)task.inFlight=undefined;}).catch(()=>undefined);
  return work;
 },[]);
 const flushSession=useCallback(async()=>{
  const snapshot=sessionSnapshotRef.current;if(!snapshot||busyRef.current||isSessionTaskBusy(snapshot.id))return;
  const task=sessionSaveTasks.current.get(snapshot.id);
  if(task?.timer){window.clearTimeout(task.timer);task.timer=undefined;}
  await persistSession(snapshot);
 },[persistSession,isSessionTaskBusy]);
 const clearTransientSessionUi=useCallback(()=>{
  setResourceMenu(false);setResourceQuery('');setResourceCursor(0);setMcpOpen(false);setMcpResource(undefined);setMcpTools([]);setMcpToolName('');setMcpArgs({});setMcpBusy(false);setMcpError('');
  setLocalFilesOpen(false);setPreviewFile(undefined);
  uploadSlots.current=0;setAttachmentErrors([]);setUploadsBusy(0);setUploadError('');
 },[]);
 const hydrateSession=useCallback((session:AssistantSession,token:number)=>{
  if(token!==sessionGeneration.current)return;
  sessionRevisionRef.current.set(session.id,session.revision);sessionScopeRef.current=session.projectId||'home';sessionHydratedRef.current=session.id;setSessionId(session.id);setSessionTitle(session.title||'新对话');setSessionRevision(session.revision);
  const restoredContextCards=session.contextCards||[];contextCardsRef.current=restoredContextCards;
  setMessages(session.messages||[]);setDraft(session.draft);setQuestionAnswers((session.questionAnswers||{}) as Record<string,QuestionAnswer>);setLayoutMode(session.layoutMode||'suggested');setAttachments(session.attachments||[]);setContextCards(restoredContextCards);setSessionArchived(!!session.archived);setReviewOpen(false);
  setReasoningEffort(session.reasoningEffort||undefined);
  const restoredSelections=session.selections||{skills:[],mcpResultIds:[]};setSelectedSkills(restoredSelections.skills||[]);setToolResults(session.toolResults||(session.messages||[]).flatMap(item=>item.toolResults||[]).filter(result=>(restoredSelections.mcpResultIds||[]).includes(result.id)));
  const availableConfigs=configsRef.current,restoredConfig=availableConfigs.find(config=>config.id===session.configId),defaultConfig=availableConfigs.find(config=>config.isDefault===1)||availableConfigs[0],selectedConfig=restoredConfig||defaultConfig;
  setConfigId(selectedConfig?.id);setModel(restoredConfig?session.model||restoredConfig.model:selectedConfig?.model||'');setInput(session.input||'');setSessionStateError('');pendingRequest.current=undefined;
  const task=session.assistantTask;setAssistantTask(task);if(task?.status==='RUNNING')runningTaskSessions.current.add(session.id);else runningTaskSessions.current.delete(session.id);
  if(task&&['FAILED','CANCELED','INTERRUPTED'].includes(task.status)&&task.request){const request=task.request;const userText=task.userText||[...(request.messages||[])].reverse().find(item=>item.role==='user')?.content||'';pendingRequest.current={configId:request.configId,model:request.model,reasoningEffort:request.reasoningEffort,messages:request.messages,projectId:request.projectId,scopeKey:session.projectId||'home',sessionId:session.id,userText,attachments:request.attachments||[],selections:request.selections||{skills:[],mcpResultIds:[]},sessionSnapshot:session};}
  const canRetry=!!(task&&['FAILED','CANCELED','INTERRUPTED'].includes(task.status)&&task.request);setRetryAvailable(canRetry);
  setError(task?.status==='CANCELED'?'':canRetry?task?.error||'本轮请求已中断，可重试。':'');setStoppedNotice(task?.status==='CANCELED'?'本轮回复已中断。你可以修改问题或更换模型后重新发送。':'');setApplyError('');setResponseModel(task?.responseModel||'');setApplyNotice('');setApplied(false);setClinicalReviewed(false);setPendingAssociation(undefined);setAssociationRetryError('');setRequestPhase(task?.phase);setStatusError('');setPollingRequestId(task?.id||'');setBusy(task?.status==='RUNNING');setApplying(false);clearTransientSessionUi();
  setSessions(current=>current.map(item=>item.id===session.id?{...item,title:session.title,revision:session.revision,updatedAt:session.updatedAt,messageCount:session.messages?.length||0,archived:!!session.archived,taskStatus:task?.status,taskPhase:task?.phase,taskError:task?.error}:item));
 },[clearTransientSessionUi]);
 const openSession=useCallback(async(id:string)=>{
  if(!id||id===activeSessionRef.current)return;
  const prior=sessionSnapshotRef.current,token=++sessionGeneration.current;sessionHydratedRef.current='';clearTransientSessionUi();setSessionStateError('');setSessionError('');
  try{if(prior&&!busyRef.current&&!isSessionTaskBusy(prior.id))await persistSession(prior);if(token!==sessionGeneration.current)return;const session=await research.assistantSession(id);if(token===sessionGeneration.current)hydrateSession(session,token);}
  catch(reason){if(token===sessionGeneration.current){if(prior)sessionHydratedRef.current=prior.id;setSessionError(errorText(reason));}}
 },[persistSession,hydrateSession,clearTransientSessionUi,isSessionTaskBusy]);
 const createSession=useCallback(async()=>{
  const prior=sessionSnapshotRef.current,token=++sessionGeneration.current;sessionHydratedRef.current='';clearTransientSessionUi();setSessionError('');setSessionStateError('');pendingRequest.current=undefined;setRetryAvailable(false);sessionViewRef.current='active';setSessionView('active');
  try{
   if(prior&&!busyRef.current&&!isSessionTaskBusy(prior.id))await persistSession(prior);
   if(token!==sessionGeneration.current)return;
   const session=await research.createAssistantSession({projectId:project?.id});
   if(token!==sessionGeneration.current)return;
   hydrateSession(session,token);setSessions(current=>[session,...current.filter(item=>item.id!==session.id)]);
  }catch(reason){if(token===sessionGeneration.current){if(prior)sessionHydratedRef.current=prior.id;setSessionError(errorText(reason));}}
 },[persistSession,hydrateSession,clearTransientSessionUi,project?.id,isSessionTaskBusy]);

 const retryWorkspaceLoad=useCallback(async()=>{
  const token=++sessionGeneration.current,viewToken=++sessionListGeneration.current,watchedScope=scopeKey;
  setSessionError('');setSessionStateError('');sessionHydratedRef.current='';
  try{
   if(initialSessionId&&!project?.id)throw new Error('关联项目仍在载入，请稍后重试。');
   const listing=await research.assistantSessions(project?.id,false);
   if(!contextRef.current.open||contextRef.current.scopeKey!==watchedScope||token!==sessionGeneration.current||viewToken!==sessionListGeneration.current)return;
   const sorted=[...listing].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));setSessions(sorted);sessionViewRef.current='active';setSessionView('active');
   if(initialSessionId){
    const session=await research.assistantSession(initialSessionId);
    if(session.projectId!==project?.id)throw new Error('原对话尚未关联到当前项目。');
    if(contextRef.current.open&&contextRef.current.scopeKey===watchedScope&&token===sessionGeneration.current&&viewToken===sessionListGeneration.current){hydrateSession(session,token);setSessions(current=>current.some(item=>item.id===session.id)?current:[session,...current]);}
    return;
   }
   const selected=sorted[0]?await research.assistantSession(sorted[0].id):await research.createAssistantSession({projectId:project?.id});
   if(contextRef.current.open&&contextRef.current.scopeKey===watchedScope&&token===sessionGeneration.current&&viewToken===sessionListGeneration.current){hydrateSession(selected,token);if(!sorted.length)setSessions([selected]);}
  }catch(reason){if(contextRef.current.open&&contextRef.current.scopeKey===watchedScope&&token===sessionGeneration.current&&viewToken===sessionListGeneration.current)setSessionError(errorText(reason));}
 },[scopeKey,initialSessionId,project?.id,hydrateSession]);
 const deleteSession=async(id:string)=>{
  const deletingActive=id===activeSessionRef.current,token=deletingActive?++sessionGeneration.current:sessionGeneration.current;
  try{await research.deleteAssistantSession(id);runningTaskSessions.current.delete(id);taskStartPending.current.delete(id);stopAfterStart.current.delete(id);setSessions(current=>current.filter(item=>item.id!==id));if(deletingActive&&token===sessionGeneration.current){sessionSnapshotRef.current=undefined;sessionHydratedRef.current='';setSessionId('');setBusy(false);setPollingRequestId('');const remaining=sessions.find(item=>item.id!==id);if(remaining)await openSession(remaining.id);else{sessionViewRef.current='active';setSessionView('active');await createSession();}}}
  catch(reason){if(deletingActive&&token===sessionGeneration.current)setSessionError(errorText(reason));}
 };
 const changeArchive=async(id:string,archive:boolean)=>{
  try{
   const updated=archive?await research.archiveAssistantSession(id):await research.unarchiveAssistantSession(id);
   if(id===activeSessionRef.current)setSessionArchived(!!updated.archived);
   setSessions(current=>current.filter(item=>item.id!==id));
  }catch(reason){setSessionError(errorText(reason));}
 };

 useEffect(()=>{
  if(!open)return;
  if(initialSessionId&&!project?.id){setSessionView('active');sessionViewRef.current='active';setSessionId('');setSessionError('');setSessions([]);return;}
  let current=true;const token=++sessionGeneration.current;
  setSessionView('active');sessionViewRef.current='active';const viewToken=++sessionListGeneration.current;
  const oldSnapshot=sessionSnapshotRef.current;
  if(oldSnapshot&&!busyRef.current&&!isSessionTaskBusy(oldSnapshot.id)&&sessionScopeRef.current&&sessionScopeRef.current!==scopeKey)void persistSession(oldSnapshot).catch(()=>undefined);
  clearTransientSessionUi();
  sessionHydratedRef.current='';setSessionId('');setSessionError('');setSessionStateError('');setSessions([]);setSessionSearch('');
  void research.assistantResources(project?.id).then(catalog=>{if(current&&token===sessionGeneration.current)setResources(catalog);}).catch(reason=>{if(current&&token===sessionGeneration.current)setSessionError(errorText(reason));});
  void (async()=>{
   const listing=await research.assistantSessions(project?.id,false);
   if(!current||token!==sessionGeneration.current||viewToken!==sessionListGeneration.current)return;
   const sorted=[...listing].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));setSessions(sorted);
   if(initialSessionId){
    const session=await research.assistantSession(initialSessionId);
    if(session.projectId!==project?.id)throw new Error('原对话尚未关联到当前项目。');
    if(current&&token===sessionGeneration.current&&viewToken===sessionListGeneration.current)hydrateSession(session,token);
    return;
   }
   const session=sorted.length?await research.assistantSession(sorted[0].id):await research.createAssistantSession({projectId:project?.id});
   if(current&&token===sessionGeneration.current&&viewToken===sessionListGeneration.current){hydrateSession(session,token);if(!sorted.length)setSessions([session]);}
  })().catch(reason=>{if(current&&token===sessionGeneration.current&&viewToken===sessionListGeneration.current)setSessionError(errorText(reason));});
  return()=>{current=false;};
 },[open,scopeKey,project?.id,initialSessionId,hydrateSession,persistSession,clearTransientSessionUi,isSessionTaskBusy]);

 const loadSessionView=async(view:'active'|'archived')=>{
  const viewToken=++sessionListGeneration.current,watchedScope=scopeKey;sessionViewRef.current=view;setSessionView(view);setSessionError('');
  try{const listing=await research.assistantSessions(project?.id,view==='archived');if(!contextRef.current.open||contextRef.current.scopeKey!==watchedScope||sessionViewRef.current!==view||viewToken!==sessionListGeneration.current)return;setSessions([...listing].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));}
  catch(reason){if(contextRef.current.open&&contextRef.current.scopeKey===watchedScope&&sessionViewRef.current===view&&viewToken===sessionListGeneration.current)setSessionError(errorText(reason));}
 };

 const hasRunningSession=sessions.some(item=>item.taskStatus==='RUNNING');
 useEffect(()=>{
  if(!open||!hasRunningSession)return;
  const watchedView=sessionView,watchedScope=scopeKey,viewToken=sessionListGeneration.current;let current=true,timer:number|undefined;
  const poll=async()=>{
   await new Promise<void>(resolve=>{timer=window.setTimeout(resolve,2500);});
   if(!current)return;
   try{
    const listing=await research.assistantSessions(project?.id,watchedView==='archived');
    if(current&&contextRef.current.open&&contextRef.current.scopeKey===watchedScope&&sessionViewRef.current===watchedView&&sessionListGeneration.current===viewToken)setSessions([...listing].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));
   }catch{/* Keep the last known task state; the selected-session poll reports its own errors. */}
   if(current)void poll();
  };
  void poll();
  return()=>{current=false;if(timer)window.clearTimeout(timer);};
 },[open,hasRunningSession,sessionView,scopeKey,project?.id]);

 useEffect(()=>{
  if(!sessionId||sessionHydratedRef.current!==sessionId||busy||isTaskStartPending(sessionId))return;
  const snapshot=sessionSnapshotRef.current;if(!snapshot)return;
  const task=sessionSaveTasks.current.get(sessionId)||{};if(task.timer)window.clearTimeout(task.timer);
  task.timer=window.setTimeout(()=>{task.timer=undefined;if(busyRef.current||isSessionTaskBusy(sessionId)||activeSessionRef.current!==sessionId)return;void persistSession(sessionSnapshotRef.current?.id===sessionId?sessionSnapshotRef.current:snapshot).catch(()=>undefined);},700);
  sessionSaveTasks.current.set(sessionId,task);
  return()=>{if(task.timer){window.clearTimeout(task.timer);task.timer=undefined;}};
 },[open,sessionId,sessionTitle,messages,input,configId,model,reasoningEffort,draft,questionAnswers,layoutMode,attachments,selectedSkills,toolResults,busy,persistSession,isTaskStartPending,isSessionTaskBusy]);
 useEffect(()=>{if(!open)return;return()=>{void flushSession().catch(reason=>message.error(`会话自动保存失败，请重新打开会话后重试保存：${errorText(reason)}`));};},[open,flushSession]);

 const filteredSessions=useMemo(()=>sessions.filter(item=>item.title.toLocaleLowerCase().includes(sessionSearch.toLocaleLowerCase())),[sessions,sessionSearch]);
 const mcpAvailable=(resource:AssistantResource)=>resource.enabled!==false&&!/disabled|unsupported|unavailable|invalid|停用|不支持|不可用|无效/i.test(resource.status||'')&&(!resource.transport||/^(stdio)$/i.test(resource.transport));
 const filteredSkills=useMemo(()=>resources.skills.filter(resource=>resource.name.toLocaleLowerCase().includes(resourceQuery.toLocaleLowerCase())||(resource.description||'').toLocaleLowerCase().includes(resourceQuery.toLocaleLowerCase())),[resources.skills,resourceQuery]);
 const filteredMcp=useMemo(()=>resources.mcp.filter(resource=>resource.name.toLocaleLowerCase().includes(resourceQuery.toLocaleLowerCase())),[resources.mcp,resourceQuery]);
 const updateComposer=(value:string)=>{
  setInput(value);
  const slash=value.match(/(?:^|\s)\/([^\s]*)$/);
  if(slash){setResourceQuery(slash[1]);setResourceCursor(0);setResourceMenu(true);}else setResourceMenu(false);
  if(/(?:^|\s)@$/.test(value))setLocalFilesOpen(true);
 };
 const addAttachment=async(file:File)=>{
  const token=captureSession();if(!isCurrentSession(token))return;
  if(attachments.length+uploadSlots.current>=5){setAttachmentErrors(current=>[...current,'单个会话最多添加5个附件。']);return;}
  if(file.size>20*1024*1024){setAttachmentErrors(current=>[...current,`${file.name}：文件大小超过20MB。`]);return;}
  if(!/\.(docx|pdf|txt|md|csv|json)$/i.test(file.name)){setAttachmentErrors(current=>[...current,`${file.name}：支持docx、pdf、txt、md、csv、json。`]);return;}
  uploadSlots.current++;setUploadsBusy(current=>current+1);
  try{const uploaded=await research.uploadAssistantFile(file);if(!isCurrentSession(token))return;setAttachments(current=>[...current,uploaded]);setAttachmentErrors(current=>current.filter(item=>!item.startsWith(`${file.name}：`)));}
  catch(reason){if(isCurrentSession(token))setAttachmentErrors(current=>[...current,`${file.name}：${errorText(reason)}`]);}
  finally{if(isCurrentSession(token)){uploadSlots.current=Math.max(0,uploadSlots.current-1);setUploadsBusy(current=>Math.max(0,current-1));}}
 };
 const addLocalAttachment=async(path:string)=>{
  const token=captureSession();if(!isCurrentSession(token))return;
  if(attachments.length+uploadSlots.current>=5)throw new Error('单个会话最多添加5个附件。');
  const pathSegments=path.replace(/[\\/]+$/,'').split(/[\\/]/).filter(Boolean),fileName=pathSegments[pathSegments.length-1]||path;
  uploadSlots.current++;setUploadsBusy(current=>current+1);
  try{const uploaded=await research.uploadAssistantLocalFile(path);if(!isCurrentSession(token))return;setAttachments(current=>[...current,uploaded]);setInput(current=>current.replace(/(?:^|\s)@$/,''));setLocalFilesOpen(false);}
  catch(reason){if(isCurrentSession(token))setAttachmentErrors(current=>[...current,`${fileName}：${errorText(reason)}`]);throw reason;}
  finally{if(isCurrentSession(token)){uploadSlots.current=Math.max(0,uploadSlots.current-1);setUploadsBusy(current=>Math.max(0,current-1));}}
 };
 const previewAttachment=async(file:AssistantFileAttachment)=>{
  const token=captureSession();if(!isCurrentSession(token))return;
  try{const full=file.content!==undefined?file:await research.assistantFile(file.id);if(isCurrentSession(token))setPreviewFile(full);}
  catch(reason){if(isCurrentSession(token))setUploadError(errorText(reason));}
 };
 const loadMcpTools=async(resource:AssistantResource)=>{
  const token=captureSession();if(!isCurrentSession(token)||!mcpAvailable(resource))return;
  setMcpResource(resource);setMcpOpen(true);setMcpBusy(true);setMcpError('');setMcpTools([]);setMcpToolName('');setMcpArgs({});
  try{const result=await research.inspectAssistantMcp(resource.id,project?.id);if(!isCurrentSession(token))return;setMcpTools(result.tools);const first=result.tools[0];if(first){setMcpToolName(first.name);setMcpArgs(sampleMcpArgs(first.inputSchema));}}
  catch(reason){if(isCurrentSession(token))setMcpError(errorText(reason));}
  finally{if(isCurrentSession(token))setMcpBusy(false);}
 };
 const callMcp=async()=>{
  if(!mcpResource||!mcpToolName||!mcpAvailable(mcpResource))return;
  const token=captureSession();if(!isCurrentSession(token))return;
  setMcpBusy(true);setMcpError('');
  try{
   if(!mcpArgs||Array.isArray(mcpArgs)||typeof mcpArgs!=='object')throw new Error('参数必须为对象');
   const result=await research.callAssistantMcp(mcpResource.id,mcpToolName,mcpArgs,project?.id);if(!isCurrentSession(token))return;
   setToolResults(current=>[...current,result]);
   if(!result.error)setMcpOpen(false);else setMcpError(result.error);
  }catch(reason){if(isCurrentSession(token))setMcpError(errorText(reason));}
  finally{if(isCurrentSession(token))setMcpBusy(false);}
 };
 const selectSkill=(resource:AssistantResource)=>{
  const next=[...new Set([...selectedSkills,resource.id])];setSelectedSkills(next);
  setInput(current=>current.replace(/(?:^|\s)\/[^\s]*$/,''));
  setResourceMenu(false);
 };
 const openLocalPicker=()=>setLocalFilesOpen(true);
 const dropFiles=(event:DragEvent)=>{event.preventDefault();for(const file of Array.from(event.dataTransfer.files))void addAttachment(file);};

 useEffect(()=>{if(scopeSeen.current!==scopeKey){scopeSeen.current=scopeKey;contextPickerGeneration.current++;setContextPicker(undefined);setContextProjectId('');setContextRuns([]);setContextRunId('');pendingRequest.current=undefined;contextCardsRef.current=[];setMessages([]);setInput('');setDraft(undefined);setReasoningEffort(undefined);setContextCards([]);setPendingAssociation(undefined);setReviewOpen(false);setAssociationRetryError('');setBusy(false);setApplying(false);setError('');setStoppedNotice('');setApplyError('');setRetryAvailable(false);setResponseModel('');setApplyNotice('');setApplied(false);setClinicalReviewed(false);setQuestionAnswers({});setRequestPhase(undefined);setStatusError('');setPollingRequestId('');setLayoutMode('suggested');setAssistantTask(undefined);setSessionArchived(false);}},[scopeKey]);

 useEffect(()=>{
  if(!open||!configs.length)return;
  setConfigId(current=>current&&configs.some(config=>config.id===current)?current:(configs.find(config=>config.isDefault===1)||configs[0]).id);
  setModel(current=>current||configs.find(config=>config.id===(configId||(configs.find(item=>item.isDefault===1)||configs[0]).id))?.model||'');
 },[open,configs,configId]);

 useEffect(()=>{setModelCatalog(configs.map(config=>({id:config.id,configName:config.configName,model:config.model})));},[configs]);

 useEffect(()=>{
  if(!open||!busy||!sessionId)return;
  const watchedSessionId=sessionId,controller=new AbortController();let current=true;
  const poll=async()=>{
   try{
    const result=await research.assistantTask(watchedSessionId,controller.signal);
   if(!current||activeSessionRef.current!==watchedSessionId)return;
    if(isTaskStartPending(watchedSessionId)&&result.task.id!==pollingRequestId){await pauseForPoll(controller.signal);if(current&&!controller.signal.aborted)void poll();return;}
    if(result.task.status==='IDLE'&&isTaskStartPending(watchedSessionId)){await pauseForPoll(controller.signal);if(current&&!controller.signal.aborted)void poll();return;}
    setRequestPhase(result.task.phase);setStatusError('');
    if(result.task.status!=='RUNNING'){
     const session=await research.assistantSession(watchedSessionId);
     if(current&&activeSessionRef.current===watchedSessionId){hydrateSession(session,sessionGeneration.current);setSessions(items=>items.map(item=>item.id===session.id?{...item,revision:session.revision,updatedAt:session.updatedAt,messageCount:session.messages.length,taskStatus:session.assistantTask?.status,taskPhase:session.assistantTask?.phase,taskError:session.assistantTask?.error}:item));}
     return;
    }
   }catch(reason){if(controller.signal.aborted||!current)return;setStatusError(`进度查询暂不可用：${errorText(reason)}`);}
   await pauseForPoll(controller.signal);
   if(current&&!controller.signal.aborted&&activeSessionRef.current===watchedSessionId)void poll();
  };
  void poll();return()=>{current=false;controller.abort();};
 },[open,busy,sessionId,pollingRequestId,hydrateSession,isTaskStartPending]);

 const clearSession=()=>{
  if(busy||isSessionTaskBusy(sessionId))return;
  sessionGeneration.current++;sessionHydratedRef.current=sessionId;clearTransientSessionUi();pendingRequest.current=undefined;
  contextCardsRef.current=[];setMessages([]);setInput('');setDraft(undefined);setReasoningEffort(undefined);setAttachments([]);setSelectedSkills([]);setToolResults([]);setContextCards([]);setBusy(false);setError('');setStoppedNotice('');setApplyError('');setRetryAvailable(false);setResponseModel('');setApplyNotice('');setApplied(false);setClinicalReviewed(false);setQuestionAnswers({});setRequestPhase(undefined);setStatusError('');setPollingRequestId('');setLayoutMode('suggested');
 };

 const addContextCard=useCallback((card:AssistantContextCard)=>{
  const current=contextCardsRef.current;
  if(current.some(item=>item.type===card.type&&item.content===card.content)){message.info('这张上下文卡片已添加');return;}
  if(current.length>=MAX_CONTEXT_CARDS){message.warning(`每轮最多附加 ${MAX_CONTEXT_CARDS} 张上下文卡片。`);return;}
  if(contextCardsCharacters([...current,card])>MAX_CONTEXT_CARD_CHARS){message.warning('所选上下文已达到本轮上限，请先移除一张卡片。');return;}
  contextCardsRef.current=[...current,card];setContextCards(contextCardsRef.current);
 },[]);
 const removeContextCard=useCallback((id:string)=>{
  contextCardsRef.current=contextCardsRef.current.filter(card=>card.id!==id);
  setContextCards(contextCardsRef.current);
 },[]);
 const openContextPicker=async(kind:'project'|'run')=>{
  const token=++contextPickerGeneration.current;setContextPicker(kind);setContextProjectId('');setContextProjects([]);setContextPickerError('');setContextPickerBusy(true);setContextRuns([]);setContextRunId('');
  try{
   const projects=await research.projects();if(token!==contextPickerGeneration.current)return;
   const available=project&&!projects.some(item=>item.id===project.id)?[project,...projects]:projects;
   setContextProjects(available);const selected=available.some(item=>item.id===project?.id)?project!.id:available[0]?.id||'';setContextProjectId(selected);
   if(kind==='run'&&selected){const items=await research.runs(selected);if(token!==contextPickerGeneration.current)return;setContextRuns(items);setContextRunId(run?.projectId===selected&&items.some(item=>item.id===run.id)?run.id:items[0]?.id||'');}
  }catch(reason){if(token===contextPickerGeneration.current)setContextPickerError(errorText(reason));}
  finally{if(token===contextPickerGeneration.current)setContextPickerBusy(false);}
 };
 const changeContextProject=async(id:string)=>{
  setContextProjectId(id);setContextRuns([]);setContextRunId('');if(contextPicker!=='run'||!id)return;
  const token=++contextPickerGeneration.current;setContextPickerBusy(true);setContextPickerError('');
  try{const items=await research.runs(id);if(token===contextPickerGeneration.current){setContextRuns(items);setContextRunId(run?.projectId===id&&items.some(item=>item.id===run.id)?run.id:items[0]?.id||'');}}
  catch(reason){if(token===contextPickerGeneration.current)setContextPickerError(errorText(reason));}
  finally{if(token===contextPickerGeneration.current)setContextPickerBusy(false);}
 };
 const addSelectedContext=async()=>{
  if(!contextPicker||!contextProjectId)return;
  const token=++contextPickerGeneration.current;setContextPickerBusy(true);setContextPickerError('');
  try{
   if(contextPicker==='project'){
    const selected=await research.project(contextProjectId);if(token!==contextPickerGeneration.current)return;
    addContextCard(createProjectContextCard(selected));
   }else{
    if(!contextRunId)throw new Error('请先选择一条运行记录。');
    const selected=await research.run(contextRunId);if(token!==contextPickerGeneration.current)return;
    if(selected.projectId!==contextProjectId)throw new Error('运行记录所属项目已变化，请重新选择。');
    addContextCard(createRunErrorContextCard(selected));
   }
   setContextPicker(undefined);
  }catch(reason){if(token===contextPickerGeneration.current)setContextPickerError(errorText(reason));}
  finally{if(token===contextPickerGeneration.current)setContextPickerBusy(false);}
 };
 const closeContextPicker=()=>{contextPickerGeneration.current++;setContextPicker(undefined);setContextProjectId('');setContextRuns([]);setContextRunId('');setContextPickerBusy(false);setContextPickerError('');};
 useEffect(()=>{
  if(!open||!sessionId||sessionHydratedRef.current!==sessionId||!initialRunContext||initialRunHandled.current===initialRunContext.key)return;
  initialRunHandled.current=initialRunContext.key;
  addContextCard(createRunErrorContextCard(initialRunContext.run,initialRunContext.nodeId));
 },[open,sessionId,initialRunContext,addContextCard]);

 const closeAssistant=()=>{setReviewOpen(false);closeContextPicker();onClose();};

 const runRequest=async(payload:PendingRequest)=>{
  if(isTaskStartPending(payload.sessionId)||activeSessionRef.current!==payload.sessionId||busy||sessionArchived)return;
  const generation=++requestGeneration.current,sessionToken=sessionGeneration.current,taskId=crypto.randomUUID();taskStartPending.current.add(payload.sessionId);stopAfterStart.current.delete(payload.sessionId);pendingRequest.current=payload;
  setBusy(true);setError('');setStoppedNotice('');setApplyError('');setPollingRequestId(taskId);setRequestPhase('PREPARING');setStatusError('');
  const isCurrent=()=>requestGeneration.current===generation&&sessionGeneration.current===sessionToken&&contextRef.current.scopeKey===payload.scopeKey&&activeSessionRef.current===payload.sessionId;
  try{
   const saveTask=sessionSaveTasks.current.get(payload.sessionId);if(saveTask?.timer){window.clearTimeout(saveTask.timer);saveTask.timer=undefined;}if(saveTask?.inFlight)await saveTask.inFlight;
   const request={configId:payload.configId,model:payload.model,...(payload.reasoningEffort?{reasoningEffort:payload.reasoningEffort}:{}),messages:payload.messages,requestId:taskId,attachments:payload.attachments,selections:payload.selections,...(payload.projectId?{projectId:payload.projectId}:{})};
   const snapshot={...payload.sessionSnapshot,revision:sessionRevisionRef.current.get(payload.sessionId)??payload.sessionSnapshot.revision};
   const result=await research.startAssistantTask(payload.sessionId,{taskId,revision:snapshot.revision,snapshot,request});
   sessionRevisionRef.current.set(payload.sessionId,result.session.revision);if(result.task.status==='RUNNING')runningTaskSessions.current.add(payload.sessionId);else runningTaskSessions.current.delete(payload.sessionId);
   setSessions(items=>items.map(item=>item.id===payload.sessionId?{...item,revision:result.session.revision,updatedAt:result.session.updatedAt,messageCount:result.session.messages.length,taskStatus:result.task.status,taskPhase:result.task.phase}:item));
   if(isCurrent()){setSessionRevision(result.session.revision);setPollingRequestId(result.task.id);setBusy(result.task.status==='RUNNING');setAssistantTask(result.task);pendingRequest.current=payload;}
   if(stopAfterStart.current.delete(payload.sessionId)){void research.cancelAssistantTask(payload.sessionId).then(canceled=>{if(canceled.task.status!=='RUNNING')runningTaskSessions.current.delete(payload.sessionId);setSessions(items=>items.map(item=>item.id===payload.sessionId?{...item,revision:canceled.session.revision,updatedAt:canceled.session.updatedAt,messageCount:canceled.session.messages.length,taskStatus:canceled.task.status,taskPhase:canceled.task.phase,taskError:canceled.task.error}:item));if(activeSessionRef.current===payload.sessionId){hydrateSession(canceled.session,sessionGeneration.current);setStoppedNotice(canceled.task.status==='CANCELED'?'本次回复已中断。你可以重试上一条、修改问题或更换模型后重新发送。':'本轮回复已完成。');}}).catch(reason=>{if(activeSessionRef.current===payload.sessionId)setStatusError(`中断请求失败：${errorText(reason)}`);});}
  }catch(reason){
   let recovered:AssistantSession|undefined;
   try{
    recovered=await research.assistantSession(payload.sessionId);
    if(recovered.assistantTask?.id===taskId){if(recovered.assistantTask.status==='RUNNING')runningTaskSessions.current.add(payload.sessionId);else runningTaskSessions.current.delete(payload.sessionId);setSessions(items=>items.map(item=>item.id===payload.sessionId?{...item,revision:recovered!.revision,updatedAt:recovered!.updatedAt,messageCount:recovered!.messages.length,taskStatus:recovered!.assistantTask?.status,taskPhase:recovered!.assistantTask?.phase,taskError:recovered!.assistantTask?.error}:item));if(isCurrent())hydrateSession(recovered,sessionGeneration.current);return;}
   }catch{/* Keep the original start error visible; the user can retry when the server is reachable. */}
   runningTaskSessions.current.delete(payload.sessionId);
   if(!isCurrent())return;
   setBusy(false);setError(assistantError(reason));setRetryAvailable(true);
  }
  finally{taskStartPending.current.delete(payload.sessionId);}
 };

 const stopRequest=()=>{
  if(!sessionId)return;
  if(isTaskStartPending(sessionId)){stopAfterStart.current.add(sessionId);setStoppedNotice('正在中断本次回复…');return;}
  const canceledSessionId=sessionId;setError('');setStoppedNotice('正在中断本次回复…');
  void research.cancelAssistantTask(canceledSessionId).then(result=>{
   const session=result.session;sessionRevisionRef.current.set(session.id,session.revision);if(result.task.status==='RUNNING')runningTaskSessions.current.add(canceledSessionId);else runningTaskSessions.current.delete(canceledSessionId);
   setSessions(items=>items.map(item=>item.id===canceledSessionId?{...item,revision:session.revision,updatedAt:session.updatedAt,messageCount:session.messages.length,taskStatus:result.task.status,taskPhase:result.task.phase,taskError:result.task.error}:item));
   if(activeSessionRef.current!==canceledSessionId)return;
   setSessionRevision(session.revision);
   if(result.task.status==='CANCELED'){setBusy(false);setRetryAvailable(true);setStoppedNotice('本次回复已中断。你可以重试上一条、修改问题或更换模型后重新发送。');}
   else if(result.task.status==='COMPLETED'){setStoppedNotice('本轮回复已完成。');}
   hydrateSession(session,sessionGeneration.current);
  }).catch(reason=>setStatusError(`中断请求失败：${errorText(reason)}`));
 };

 const sendText=async(rawText:string)=>{
  const hasSelectedMaterial=!!(attachments.length||contextCards.length||toolResults.some(result=>!result.error));
  const userText=materialOnlyPrompt(rawText,hasSelectedMaterial);if((!userText.trim()&&!hasSelectedMaterial)||!configId||busy||isTaskStartPending(sessionId)||sessionArchived)return;
  const priorMessages=[...messages];if(pendingRequest.current&&priorMessages[priorMessages.length-1]?.role==='user')priorMessages.pop();
  const pendingAttachments=[...attachments],selection:AssistantSelection={skills:[...selectedSkills],mcpResultIds:toolResults.filter(result=>!result.error).map(result=>result.id)};
  const pendingCards=[...contextCards];
  const nextMessages:AssistantChatMessage[]=[...priorMessages,{role:'user',content:userText,...(pendingCards.length?{contextCards:pendingCards}:{}),...(pendingAttachments.length?{attachments:pendingAttachments}:{}),...(selection.skills.length||selection.mcpResultIds.length?{selections:selection}:{}),...(toolResults.length?{toolResults:[...toolResults]}:{})}];
  const recent=assistantRequestMessages(nextMessages,draft,MAX_MESSAGES);
  const oversized=recent.find(item=>item.content.length+contextCardsCharacters(item.contextCards||[])>MAX_MESSAGE_CHARS);
  if(oversized){const size=oversized.content.length+contextCardsCharacters(oversized.contextCards||[]);setError(oversized.role==='assistant'?`助手上下文（含完整草案与公开摘要）有 ${size} 个字符，单条上限为 ${MAX_MESSAGE_CHARS}。请缩短节点提示词或脚本后重试；你也可以清空会话。`:`用户消息与所选上下文卡片共 ${size} 个字符，单条上限为 ${MAX_MESSAGE_CHARS}。请移除部分卡片或缩短本条内容后重试。`);return;}
  const total=recent.reduce((sum,item)=>sum+item.content.length+contextCardsCharacters(item.contextCards||[]),0);
  if(total>MAX_TOTAL_MESSAGE_CHARS){setError(`最近 ${recent.length} 条对话共 ${total} 个字符，本轮上限为 ${MAX_TOTAL_MESSAGE_CHARS}。请清空会话后继续。`);return;}
  const outbound=recent;
  const allAttachmentIds=[...new Set(pendingAttachments.map(file=>file.id))];
  const nextTitle=sessionTitle==='新对话'&&userText.length?userText.slice(0,60):sessionTitle;
  const base=sessionSnapshotRef.current;if(!base)return;
  const snapshot:AssistantSession={...base,title:nextTitle,messages:nextMessages,messageCount:nextMessages.length,input:userText,configId,model,reasoningEffort:reasoningEffort??null,draft,questionAnswers,layoutMode,attachments:pendingAttachments,selections:selection,toolResults,contextCards:[]};
  const payload:PendingRequest={configId,model,reasoningEffort,messages:outbound,projectId:project?.id,scopeKey,sessionId,userText,attachments:allAttachmentIds,selections:selection,sessionSnapshot:snapshot};
  contextCardsRef.current=[];setMessages(nextMessages);setSelectedSkills([]);setToolResults([]);setContextCards([]);if(nextTitle!==sessionTitle)setSessionTitle(nextTitle);pendingRequest.current=payload;setStoppedNotice('');setError('');await runRequest(payload);
 };

 const send=()=>{
  if(!canSend)return;
  if(attachments.length||contextCards.length){const consent=[attachments.length?`所选 ${attachments.length} 个附件的解析正文：${attachments.map(file=>file.name).join('、')}`:'',contextCards.length?`所选上下文：${contextCards.map(card=>card.title).join('、')}`:''].filter(Boolean).join('\n');Modal.confirm({title:'确认发送所选材料？',content:consent,okText:'确认发送',cancelText:'返回检查',onOk:()=>sendText(input)});return;}
  void sendText(input);
 };
 const retry=async()=>{
  if(!sessionId||busy||isTaskStartPending(sessionId))return;
  const pending=pendingRequest.current;if(!pending)return;
  if(assistantTask&&['FAILED','CANCELED','INTERRUPTED'].includes(assistantTask.status)){
   const retriedSessionId=sessionId,sessionToken=sessionGeneration.current,requestId=crypto.randomUUID();taskStartPending.current.add(retriedSessionId);runningTaskSessions.current.add(retriedSessionId);
   try{setBusy(true);setError('');setStoppedNotice('');setRequestPhase('PREPARING');const result=await research.retryAssistantTask(retriedSessionId,requestId);sessionRevisionRef.current.set(retriedSessionId,result.session.revision);if(result.task.status==='RUNNING')runningTaskSessions.current.add(retriedSessionId);else runningTaskSessions.current.delete(retriedSessionId);setSessions(items=>items.map(item=>item.id===retriedSessionId?{...item,revision:result.session.revision,updatedAt:result.session.updatedAt,messageCount:result.session.messages.length,taskStatus:result.task.status,taskPhase:result.task.phase,taskError:result.task.error}:item));if(activeSessionRef.current===retriedSessionId&&sessionGeneration.current===sessionToken){setSessionRevision(result.session.revision);setPollingRequestId(result.task.id);setBusy(result.task.status==='RUNNING');setAssistantTask(result.task);}}
   catch(reason){runningTaskSessions.current.delete(retriedSessionId);if(activeSessionRef.current===retriedSessionId&&sessionGeneration.current===sessionToken){setBusy(false);setError(assistantError(reason));}}
   finally{taskStartPending.current.delete(retriedSessionId);}
   return;
  }
  await runRequest(pending);
 };

 const applyDraft=async()=>{
  if(!draft||!draft.name.trim()||applying||busy||sessionArchived||unresolvedQuestions.length||draft.clinicalData&&!clinicalReviewed)return;
  const applyingScope=scopeKey;setApplying(true);setApplyError('');
  try{
   await flushSession();
   const active=sessionSnapshotRef.current;if(!active||active.id!==sessionId)throw new Error('当前对话尚未载入完成，请稍后重试。');
   const result=await onApply({...draft,nodes:draft.nodes.map(node=>({...node,data:{...node.data}})),edges:draft.edges.map(edge=>({...edge}))},{id:active.id,revision:sessionRevisionRef.current.get(active.id)??sessionRevision});
   if(contextRef.current.open&&contextRef.current.scopeKey===applyingScope){
    setReviewOpen(false);
    if(result?.status==='association_pending'&&result.projectId){setPendingAssociation({sessionId:active.id,projectId:result.projectId,projectName:result.projectName||draft.name,error:result.error});setAssociationRetryError('');setApplyNotice('');setApplyError('项目已创建，对话关联待重试');setApplied(false);}
    else{setPendingAssociation(undefined);setAssociationRetryError('');setApplyNotice(project?'草案已载入当前项目的待保存工作区。':'项目草案已创建。');setApplied(true);}
   }
  }
  catch(reason){if(contextRef.current.open&&contextRef.current.scopeKey===applyingScope)setApplyError(errorText(reason));}
  finally{if(contextRef.current.open&&contextRef.current.scopeKey===applyingScope)setApplying(false);}
 };

 const retryAssociation=async()=>{
  if(!pendingAssociation||!onRetryAssociate||associationRetryBusy)return;
  setAssociationRetryBusy(true);setAssociationRetryError('');
  try{await onRetryAssociate(pendingAssociation.sessionId,pendingAssociation.projectId);setPendingAssociation(undefined);setApplyError('');setApplyNotice('对话已关联，正在返回项目。');setApplied(true);}
  catch(reason){setAssociationRetryError(errorText(reason));}
  finally{setAssociationRetryBusy(false);}
 };

 const updateDraft=<K extends keyof AssistantDraft,>(key:K,value:AssistantDraft[K])=>{setApplied(false);setApplyNotice('');setDraft(current=>current?{...current,[key]:value}:current);};
 const updateAnswer=(questionId:string,update:Partial<QuestionAnswer>)=>setQuestionAnswers(current=>({...current,[questionId]:{...current[questionId],...update}}));
 const currentConfig=configs.find(config=>config.id===configId);
 const nodeModels=modelCatalog.length?modelCatalog:configs.map(config=>({id:config.id,configName:config.configName,model:config.model}));
 const latestAssistantIndex=messages.reduce((latest,item,index)=>item.role==='assistant'?index:latest,-1);
 const lastAssistant=latestAssistantIndex>=0?messages[latestAssistantIndex]:undefined;
 const unresolvedQuestions=latestAssistantIndex===messages.length-1?lastAssistant?.questions||[]:[];
 const allQuestionsAnswered=unresolvedQuestions.length>0&&unresolvedQuestions.every(question=>{
  const answer=questionAnswers[question.id]||{};
  return !!answer.freeText?.trim()||!!answer.choice||(question.topic==='models'&&(!!answer.uniformCurrent||(answer.modelIds||[]).length>0));
 });
 const retainedDraft=unresolvedQuestions.length>0&&!lastAssistant?.draft;
 const answerLabel=(id?:number,modelName?:string)=>{const config=nodeModels.find(item=>item.id===id);return config?`${config.configName}.${modelName||config.model}`:id?`配置 ID ${id}`:'使用项目默认模型'};
 const restoreMessageDraft=(saved:AssistantDraft)=>{
  const restore=()=>{setDraft(structuredClone(saved));setApplied(false);setApplyNotice('');setApplyError('');setClinicalReviewed(false);setDraftVisible(true);message.success('已恢复这轮草案，原对话和后续回复保留');};
  if(draft&&!sameWorkflowValue(draft,saved))Modal.confirm({title:'恢复这轮草案？',content:'右侧当前草案将替换为此轮回复中的版本。对话记录保留，可随时再次恢复其他轮次。',okText:'恢复草案',cancelText:'取消',onOk:restore});else restore();
 };
 const canSend=!!sessionId&&!sessionArchived&&(!!(input.trim()||attachments.length||contextCards.length||toolResults.some(result=>!result.error)))&&configs.some(config=>config.id===configId)&&!busy&&!isTaskStartPending(sessionId)&&!resourceMenu&&!uploadsBusy;
 const menuItems=[...filteredSkills.map(resource=>({kind:'skill' as const,resource})),...filteredMcp.map(resource=>({kind:'mcp' as const,resource}))];
 const handleComposerKeyDown=(event:KeyboardEvent<HTMLTextAreaElement>)=>{
  if(resourceMenu&&menuItems.length){
   if(event.key==='ArrowDown'){event.preventDefault();setResourceCursor(current=>(current+1)%menuItems.length);}
   else if(event.key==='ArrowUp'){event.preventDefault();setResourceCursor(current=>(current-1+menuItems.length)%menuItems.length);}
   else if(event.key==='Escape'){setResourceMenu(false);}
   else if(event.key==='Enter'&&!event.ctrlKey&&!event.metaKey){event.preventDefault();const item=menuItems[resourceCursor];if(item){if(item.kind==='skill')selectSkill(item.resource);else{setResourceMenu(false);setInput(current=>current.replace(/(?:^|\s)\/[^\s]*$/,''));void loadMcpTools(item.resource);}}}
   return;
  }
 };
 const orderedNodes=draft?(topologicalOrder(draft.nodes,draft.edges)||draft.nodes):[];
 useEffect(()=>{
  const transcript=scrollRef.current;if(!transcript)return;
  if(busy||latestAssistantIndex!==messages.length-1||!lastAssistant?.planning&&!lastAssistant?.questions?.length){transcript.scrollTop=transcript.scrollHeight;return;}
  const target=latestAssistantRef.current;if(target){const top=target.getBoundingClientRect().top-transcript.getBoundingClientRect().top+transcript.scrollTop-8;transcript.scrollTop=Math.max(0,top);}
 },[messages,busy,latestAssistantIndex,lastAssistant]);
 const answerQuestions=()=>{
  if(!unresolvedQuestions.length||busy)return;
  const answers:string[]=[];
  for(const question of unresolvedQuestions){
   const answer=questionAnswers[question.id]||{};
   const selected=question.topic==='models'?(answer.uniformCurrent?`各 LLM 节点统一使用当前对话模型 ${currentConfig?`${currentConfig.configName}.${model||currentConfig.model}（配置 ID ${currentConfig.id}）`:'（当前模型未选择）'}`:(answer.modelIds||[]).length?`LLM 节点模型配置：${(answer.modelIds||[]).map(id=>`${nodeModels.find(config=>config.id===id)?.configName||'未知配置'}.${nodeModels.find(config=>config.id===id)?.model||`ID ${id}`}（配置 ID ${id}）`).join('、')}`:answer.choice||''):answer.choice||'';
   const freeText=answer.freeText?.trim()||'';
   if(!selected&&!freeText){message.warning(`请先回答：${question.title}`);return;}
   answers.push(`[${question.id}] ${question.title}：${[selected,freeText&&`补充说明：${freeText}`].filter(Boolean).join('；')}`);
  }
  void sendText(`根据以下确认继续完善研究方案，并生成或更新配置草案：\n${answers.map((answer,index)=>`${index+1}. ${answer}`).join('\n')}`);
 };

 return <><Modal className="project-assistant-modal" open={open} width="min(1540px, 98vw)" footer={null} onCancel={closeAssistant} destroyOnHidden={false} title={null}>
  <div className="pa-frame">
   <header className="pa-header">
    <div className="pa-heading-icon"><RobotOutlined/></div>
    <div className="pa-heading-copy"><div className="pa-kicker">SCINODE RESEARCH ASSISTANT</div><h2>科研助手 <Tag color={project?'purple':'blue'}>{project?`项目 · ${project.name}`:'首页 · 新建草案'}</Tag></h2><p>围绕研究问题组织工作流，生成可检查、可编辑的项目草案。</p></div>
    <div className="pa-header-actions"><Button icon={<MenuFoldOutlined/>} aria-label={historyVisible?'收起历史对话':'展开历史对话'} aria-pressed={historyVisible} onClick={()=>setHistoryVisible(value=>!value)}>历史</Button><Button icon={<UnorderedListOutlined/>} aria-label={draftVisible?'收起配置草案':'展开配置草案'} aria-pressed={draftVisible} onClick={()=>setDraftVisible(value=>!value)}>草案{draft?` · ${draft.nodes.length}`:''}</Button><Tooltip title="清空本次对话、回复与草案"><Button aria-label="清空助手会话" icon={<DeleteOutlined/>} disabled={busy||isSessionTaskBusy(sessionId)||sessionArchived} onClick={clearSession}>清空会话</Button></Tooltip></div>
   </header>
   <div className="pa-scope-note"><span className="pa-scope-dot"/><span>离开对话后任务继续，回来可查看结果。</span><Tooltip title="请求包含项目元信息与节点配置、最近最多20条对话，以及你所选的附件正文、Skill 和 MCP 结果。原始文件留在本机。草案由你复核后载入，再手动启动。"><Button size="small" type="text">发送范围</Button></Tooltip><span className="pa-context-version">{project?`上下文：已保存 v${project.revision}`:'上下文：当前对话与所选材料'}</span></div>
   {hasUnsavedChanges&&<Alert className="pa-unsaved-context" type="warning" showIcon message={`当前工作区有未保存调整；模型读取已保存 v${project?.revision}，载入草案前会显示与工作区的差异。`}/>}
   <main className={`pa-content ${historyVisible?"":"pa-history-hidden"} ${draftVisible?"":"pa-draft-hidden"}`}>
    <aside className="pa-history-panel" hidden={!historyVisible} aria-label="助手历史对话">
     <div className="pa-history-heading"><div><HistoryOutlined/><strong>历史对话</strong></div><Button size="small" type="primary" icon={<PlusOutlined/>} disabled={sessionView==='archived'} onClick={()=>void createSession()}>新对话</Button></div>
     <div className="pa-session-tabs" role="tablist" aria-label="对话分类"><Button size="small" type={sessionView==='active'?'primary':'default'} onClick={()=>void loadSessionView('active')}>全部对话</Button><Button size="small" type={sessionView==='archived'?'primary':'default'} icon={<FolderOutlined/>} onClick={()=>void loadSessionView('archived')}>已归档</Button></div>
     {sessionView==='archived'&&<Alert className="pa-archive-note" type="info" showIcon message="旧回收站对话已保留在归档中，可取消归档后继续查看。"/>}
     <Input.Search aria-label="搜索对话标题" placeholder="搜索标题" value={sessionSearch} onChange={event=>setSessionSearch(event.target.value)} allowClear/>
     {sessionError&&<Alert className="pa-session-error" type="error" showIcon message={sessionError} action={<Button size="small" onClick={()=>void retryWorkspaceLoad()}>{initialSessionId?'重试加载原对话':'重试加载会话'}</Button>}/>}
     {sessionStateError&&<Alert className="pa-session-error" type="error" showIcon message="自动保存失败" description={sessionStateError} action={<Button size="small" onClick={()=>void flushSession().catch(()=>undefined)}>重试保存</Button>}/>}
     <div className="pa-session-state">{sessionSaving?<><Spin size="small"/> 正在保存</>:sessionId?'已自动保存':initialSessionId&&!project?.id?'正在载入关联项目':'正在载入会话'}</div>
     <div className="pa-session-list">{filteredSessions.map(item=><div key={item.id} className={item.id===sessionId?'pa-session-item active':'pa-session-item'}><button type="button" onClick={()=>void openSession(item.id)}><strong><span className="pa-session-item-title">{item.title||'新对话'}</span>{item.taskStatus==='RUNNING'&&<Tag color="processing">处理中</Tag>}{['FAILED','INTERRUPTED'].includes(item.taskStatus||'')&&<Tag color="error">可重试</Tag>}{item.taskStatus==='COMPLETED'&&<Tag color="success">已完成</Tag>}</strong><small>{item.messageCount??0} 条消息 · {new Date(item.updatedAt).toLocaleString()}</small>{item.taskError&&<small className="pa-session-error-text">{item.taskError}</small>}</button><div className="pa-session-actions"><Button aria-label={sessionView==='archived'?`取消归档 ${item.title}`:`归档 ${item.title}`} title={sessionView==='archived'?'取消归档':'归档'} size="small" type="text" icon={sessionView==='archived'?<RollbackOutlined/>:<FolderOutlined/>} onClick={()=>void changeArchive(item.id,sessionView!=='archived')}>{sessionView==='archived'?'恢复':'归档'}</Button><Popconfirm title="永久删除对话？" description="如本轮仍在运行，删除会同时中断任务。此操作不可恢复；仅删除这段对话记录，不会删除共享附件或项目。" okText="永久删除" cancelText="取消" okButtonProps={{danger:true}} onConfirm={()=>void deleteSession(item.id)}><Button aria-label={`永久删除对话 ${item.title}`} size="small" type="text" danger icon={<DeleteOutlined/>}>删除</Button></Popconfirm></div></div>)}</div>
    </aside>
    <section className="pa-chat-panel" aria-label="助手对话" onDragOver={event=>event.preventDefault()} onDrop={dropFiles}>
     <div className="pa-chat-toolbar"><span className="pa-chat-title">研究对话 {sessionArchived&&<Tag color="default">已归档 · 只读</Tag>}</span><div className="pa-chat-controls"><ModelSelection configs={configs} value={{configId,model}} onChange={choice=>{setConfigId(choice.configId);setModel(choice.model||'');}} disabled={busy||sessionArchived} ariaLabel="对话模型"/><label className="pa-effort-control"><span>思考等级</span><Tooltip title="默认采用模型自己的设置；选择低、中或高会把对应思考等级发送给模型服务。若服务不支持，会显示错误和切换建议。"><Select aria-label="对话思考等级" value={reasoningEffort||'default'} disabled={busy||sessionArchived} options={[{value:'default',label:'默认'},{value:'low',label:'低'},{value:'medium',label:'中'},{value:'high',label:'高'}]} onChange={value=>setReasoningEffort(value==='default'?undefined:value as AssistantReasoningEffort)}/></Tooltip></label></div></div>
     {sessionArchived&&<Alert className="pa-config-alert" type="info" showIcon message="这段对话已归档" description="取消归档后即可继续发送新消息。当前后台任务仍会继续写回结果。"/>}
     {!configs.length&&<Alert className="pa-config-alert" type="warning" showIcon message="尚未配置可用模型" description="请先添加模型配置，再开始助手对话。"/>}
     <div className="pa-transcript" ref={scrollRef}>
      {!messages.length&&!busy&&configs.length>0?<div className="pa-welcome"><div className="pa-welcome-mark"><BulbOutlined/></div><h3>{project?`继续完善「${project.name}」`: '从研究问题开始'}</h3><p>描述研究目标、当前资料和期望成果。助手会提出结构化方案，并标出需要你复核的内容。</p><div className="pa-suggestions">{suggestions.map(item=><button key={item.label} type="button" onClick={()=>setInput(item.text)}><span>开始</span>{item.label}</button>)}</div></div>:null}
      {messages.map((item,index)=>{
       const latestAssistantMessageIndex=latestAssistantIndex;
       const showQuestions=item.role==='assistant'&&index===latestAssistantMessageIndex&&unresolvedQuestions.length>0;
       return <article ref={item.role==='assistant'&&index===latestAssistantMessageIndex?latestAssistantRef:undefined} key={`${index}-${item.role}`} className={`pa-message pa-message-${item.role}`}><div className="pa-message-avatar">{item.role==='assistant'?<RobotOutlined/>:'你'}</div><div className="pa-message-body"><div className="pa-message-label">{item.role==='assistant'?'科研助手':'你'}{item.repaired&&<Tag className="pa-repaired-tag" color="success">草案格式已修正并通过校验</Tag>}</div><div className="pa-message-text">{item.role==='assistant'?<ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown>:item.content}</div>{item.role==='user'&&!!item.contextCards?.length&&<details className="pa-history-context-card"><summary>已发送给模型的脱敏上下文 · {item.contextCards.length} 张</summary><pre>{formatContextCardsForModel(item.contextCards)}</pre></details>}{item.role==='user'&&!!item.attachments?.length&&<div className="pa-message-metadata">{item.attachments.map(file=><Button key={file.id} size="small" icon={<PaperClipOutlined/>} onClick={()=>void previewAttachment(file)}>{file.name}</Button>)}</div>}{item.role==='user'&&item.selections?.skills.map(id=><Tag key={id} className="pa-message-resource-tag" color="blue">Skill · {resources.skills.find(resource=>resource.id===id)?.name||id}</Tag>)}{item.role==='user'&&item.toolResults?.map(result=><details key={result.id} className="pa-history-tool-result"><summary>MCP · {result.toolName}{result.error?' · 调用失败':''}</summary><pre>{result.error||result.text||JSON.stringify(result.result,null,2)}</pre></details>)}
        {item.role==='assistant'&&item.draft&&<Button className="pa-restore-draft" size="small" icon={<HistoryOutlined/>} disabled={busy||sessionArchived||!!pendingAssociation} onClick={()=>restoreMessageDraft(item.draft!)}>恢复这轮草案 · {item.draft.nodes.length} 个节点</Button>}
        {item.role==='assistant'&&item.planning&&<details className="pa-planning-details" open={index===latestAssistantMessageIndex}><summary>思路摘要</summary><p>{item.planning.summary}</p>{!!item.planning.steps.length&&<div><strong>处理步骤</strong><ul>{item.planning.steps.map((step,stepIndex)=><li key={`${stepIndex}-${step}`}>{step}</li>)}</ul></div>}{!!item.planning.assumptions.length&&<div><strong>待核实假设</strong><ul>{item.planning.assumptions.map((assumption,assumptionIndex)=><li key={`${assumptionIndex}-${assumption}`}>{assumption}</li>)}</ul></div>}{!!item.planning.decisions.length&&<div><strong>当前决策</strong><ul>{item.planning.decisions.map((decision,decisionIndex)=><li key={`${decisionIndex}-${decision}`}>{decision}</li>)}</ul></div>}</details>}
        {showQuestions&&<section className="pa-question-card" aria-label="待确认问题"><div className="pa-question-heading"><strong>补充信息</strong><span>回答后继续生成方案</span></div>
         {unresolvedQuestions.map((question,questionIndex)=>{const answer=questionAnswers[question.id]||{},isModels=question.topic==='models';return <div className="pa-question" key={question.id}><div className="pa-question-title"><b>{questionIndex+1}. {question.title}</b>{question.recommended&&<Button size="small" type="link" disabled={busy} onClick={()=>{const recommendation=question.recommended||'';if(isModels){if(/统一|当前.*模型/.test(recommendation))updateAnswer(question.id,{choice:recommendation,uniformCurrent:true,modelIds:[]});else{const match=nodeModels.find(config=>String(config.id)===recommendation||`${config.configName}.${config.model}`===recommendation);if(match)updateAnswer(question.id,{modelIds:[match.id],uniformCurrent:false,choice:undefined});else if(question.options.includes(recommendation))updateAnswer(question.id,{choice:recommendation,uniformCurrent:false});else updateAnswer(question.id,{freeText:recommendation,uniformCurrent:false,choice:undefined});}}else if(question.options.includes(recommendation))updateAnswer(question.id,{choice:recommendation});else updateAnswer(question.id,{freeText:recommendation});}}>填入推荐</Button>}</div>
          {question.options.length>0&&<Radio.Group className="pa-question-options" disabled={busy} value={answer.choice} onChange={event=>{const choice=event.target.value;const uniform=isModels&&/统一|当前对话模型/.test(choice);updateAnswer(question.id,{choice,uniformCurrent:uniform,modelIds:uniform?[]:answer.modelIds});}}><div>{question.options.map(option=><Radio key={option} value={option}>{option}{option===question.recommended&&<Tag color="blue">推荐</Tag>}</Radio>)}</div></Radio.Group>}
          {isModels&&<div className="pa-model-question-options"><Checkbox checked={!!answer.uniformCurrent} disabled={busy||!currentConfig} onChange={event=>updateAnswer(question.id,{uniformCurrent:event.target.checked,choice:undefined,modelIds:event.target.checked?[]:answer.modelIds})}>各节点统一使用当前模型{currentConfig?`：${currentConfig.configName}.${model||currentConfig.model}`:'（请先选择对话模型）'}</Checkbox><Select className="pa-model-multi-select" mode="multiple" aria-label="选择节点模型配置" value={answer.modelIds||[]} disabled={busy||!!answer.uniformCurrent} options={nodeModels.map(config=>({value:config.id,label:`${config.configName}.${config.model}（配置 ID ${config.id}）`}))} onChange={ids=>updateAnswer(question.id,{modelIds:ids,uniformCurrent:false,choice:undefined})} placeholder="选择可分配给 LLM 节点的模型"/></div>}
          <Input.TextArea className="pa-question-free-text" aria-label={`补充说明：${question.title}`} value={answer.freeText||''} onChange={event=>updateAnswer(question.id,{freeText:event.target.value})} autoSize={{minRows:1,maxRows:3}} placeholder={isModels?'补充模型选择要求（可选）':'补充说明（如有）'} maxLength={1000} disabled={busy}/>
         </div>;})}
         <Button className="pa-question-submit" type="primary" onClick={answerQuestions} disabled={busy||!allQuestionsAnswered}>发送确认并生成方案</Button>
        </section>}
       </div></article>;
      })}
      {busy&&<div className="pa-processing" aria-live="polite"><span className="pa-thinking-pulse"/><span>处理进度：{phaseLabels[requestPhase||'NOT_FOUND']}</span></div>}
      {!messages.length&&!configs.length&&<Empty className="pa-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description="配置模型后开始对话"/>}
     </div>
     {statusError&&<Alert className="pa-status-error" type="warning" showIcon message={statusError}/>}
     {error&&<Alert className="pa-error" type="error" showIcon message="助手回复失败" description={error} action={retryAvailable&&pendingRequest.current?<Button size="small" icon={<ReloadOutlined/>} onClick={()=>void retry()} disabled={busy}>重试上一条</Button>:undefined}/>} 
     {stoppedNotice&&<Alert className="pa-stopped-notice" type="info" showIcon message={stoppedNotice} action={assistantTask?.status==='CANCELED'&&retryAvailable&&pendingRequest.current?<Button size="small" icon={<ReloadOutlined/>} onClick={()=>void retry()} disabled={busy}>重试上一条</Button>:undefined}/>} 
     {resourceMenu&&<div className="pa-resource-menu" role="listbox" aria-label="Skills 与 MCP 资源"><div className="pa-menu-caption">选择指南或 MCP 工具；Skill 随本轮请求载入，MCP 需检查参数并确认调用。</div>{menuItems.map((item,index)=><button key={item.kind+item.resource.id} type="button" role="option" aria-selected={resourceCursor===index} className={resourceCursor===index?'selected':''} disabled={item.kind==='mcp'&&!mcpAvailable(item.resource)} onMouseEnter={()=>setResourceCursor(index)} onClick={()=>item.kind==='skill'?selectSkill(item.resource):mcpAvailable(item.resource)&& (setResourceMenu(false),setInput(value=>value.replace(/(?:^|\s)\/[^\s]*$/,'')),void loadMcpTools(item.resource))}><strong>{item.kind==='skill'?'Skill':'MCP'} · {item.resource.name}</strong><small>{item.resource.description||item.resource.source||item.resource.status||'Codex 来源'}</small></button>)}{!menuItems.length&&<span className="pa-menu-empty">没有匹配资源</span>}</div>}
     {!!contextCards.length&&<div className="pa-context-card-preview" aria-label="已选择的上下文卡片"><div className="pa-context-card-heading"><strong>本轮将附加的上下文</strong><span>{contextCards.length}/{MAX_CONTEXT_CARDS} 张 · {contextCardsCharacters(contextCards)} 字符</span></div>{contextCards.map(card=><article key={card.id}><div><Tag color={card.type==='project_summary'?'purple':'red'}>{card.type==='project_summary'?'项目概况':'运行排查'}</Tag><strong>{card.title}</strong><Button type="text" size="small" danger icon={<DeleteOutlined/>} aria-label={`移除 ${card.title}`} onClick={()=>removeContextCard(card.id)}/></div></article>)}<details className="pa-context-card-payload"><summary>预览实际发送的脱敏文本</summary><pre>{formatContextCardsForModel(contextCards)}</pre></details></div>}
     {attachments.length>0&&<Alert className="pa-attachment-consent" type="warning" showIcon message="发送此消息时，附件解析正文将随请求发送给所选模型服务。" description="本地文件仅按你的选择或拖入操作暂存；历史记录使用已保存的附件元信息。"/>}
     {!!attachmentErrors.length&&<div className="pa-attachment-errors">{attachmentErrors.map((item,index)=><Alert key={index} type="error" showIcon message={item} closable onClose={()=>setAttachmentErrors(current=>current.filter((_,i)=>i!==index))}/>)}</div>}
     {uploadError&&<Alert className="pa-attachment-errors" type="error" showIcon message={uploadError} closable onClose={()=>setUploadError('')}/>}
     {!!toolResults.length&&<div className="pa-pending-tool-results">{toolResults.map(result=><details key={result.id} open><summary>{result.error?'MCP 调用失败':'MCP 实际输出'} · {result.toolName} · {mcpResource?.source||resources.mcp.find(resource=>resource.id===result.resourceId)?.source||result.resourceId}</summary><pre>{result.error||result.text||JSON.stringify(result.result,null,2)}</pre></details>)}</div>}
     {!!(selectedSkills.length||toolResults.length||attachments.length)&&<div className="pa-composer-chips">{selectedSkills.map(id=><Tag key={id} closable onClose={()=>setSelectedSkills(current=>current.filter(item=>item!==id))} color="blue">Skill · {resources.skills.find(resource=>resource.id===id)?.name||id}</Tag>)}{toolResults.map(result=><Tag key={result.id} closable onClose={()=>setToolResults(current=>current.filter(item=>item.id!==result.id))} color={result.error?'error':'purple'}>MCP · {result.toolName}{result.error?' · error':''}</Tag>)}{attachments.map(file=><Tag key={file.id} closable onClose={()=>setAttachments(current=>current.filter(item=>item.id!==file.id))} icon={<PaperClipOutlined/>}><button type="button" onClick={()=>void previewAttachment(file)}>{file.name}</button></Tag>)}{uploadsBusy>0&&<Tag icon={<Spin size="small"/>}>正在解析 {uploadsBusy} 个文件</Tag>}</div>}
     <div className="pa-composer-tools"><Select<number> aria-label="科研提问模板" value={null} placeholder="快捷提问" options={suggestions.map((item,index)=>({value:index,label:item.label}))} onChange={index=>setInput(current=>[current.trim(),suggestions[index].text].filter(Boolean).join('\n\n'))} disabled={busy||sessionArchived}/><Button size="small" disabled={sessionArchived||busy} icon={<FolderOutlined/>} onClick={()=>void openContextPicker('project')}>项目资料</Button><Button size="small" disabled={sessionArchived||busy} icon={<FileSearchOutlined/>} onClick={()=>void openContextPicker('run')}>运行报错</Button><Button size="small" disabled={sessionArchived} icon={<ToolOutlined/>} onClick={()=>{setResourceQuery('');setResourceMenu(current=>!current);}}>Skill / MCP</Button><Button size="small" disabled={sessionArchived} icon={<FileSearchOutlined/>} onClick={openLocalPicker}>本机文件</Button><Button size="small" disabled={sessionArchived} icon={<PaperClipOutlined/>} onClick={()=>nativeFileRef.current?.click()}>附件</Button><input ref={nativeFileRef} className="pa-native-file-input" type="file" multiple accept=".docx,.pdf,.txt,.md,.csv,.json" onChange={event=>{for(const file of Array.from(event.target.files||[]))void addAttachment(file);event.target.value='';}}/></div>
     <div className="pa-composer"><Input.TextArea aria-label="输入研究问题" value={input} onChange={event=>updateComposer(event.target.value)} onKeyDown={handleComposerKeyDown} onPressEnter={event=>{if(event.ctrlKey||event.metaKey){event.preventDefault();if(!busy)send();}}} placeholder="输入 / 选择 Skill 或 MCP；输入 @ 选择本机文件。描述你的研究问题…" autoSize={{minRows:2,maxRows:5}} disabled={!configs.length||busy||sessionArchived} maxLength={12000}/><div className="pa-composer-footer"><span>Enter 换行 · Ctrl/⌘ + Enter 发送{retryAvailable?' · 上一条未完成，可重试或编辑后发送':''}</span><Button type="primary" aria-label={busy?'中断助手回复':'发送消息'} icon={busy?<LoadingOutlined spin/>:<SendOutlined/>} onClick={()=>{if(busy)stopRequest();else send();}} disabled={!busy&&!canSend} className={busy?'pa-interrupt-button':''}>{busy?'中断':'发送'}</Button></div></div>
    </section>
    <aside className="pa-draft-panel" hidden={!draftVisible} aria-label="配置草案预览">
     <div className="pa-draft-heading"><div><span className="pa-kicker">PROJECT DRAFT</span><h3>配置草案</h3></div>{draft&&<Tag color="geekblue">{retainedDraft?'上一版草案 · 当前需求待补充':'待复核'}</Tag>}</div>
     {!draft&&unresolvedQuestions.length>0?<div className="pa-draft-empty"><div className="pa-draft-empty-icon"><RobotOutlined/></div><strong>待确认需求</strong><p>当前节点数量待补充。回答左侧问题后，助手会更新节点结构、排列和模型配置。</p><div className="pa-draft-empty-meta">节点数量：待确认<br/>布局与模型配置：待确认</div></div>:!draft?<div className="pa-draft-empty"><div className="pa-draft-empty-icon"><RobotOutlined/></div><strong>草案将在这里出现</strong><p>告诉助手你的目标与流程要求。生成结果可编辑、可检查后再载入项目。</p><div className="pa-draft-empty-meta">名称 · 分类 · 简介<br/>节点配置 · 脚本 · 连线</div></div>:<><div className="pa-draft-scroll">
      <div className="pa-draft-summary"><span className="pa-summary-label">{project?'与当前工作区相比':'新项目草案'}</span><WorkflowChangePreview previous={previousDraft} draft={draft}/>{responseModel&&<small>生成模型：{responseModel}</small>}</div>
      {unresolvedQuestions.length>0&&<Alert className="pa-pending-questions" type="info" showIcon message="上一版草案供参考；补充问题并收到更新后即可载入。"/>}
      <label className="pa-field">项目名称<Input disabled={busy||sessionArchived} value={draft.name} onChange={event=>updateDraft('name',event.target.value)} maxLength={120}/></label>
      <label className="pa-field">科研分类<Input disabled={busy||sessionArchived} value={draft.category} onChange={event=>updateDraft('category',event.target.value)} placeholder={categories.join('、')}/></label>
      <label className="pa-field">项目简介<Input.TextArea disabled={busy||sessionArchived} value={draft.description} onChange={event=>updateDraft('description',event.target.value)} autoSize={{minRows:3,maxRows:7}} maxLength={2000}/></label>
      <div className="pa-clinical-check"><Checkbox disabled={busy||sessionArchived} checked={draft.clinicalData} onChange={event=>{updateDraft('clinicalData',event.target.checked);setClinicalReviewed(false);}}>此草案包含临床个体级数据</Checkbox>{draft.clinicalData?<><small>模型请求仅携带项目元信息、节点配置与对话。</small><Checkbox disabled={busy||sessionArchived} checked={clinicalReviewed} onChange={event=>setClinicalReviewed(event.target.checked)}>已复核临床数据范围，个体级资料默认留在本地</Checkbox></>:<small>复核数据范围与本地处理要求。</small>}</div>
      <div className="pa-layout-control"><strong>节点数量：{draft.nodes.length}</strong><Radio.Group disabled={busy||sessionArchived} size="small" value={layoutMode} onChange={event=>setLayoutMode(event.target.value)} optionType="button" buttonStyle="solid" options={[{label:'保持建议',value:'suggested'},{label:'横向',value:'horizontal'},{label:'纵向',value:'vertical'},{label:'按类型分组',value:'grouped'}]}/><Button disabled={busy||sessionArchived} size="small" onClick={()=>{if(layoutMode==='suggested')return;try{updateDraft('nodes',topologicalLayout(draft.nodes,draft.edges,layoutMode));}catch(reason){setError(errorText(reason));}}}>应用排列</Button></div>
      {!topologicalOrder(draft.nodes,draft.edges)&&<Alert className="pa-layout-error" type="error" showIcon message="节点依赖存在循环，排列前请先检查连线。"/>}
      <section className="pa-node-overview" aria-label="节点概览"><strong>节点概览 · {draft.nodes.length} 个</strong>{orderedNodes.map((node,nodeIndex)=><div className="pa-node-row" key={node.id}><span className="pa-node-order">{nodeIndex+1}</span><div className="pa-node-title"><b>{node.data.label}</b><small>{node.data.kind}{node.data.kind==='llm'?` · ${answerLabel(node.data.configId||draft.settings?.defaultConfigId,node.data.model||(node.data.configId===undefined?draft.settings?.defaultModel:undefined))}`:''}</small></div>{node.data.kind==='llm'&&<ModelSelection configs={configs} stacked disabled={busy||sessionArchived} value={{configId:node.data.configId??draft.settings?.defaultConfigId,model:node.data.model??(node.data.configId===undefined?draft.settings?.defaultModel:undefined)}} allowClear ariaLabel={`${node.data.label}模型`} onChange={choice=>updateDraft('nodes',draft.nodes.map(item=>item.id===node.id?{...item,data:{...item.data,configId:choice.configId,model:choice.model}}:item))}/>}</div>)}</section>
      <details className="pa-config-details"><summary>项目 Agent 规则与默认模型</summary><p>{draft.settings?.agentRules||'未设置额外规则'}</p><ModelSelection configs={configs} stacked disabled={busy||sessionArchived} value={{configId:draft.settings?.defaultConfigId,model:draft.settings?.defaultModel}} allowClear ariaLabel="草案默认模型" onChange={choice=>updateDraft('settings',{...draft.settings,defaultConfigId:choice.configId,defaultModel:choice.model})}/><div className="pa-readable-settings"><div><span>继承全局设置</span><ReadableValue value={draft.settings?.inheritGlobal} emptyLabel="未设置" compact/></div><div><span>草案默认模型</span><ReadableValue value={draft.settings?.defaultConfigId?answerLabel(draft.settings.defaultConfigId,draft.settings.defaultModel):'使用当前对话模型'} compact/></div></div></details>
      <details className="pa-config-details"><summary>节点配置与脚本 <span>{draft.nodes.length} 个</span></summary>{draft.nodes.length?<div className="pa-config-list">{orderedNodes.map((node,index)=><details className="pa-config-item" key={node.id}><summary><span className="pa-node-order">{index+1}</span><strong>{node.data.label||node.id}</strong><span>{node.data.kind}</span></summary><div className="pa-config-item-meta">节点 ID：{node.id} · 位置：({node.position.x}, {node.position.y})</div><ReadableValue value={node.data} compact/></details>)}</div>:<p className="pa-config-empty">暂无节点配置。</p>}</details>
      <details className="pa-config-details"><summary>连线关系 <span>{draft.edges.length} 条</span></summary>{draft.edges.length?<ol className="pa-edge-list">{draft.edges.map((edge,index)=>{const source=draft.nodes.find(node=>node.id===edge.source),target=draft.nodes.find(node=>node.id===edge.target);return <li key={edge.id||`${edge.source}-${edge.target}-${index}`}><div className="pa-edge-relation"><strong>{source?.data.label||edge.source}</strong><span>→</span><strong>{target?.data.label||edge.target}</strong></div><details><summary>查看连线字段</summary><ReadableValue value={edge} compact/></details></li>;})}</ol>:<p className="pa-config-empty">暂无连线。</p>}</details>
      {pendingAssociation&&<Alert className="pa-apply-error" type="warning" showIcon message="项目已创建，对话关联待重试" description={<span>项目“{pendingAssociation.projectName}”已保留。{pendingAssociation.error||'重试只会关联这段原对话，不会再次创建项目。'}{associationRetryError&&<><br/>最近一次重试：{associationRetryError}</>}</span>} action={<Button size="small" loading={associationRetryBusy} onClick={()=>void retryAssociation()}>重试关联原对话</Button>}/>}
      {applyError&&!pendingAssociation&&<Alert className="pa-apply-error" type="error" showIcon message="载入草案失败" description={applyError}/>}
      {applyNotice&&<Alert className="pa-apply-notice" type="success" showIcon message={applyNotice}/>}
     </div><div className="pa-draft-apply-footer">
      <Button className="pa-apply-button" type="primary" size="large" loading={applying||associationRetryBusy} disabled={busy||sessionArchived||(!pendingAssociation&&(!draft.name.trim()||applied||unresolvedQuestions.length>0||draft.clinicalData&&!clinicalReviewed))} onClick={()=>{if(pendingAssociation)void retryAssociation();else setReviewOpen(true);}}>{pendingAssociation?'重试对话关联':busy?'正在生成草案':unresolvedQuestions.length?'等待补充信息':applied?(project?'已载入当前草稿':'已创建项目草案'):(project?'复核并载入草案':'复核并创建项目')}</Button>
      <small className="pa-apply-note">{pendingAssociation?'项目已创建，继续关联原对话即可返回原会话。':project?'载入到当前项目的待保存工作区。':'创建项目并载入此草案。'}工作流由你检查后启动。</small>
     </div></>}
    </aside>
   </main>
  </div>
 </Modal>
 <Modal className="pa-apply-review-modal" title={project?'复核草案变更':'复核新项目草案'} open={reviewOpen&&open} width={780} okText={project?'载入待保存工作区':'创建项目并保留对话'} cancelText="返回调整" confirmLoading={applying} okButtonProps={{disabled:busy||sessionArchived||!draft||!!unresolvedQuestions.length}} onCancel={()=>{if(!applying)setReviewOpen(false);}} onOk={()=>void applyDraft()}>
  <p>{project?`对照当前工作区（已保存版本 v${project.revision}${hasUnsavedChanges?'，含未保存调整':''}）检查变更。载入后仍需保存；历史版本与运行记录保留。`:'创建项目后，这段对话与草案将保留在项目内。'}</p>
  {draft&&<WorkflowChangePreview previous={previousDraft} draft={draft} expanded/>}
  {applyError&&<Alert type="error" showIcon message="载入失败" description={applyError}/>}
 </Modal>
 <Modal className="pa-context-picker-modal" title={contextPicker==='run'?'添加运行排查':'添加项目资料'} open={!!contextPicker} width={460} okText="加入待发送材料" cancelText="取消" confirmLoading={contextPickerBusy} okButtonProps={{disabled:contextPickerBusy||!contextProjectId||contextPicker==='run'&&!contextRunId}} onOk={()=>void addSelectedContext()} onCancel={closeContextPicker}>
  <p>选择要加入本轮的材料。材料只会进入待发送卡片；点击发送前仍可预览或移除。</p>
  {contextPickerError&&<Alert type="error" showIcon message="读取材料失败" description={contextPickerError}/>}
  <label className="modal-field">项目<Select showSearch optionFilterProp="label" value={contextProjectId||undefined} loading={contextPickerBusy&&!contextProjects.length} disabled={contextPickerBusy} placeholder="选择项目" options={contextProjects.map(item=>({value:item.id,label:`${item.name} · v${item.revision}`}))} onChange={id=>void changeContextProject(id)}/></label>
  {contextPicker==='run'&&<>
   <label className="modal-field">运行记录<Select showSearch optionFilterProp="label" value={contextRunId||undefined} loading={contextPickerBusy&&!!contextProjectId} disabled={contextPickerBusy||!contextProjectId} placeholder="选择运行记录" options={contextRuns.map(item=>({value:item.id,label:`${new Date(item.createdAt).toLocaleString()} · ${statusName[item.status]||item.status}${runHasDiagnostics(item)?' · 有错误':''}`}))} onChange={setContextRunId}/></label>
   {!contextPickerBusy&&!contextRuns.length&&contextProjectId&&<Alert type="info" showIcon message="该项目还没有运行记录。"/>}
  </>}
  {contextPickerBusy&&<Spin size="small"/>}
 </Modal>
 <LocalFilePicker open={localFilesOpen} onClose={()=>setLocalFilesOpen(false)} onSelect={addLocalAttachment}/>
 <Modal className="pa-mcp-modal" title={mcpResource?'检查并调用 MCP · '+mcpResource.name:'MCP 工具'} open={mcpOpen} width={760} onCancel={()=>setMcpOpen(false)} footer={null}>
  {mcpResource&&<Alert type="info" showIcon message={'来源：'+(mcpResource.source||'本地 MCP')+' · '+(mcpResource.transport||'未知传输')+' · '+(mcpResource.status||'可用')} description="参数会在本机工具中执行。核对工具与参数后，点击“调用并加入对话”才会执行。"/>}
  {mcpError&&<Alert className="pa-mcp-error" type="error" showIcon message="MCP 操作失败" description={mcpError}/>}
  {mcpBusy&&<Spin/>}
  {!!mcpTools.length&&<><label className="modal-field">工具<Select showSearch value={mcpToolName||undefined} options={mcpTools.map(tool=>({value:tool.name,label:tool.name}))} onChange={name=>{const tool=mcpTools.find(item=>item.name===name);setMcpToolName(name);setMcpArgs(sampleMcpArgs(tool?.inputSchema||{}));}}/></label><p>{mcpTools.find(tool=>tool.name===mcpToolName)?.description}</p><div className="pa-mcp-parameters"><strong>参数</strong><TypedParameters schema={mcpTools.find(tool=>tool.name===mcpToolName)?.inputSchema||{type:'object',properties:{}}} value={mcpArgs} onChange={setMcpArgs} disabled={mcpBusy}/></div><Button type="primary" icon={<ToolOutlined/>} loading={mcpBusy} onClick={()=>void callMcp()}>调用并加入对话</Button></>}
 </Modal>
 <Modal className="pa-file-preview-modal" title={previewFile?.name||'附件预览'} open={!!previewFile} width={900} onCancel={()=>setPreviewFile(undefined)} footer={null}><div className="pa-file-preview">{previewFile?.content??previewFile?.preview??'附件正文暂不可用，查看附件信息或再次读取。'}</div>{previewFile&&<small>{previewFile.size} bytes · {previewFile.characters||0} 字符{previewFile.sha256?' · SHA-256 '+previewFile.sha256:''}</small>}</Modal>
 </>;
}
