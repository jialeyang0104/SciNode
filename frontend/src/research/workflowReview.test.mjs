import test from 'node:test';
import assert from 'node:assert/strict';
import {bindTextSource,compareWorkflow,materialReferences,nodeSetupIssues,sameWorkflowValue} from './workflowReview.ts';
import {assistantRequestMessages} from './assistantConversation.ts';
const node=(id,kind='llm',extra={})=>({id,type:'research',position:{x:0,y:0},data:{kind,label:id,...extra}});
const draft=(nodes,edges=[],extra={})=>({name:'研究',category:'数据分析',description:'',clinicalData:false,nodes,edges,...extra});
const context={sources:['{{input.text}}','{{upstream.text}}'],modelReady:true,fileIds:['file1']};

test('readiness checks required task configuration without changing saveable data',()=>{
 const data={kind:'llm',label:'审阅',prompt:''};
 assert.deepEqual(nodeSetupIssues(data,{...context,modelReady:false}).map(issue=>issue.key),['prompt','model']);
 assert.equal(data.prompt,'');
 for(const kind of ['python','r'])assert.equal(nodeSetupIssues({kind,label:kind},context)[0].key,'script');
 assert.equal(nodeSetupIssues({kind:'pubmed',label:'检索'},context)[0].key,'query');
 assert.equal(nodeSetupIssues({kind:'document',label:'读取'},context)[0].section,'inputs');
 assert.equal(nodeSetupIssues({kind:'document',label:'读取',fileId:'gone'},context)[0].key,'fileId');
});

test('valid inherited model, runtime input and default approval question need no extra prerequisites',()=>{
 assert.deepEqual(nodeSetupIssues({kind:'llm',label:'审阅',prompt:'总结 {{upstream.text}}'},context),[]);
 for(const kind of ['input','approve','package'])assert.deepEqual(nodeSetupIssues({kind,label:kind},context),[]);
});

test('source validation accepts transitive ancestors and custom output fields',()=>{
 const data={kind:'llm',label:'分析',prompt:'{{ upstream.new_metric }}',inputs:{metadata:{sources:['{{upstream.unlisted}}','{{input.any_value}}']}}};
 assert.deepEqual(nodeSetupIssues(data,context),[]);
 assert.equal(nodeSetupIssues({...data,prompt:'{{missing.text}}'},context)[0].section,'task');
 assert.equal(nodeSetupIssues({...data,inputs:{text:'{{missing.text}}'}},context)[0].section,'inputs');
 assert.equal(nodeSetupIssues({...data,prompt:'{{malformed}}'},context)[0].key,'prompt:{{malformed}}');
 assert.deepEqual(materialReferences({a:['{{ upstream.text }}','{{upstream.text}}'],b:'{{input.text}}'}),['{{upstream.text}}','{{input.text}}']);
});

test('export and quality-check report the exact missing input, allowing numeric zero and false',()=>{
 assert.equal(nodeSetupIssues({kind:'export',label:'导出',inputs:{}},context)[0].key,'inputs.text');
 assert.deepEqual(nodeSetupIssues({kind:'export',label:'导出',inputs:{text:'{{upstream.text}}'}},context),[]);
 assert.match(nodeSetupIssues({kind:'export',label:'导出',inputs:{text:{summary:'data'}}},context)[0].message,/文字类型/);
 assert.deepEqual(nodeSetupIssues({kind:'check',label:'检查',requiredFields:['count','flag'],inputs:{count:0,flag:false}},context),[]);
 assert.equal(nodeSetupIssues({kind:'check',label:'检查',requiredFields:['text'],inputs:{text:'  '}},context)[0].key,'inputs.text');
 assert.equal(nodeSetupIssues({kind:'check',label:'检查'},context)[0].key,'requiredFields');
});

test('MCP configuration can use an empty parameter object but not an absent parameter table',()=>{
 assert.equal(nodeSetupIssues({kind:'mcp',label:'工具'},context).length,2);
 assert.deepEqual(nodeSetupIssues({kind:'mcp',label:'工具',mcpId:5,arguments:{}},context),[]);
});

