import type {AssistantDraft,ResearchData,ResearchNode} from './types';

export type ConfigurationSection='task'|'inputs'|'outputs';
export interface ConfigurationIssue {key:string;section:ConfigurationSection;message:string}
export interface SetupContext {sources:string[];modelReady?:boolean;fileIds?:string[]}

export const workflowFieldNames:Record<string,string>={
 label:'节点名称',kind:'执行方式',description:'用途说明',prompt:'任务提示词',configId:'模型端口',model:'具体模型',
 inputs:'输入资料',script:'执行脚本',timeout:'超时时间',query:'检索式',limit:'返回篇数',fileId:'项目文件',
 format:'导出格式',question:'确认问题',text:'任务正文',requiredFields:'必检字段',outputFields:'附加输出字段',
 mcpId:'MCP 工具',arguments:'工具参数',name:'项目名称',category:'科研分类',clinicalData:'临床数据标记',settings:'Agent 规则与默认设置',
};
export const outputFieldNames:Record<string,string>={text:'正文',model:'实际模型',paragraphs:'原文段落',tables:'表格',
 sourceName:'来源文件名',sourceSha256:'来源校验值',papers:'文献列表',query:'实际检索式',total:'命中篇数',searchedAt:'检索时间',
 stdout:'标准输出',stderr:'错误日志',exitCode:'退出码',n:'样本数',summary:'汇总结果',passed:'检查通过',checks:'逐项检查结果',
 approved:'确认状态',decision:'确认意见',fileName:'成果文件名',exportMode:'导出方式',manifest:'文件清单',content:'返回内容',structuredContent:'结构化结果'};

export function materialReferences(value:unknown):string[]{
 const found=new Set<string>();
 const visit=(item:unknown)=>{
  if(typeof item==='string')for(const match of item.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*}}/g))found.add(`{{${match[1]}}}`);
  else if(Array.isArray(item))item.forEach(visit);
  else if(item&&typeof item==='object')Object.values(item).forEach(visit);
 };
 visit(value);return [...found];
}

const blank=(value:unknown)=>value===undefined||value===null||typeof value==='string'&&!value.trim();

// Configuration feedback is advisory: incomplete drafts remain saveable.
export function nodeSetupIssues(data:ResearchData,context:SetupContext):ConfigurationIssue[]{
 const issues:ConfigurationIssue[]=[];
 const add=(key:string,section:ConfigurationSection,message:string)=>issues.push({key,section,message});
 if(data.kind==='llm'){
  if(!data.prompt?.trim())add('prompt','task','写明需要模型完成的任务，或选择一个科研预设。');
  if(context.modelReady===false)add('model','task','选择模型端口与具体模型，或在项目设置中指定默认模型。');
 }
 if(['python','r'].includes(data.kind)&&!data.script?.trim())add('script','task','填写执行脚本，或补入空白示例后修改。');
 if(data.kind==='pubmed'&&!data.query?.trim())add('query','task','填写 PubMed 检索式。');
 if(data.kind==='document'&&!data.fileId)add('fileId','inputs','选择要读取的项目文件；未导入时先在项目中添加资料。');
 if(data.fileId&&context.fileIds&&!context.fileIds.includes(data.fileId))add('fileId','inputs','所选文件已不在项目资料中，请重新选择。');
 if(data.kind==='mcp'&&!data.mcpId)add('mcpId','task','选择项目或全局已启用的 MCP 工具。');
 if(data.kind==='mcp'&&(!data.arguments||typeof data.arguments!=='object'||Array.isArray(data.arguments)))add('arguments','task','填写工具参数；无需参数的工具可保留空参数表。');
 if(data.kind==='check'){
  if(!data.requiredFields?.length)add('requiredFields','task','选择至少一个需要检查的字段，例如“正文 text”。');
  for(const name of data.requiredFields||[])if(blank(data.inputs?.[name]))add(`inputs.${name}`,'inputs',`为必检字段“${name}”选择资料来源或填写固定值。`);
 }
 if(data.kind==='export'&&blank(data.inputs?.text))add('inputs.text','inputs','接入要导出的正文 text；可在资料页快速接入上游结果。');
 else if(data.kind==='export'&&typeof data.inputs?.text!=='string')add('inputs.text','inputs','导出正文需要文字类型，请选择上游正文 text，或将固定值改为文本。');
 const upstreamIds=new Set(context.sources.flatMap(source=>materialReferences(source).map(ref=>ref.slice(2,-2).split('.')[0])));
 const transient=new Set(['preview','runVisualState','onAppend']);
 for(const [key,value] of Object.entries(data)){
  if(transient.has(key))continue;
  for(const ref of materialReferences(value)){
   const path=ref.slice(2,-2),dot=path.indexOf('.'),source=path.slice(0,dot);
   // Custom script/MCP output fields may not yet be declared; validate ancestry, not field inventories.
   if(dot<1||(!upstreamIds.has(source)&&source!=='input'))add(`${key}:${ref}`,key==='inputs'||key==='fileId'?'inputs':'task',`资料引用 ${ref} 缺少上游连接。先连接来源节点，或改用可用资料。`);
  }
 }
 return issues;
}