test('quick text binding changes only text and preserves structured inputs',()=>{
 const original={kind:'export',label:'导出',inputs:{text:'old',patches:[{index:0,text:'new'}],metadata:{keep:true}},fileId:'file1'};
 assert.deepEqual(bindTextSource(original,'{{upstream.text}}'),{inputs:{...original.inputs,text:'{{upstream.text}}'}});
 assert.equal(original.inputs.text,'old');
});

test('workflow diff compares values, ignoring key order, runtime previews and edge IDs',()=>{
 const before=draft([node('a','llm',{prompt:'task',inputs:{text:'x',metadata:{a:1,b:2}}})],[{id:'edge1',source:'a',target:'b'}]);
 const after=draft([node('a','llm',{inputs:{metadata:{b:2,a:1},text:'x'},prompt:'task',preview:{status:'RUNNING'},runVisualState:'active'})],[{id:'edge2',source:'a',target:'b'}]);
 const result=compareWorkflow(before,after);
 assert.equal(result.hasChanges,false);
 assert.deepEqual(result.changed,[]);
 assert.equal(sameWorkflowValue({a:1,b:undefined},{a:1}),true);
});

test('workflow diff reports same-count rewiring, node deletion, exact fields and metadata',()=>{
 const before=draft([node('a'),node('b'),node('c')],[{id:'e1',source:'a',target:'b'}]);
 const after=draft([node('a','llm',{prompt:'new',model:'m2'}),node('b'),node('d')],[{id:'e2',source:'a',target:'d'}],{name:'研究二'});
 const result=compareWorkflow(before,after);
 assert.deepEqual(result.added.map(item=>item.id),['d']);
 assert.deepEqual(result.removed.map(item=>item.id),['c']);
 assert.deepEqual(result.changed[0].fields.map(item=>item.label),['任务提示词','具体模型']);
 assert.equal(result.addedEdges[0].target,'d');
 assert.equal(result.removedEdges[0].target,'b');
 assert.equal(result.metadata[0].label,'项目名称');
 assert.equal(result.hasChanges,true);
});

test('layout is a distinct change and initial drafts show all additions',()=>{
 const before=draft([node('a')]);const after=structuredClone(before);after.nodes[0].position.x=310;
 const result=compareWorkflow(before,after);
 assert.equal(result.changed.length,0);assert.equal(result.moved.length,1);assert.equal(result.hasChanges,true);
 assert.equal(compareWorkflow(undefined,after).added.length,1);
});

test('sending a restored draft keeps original message drafts intact and includes selected working draft',()=>{
 const original=draft([node('a','input',{text:'one'})]);
 const latest=draft([node('b','input',{text:'two'})]);
 const working=draft([node('c','input',{text:'working'})]);
 const history=[{role:'user',content:'规划'},{role:'assistant',content:'第一版',draft:original},{role:'user',content:'修改'},{role:'assistant',content:'第二版',draft:latest,planning:{summary:'调整',steps:[],assumptions:[],decisions:[]}},{role:'user',content:'继续'}];
 const snapshot=structuredClone(history);
 const request=assistantRequestMessages(history,working);
 assert.deepEqual(history,snapshot);
 assert.equal(request[1].content,'第一版');
 assert.match(request[3].content,/working/);
 assert.doesNotMatch(request[3].content,/"text":"two"/);
 assert.match(request[3].content,/publicPlanning/);
 assert.equal(request.at(-1).content,'继续');
});

test('assistant context keeps last 20 messages and material cards without changing user content',()=>{
 const cards=[{id:'x',type:'project_summary',title:'材料',content:'内容',truncated:false}];
 const history=Array.from({length:24},(_,i)=>({role:i%2?'assistant':'user',content:String(i),...(i===22?{contextCards:cards}:{})}));
 const request=assistantRequestMessages(history,undefined,20);
 assert.equal(request.length,20);assert.equal(request[0].content,'4');
 assert.deepEqual(request.at(-2).contextCards,cards);
 assert.equal(request.at(-2).content,'22');
});