export function bindTextSource(data:ResearchData,source:string):Partial<ResearchData>{
 return {inputs:{...data.inputs,text:source}};
}

function normalized(value:unknown):unknown{
 if(Array.isArray(value))return value.map(normalized);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined&&typeof item!=='function').sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,normalized(item)]));
 return value;
}
export const sameWorkflowValue=(a:unknown,b:unknown)=>JSON.stringify(normalized(a))===JSON.stringify(normalized(b));

export interface FieldChange {key:string;label:string;before:unknown;after:unknown}
export interface NodeChange {node:ResearchNode;fields:FieldChange[]}
export interface WorkflowChanges {
 added:ResearchNode[];removed:ResearchNode[];changed:NodeChange[];moved:ResearchNode[];
 addedEdges:AssistantDraft['edges'];removedEdges:AssistantDraft['edges'];metadata:FieldChange[];hasChanges:boolean;
}
export type WorkflowDefinition=Omit<AssistantDraft,'category'|'description'> & Partial<Pick<AssistantDraft,'category'|'description'>>;

export function compareWorkflow(previous:WorkflowDefinition|undefined,next:AssistantDraft):WorkflowChanges{
 const before=new Map(previous?.nodes.map(node=>[node.id,node])||[]),after=new Map(next.nodes.map(node=>[node.id,node]));
 const added=next.nodes.filter(node=>!before.has(node.id)),removed=(previous?.nodes||[]).filter(node=>!after.has(node.id));
 const ignored=new Set(['preview','runVisualState','onAppend']);
 const changed:NodeChange[]=[],moved:ResearchNode[]=[];
 for(const node of next.nodes){
  const old=before.get(node.id);if(!old)continue;
  const fields=[...new Set([...Object.keys(old.data),...Object.keys(node.data)])].filter(key=>!ignored.has(key)&&!sameWorkflowValue(old.data[key],node.data[key])).map(key=>({key,label:workflowFieldNames[key]||key,before:old.data[key],after:node.data[key]}));
  if(fields.length)changed.push({node,fields});
  if(!sameWorkflowValue(old.position,node.position))moved.push(node);
 }
 const edgeKey=(edge:AssistantDraft['edges'][number])=>JSON.stringify([edge.source,edge.sourceHandle||'',edge.target,edge.targetHandle||'']);
 const oldEdges=new Set(previous?.edges.map(edgeKey)||[]),newEdges=new Set(next.edges.map(edgeKey));
 const addedEdges=next.edges.filter(edge=>!oldEdges.has(edgeKey(edge))),removedEdges=(previous?.edges||[]).filter(edge=>!newEdges.has(edgeKey(edge)));
 const keys=['name','category','description','clinicalData','settings'] as const;
 const metadata=previous?keys.filter(key=>!sameWorkflowValue(previous[key],next[key])).map(key=>({key,label:workflowFieldNames[key],before:previous[key],after:next[key]})):[];
 return {added,removed,changed,moved,addedEdges,removedEdges,metadata,hasChanges:!!(added.length||removed.length||changed.length||moved.length||addedEdges.length||removedEdges.length||metadata.length)};
}
