import {useEffect,useState,type RefObject} from 'react';
import {Alert,Button,ConfigProvider,Divider,Input,InputNumber,Modal,Select,Space,Tag,Tabs,message} from 'antd';
import {CheckCircleOutlined,CopyOutlined,DeleteOutlined,WarningOutlined,RobotOutlined} from '@ant-design/icons';
import type {LLMGlobalConfig} from '../api/llmConfig';
import type {McpToolConfig} from '../api/mcpTools';
import ModelSelection from './ModelSelection';
import {catalog,llmTaskPresets,nodeGuidance,outputPreviews} from './catalog';
import {errorText,research} from './api';
import type {AssistantMcpTool,NodeResult,Project,ResearchData,ResearchNode,Run} from './types';
import {InputMappingEditor,type MappingOption} from './InputMappingEditor';
import {ReadableValue,StructuredFields,TypedParameters} from './StructuredFields';
import {applyPromptPreset,fillBlankExample,findPromptPresetMatch} from './nodeFormLogic';
import {materialReferences,nodeSetupIssues,outputFieldNames,type ConfigurationSection} from './workflowReview';
import MarkdownPreview from './MarkdownPreview';
import ClinicalStatistics,{TableFilePreview} from './ClinicalStatistics';
import PubMedFields from './PubMedFields';
import {SourceCards,PromptEditor} from './SourceCards';
import {nodeResultSummary} from './runPresentation.mjs';

interface Props {
 selected:ResearchNode;
 project:Project;
 run:Run|null;
 selectedResult:NodeResult|undefined;
 mutationDisabled:boolean;
 mutationReason?:string;
 snapshot:boolean;
 frozenRevision?:number;
 nodeEditorRef:RefObject<HTMLFieldSetElement>;
 configs:LLMGlobalConfig[];
 modelForNode:(data:ResearchData)=>{configId?:number;config?:LLMGlobalConfig;model?:string};
 mcpTools:McpToolConfig[];
 variables:MappingOption[];
 onUpdate:(data:Partial<ResearchData>)=>void;
 onFileChange:(fileId:string|undefined)=>void;
 onAssistant:()=>void;
 onPreview:()=>void;
 onCopy:()=>void;
 onSaveTemplate:()=>void;
 onDelete:()=>void;
 onRerun:()=>void;
}

export default function NodeConfiguration({selected,project,run,selectedResult,mutationDisabled,mutationReason,snapshot,frozenRevision,nodeEditorRef,configs,modelForNode,mcpTools,variables,onUpdate,onFileChange,onAssistant,onPreview,onCopy,onSaveTemplate,onDelete,onRerun}:Props){
 const [mcpSchema,setMcpSchema]=useState<{tools:AssistantMcpTool[]}>();
 const [mcpBusy,setMcpBusy]=useState(false);
 const [section,setSection]=useState<ConfigurationSection>('task');
 useEffect(()=>{setMcpSchema(undefined);},[selected.id,selected.data.mcpId]);
 const data=selected.data,kind=data.kind;
 const promptSources=materialReferences(data.prompt);
 const promptPresetMatch=findPromptPresetMatch(data.prompt||'',llmTaskPresets);
 const mappedTaskSource=typeof data.inputs?.text==='string'&&/^\{\{[^{}]+\}\}$/.test(data.inputs.text)?data.inputs.text:undefined;
 const selectedTaskSource=promptPresetMatch?.source||mappedTaskSource||promptSources[0]||variables.find(option=>option.value.endsWith('.text}}'))?.value||'{{input.text}}';
 const activePreset=llmTaskPresets.find(preset=>preset.id===data.presetId)||promptPresetMatch?.preset;
 const mcpConfig=kind==='mcp'?mcpTools.find(tool=>tool.id===data.mcpId):undefined;
 const inspected=mcpConfig?mcpSchema?.tools.find(tool=>tool.name===mcpConfig.toolName):undefined;
 const args=data.arguments&&typeof data.arguments==='object'&&!Array.isArray(data.arguments)?data.arguments:{};
 const effectiveModel=modelForNode(data);
 const issues=nodeSetupIssues(data,{sources:variables.map(option=>option.value),modelReady:!!(effectiveModel.config&&effectiveModel.model),fileIds:project.files.map(file=>file.id)});
 const guide=nodeGuidance[kind],catalogItem=catalog[kind];
 const showPreset=(id:string)=>{
  const preset=llmTaskPresets.find(item=>item.id===id);if(!preset)return;
  const apply=()=>{onUpdate({...applyPromptPreset(data,preset,selectedTaskSource),presetId:preset.stage?preset.id:undefined,taskFields:{}});message.success(`已套用“${preset.label}”，可在“输入资料”中调整来源`);};
  if(data.prompt&&data.prompt!==preset.prompt)Modal.confirm({title:`切换为“${preset.label}”？`,content:'替换任务提示词；模型、文件和其他输入映射保持不变。',okText:'替换提示词',cancelText:'取消',onOk:apply});else apply();
 };
 const fillExample=()=>{
  if(!Object.keys(catalogItem.example).length)return;
  Modal.confirm({title:'补入本节点示例字段？',content:'只补空白任务字段，保留已填写内容、模型、文件和输入映射。',okText:'补入空白字段',cancelText:'取消',onOk:()=>{onUpdate(fillBlankExample(data,catalogItem.example));message.success('已补入空白示例字段');}});
 };
 const inspect=async()=>{
  if(!data.mcpId)return;setMcpBusy(true);
  try{setMcpSchema(await research.inspectMcp(data.mcpId));}
  catch(error){message.error(errorText(error));}
  finally{setMcpBusy(false);}
 };
 const mapping=<InputMappingEditor value={data.inputs||{}} variables={variables} disabled={mutationDisabled} onChange={inputs=>onUpdate({inputs})}/>;
 const updateTaskField=(key:string,value:string)=>{
  if(!activePreset)return;
  const taskFields={...data.taskFields,[key]:value};
  const context=Object.entries(taskFields).filter(([,value])=>value.trim()).map(([key,value])=>`${key}：${value}`).join('\n');
  onUpdate({taskFields,prompt:activePreset.prompt.replace('{{input.text}}',promptSources.join('\n'))+'\n\n研究补充说明：\n'+context});
 };
 return <aside className="research-config">
  <div className="node-config-heading"><span className="node-config-eyebrow">NODE INSPECTOR · 节点设置</span><h3>{data.label}<Tag>{catalogItem.label}</Tag></h3><p className="node-config-description">{catalogItem.description}</p></div>
  {snapshot&&run&&<Alert type="info" message={`历史快照 · v${run.revision}`} description="配置只读，可切换下方标签查看。"/>}
  {mutationReason&&<Alert type="warning" message={mutationReason}/>}
  {!mutationDisabled&&frozenRevision!==undefined&&<Alert type="info" message={`成果已冻结于 v${frozenRevision}`} description="编辑后保存为新版本，冻结记录保留。"/>}
  <button className={`node-readiness ${issues.length?'needs-attention':'configured'}`} onClick={()=>setSection('outputs')} type="button">
   {issues.length?<WarningOutlined/>:<CheckCircleOutlined/>}<span><strong>{issues.length?`还有 ${issues.length} 项配置待补充`:'已填写主要配置'}</strong><small>{issues.length?'查看检查项，定位需要补充的地方':'运行前再核对资料、授权与输出'}</small></span><span>查看 ›</span>
  </button>
  <div className="node-assistant-entry"><Button block icon={<RobotOutlined/>} onClick={onAssistant}>与助手一起调整此节点</Button><p>讨论任务、模型和上下游连接，复核后再载入。</p></div>
  <Tabs className="node-config-tabs" activeKey={section} onChange={key=>setSection(key as ConfigurationSection)} items={[{key:'task',label:'1 任务设置'},{key:'inputs',label:'2 输入资料'},{key:'outputs',label:'3 输出与检查'}]}/>
  <ConfigProvider componentDisabled={mutationDisabled}>
  <fieldset ref={nodeEditorRef} disabled={mutationDisabled} className="node-edit-fieldset">
   <section hidden={section!=='task'} aria-label="任务设置">
    <label>节点名称<Input aria-label="节点名称" value={data.label} onChange={event=>onUpdate({label:event.target.value})}/></label>
    {kind==='llm'&&<>
     <section className="task-preset-block"><label>想让模型做什么？<Select aria-label="科研任务预设" value={activePreset?.id??null} options={['立项与设计','统计与图表解读','论文与投稿','通用任务'].map(stage=>({label:stage,options:llmTaskPresets.filter(preset=>(preset.stage||'通用任务')===stage).map(preset=>({value:preset.id,label:preset.label}))}))} onChange={showPreset} placeholder="选一个预设，再按你的研究修改"/></label><p>{activePreset?.guidance||'选择预设或编写任务，再勾选输入资料。'}</p></section>
     <label>使用哪个模型？<span className="node-field-hint">{data.configId?'当前节点单独指定模型':'未单独指定时，沿用项目或全局默认设置'}</span></label>
     <ModelSelection configs={configs} value={effectiveModel} disabled={mutationDisabled} allowClear ariaLabel={`${data.label}模型`} onChange={choice=>onUpdate({configId:choice.configId,model:choice.model})}/>
     {activePreset?.stage?<><div className="clinical-prompt-fields">{['研究疾病 / 人群','主要关注指标','特殊排除条件','研究设计 / 时间窗'].map(key=><label key={key}>{key}<Input aria-label={key} value={data.taskFields?.[key]} onChange={event=>updateTaskField(key,event.target.value)}/></label>)}</div><details><summary>查看完整任务与接入资料</summary><PromptEditor value={data.prompt||''} variables={variables} onChange={prompt=>onUpdate({prompt,presetId:undefined})}/></details></>:<><label>任务说明 *</label><PromptEditor value={data.prompt||''} variables={variables} onChange={prompt=>onUpdate({prompt,presetId:undefined})}/></>}
     <details className="node-advanced-inputs"><summary>高级：编辑原始提示词</summary><Input.TextArea aria-label="原始任务提示词" rows={7} value={data.prompt} onChange={event=>onUpdate({prompt:event.target.value,presetId:undefined})}/></details>
    </>}
    {kind==='input'&&<><label>固定任务内容（可选）<Input.TextArea aria-label="固定任务内容" rows={7} value={data.text} onChange={event=>onUpdate({text:event.target.value})} placeholder="写下研究目标与交付要求；也可使用每次运行时输入的内容。"/></label><Button size="small" onClick={()=>onUpdate({text:'{{input.text}}'})}>使用每次运行时填写的内容</Button></>}
    {kind==='pubmed'&&<PubMedFields data={data} onChange={onUpdate}/>}
    {['python','r'].includes(kind)&&<>
     <label>配置方式<Select aria-label="统计配置方式" value={data.analysisPreset?'clinical':'script'} options={[{value:'clinical',label:'临床统计向导'},{value:'script',label:'自定义脚本（统计师）'}]} onChange={mode=>onUpdate({analysisPreset:mode==='clinical'?'quality':undefined})}/></label>
     {data.analysisPreset?<ClinicalStatistics project={project} data={data} onChange={onUpdate}/>:<details className="custom-script-details"><summary>高级：查看 / 自定义 {kind==='python'?'Python':'R'} 脚本</summary><label>执行脚本 *<Input.TextArea aria-label="执行脚本" rows={16} className="code-input" value={data.script} onChange={event=>onUpdate({script:event.target.value})} spellCheck={false}/></label></details>}
     <label>最长运行时间（秒）<InputNumber min={1} max={3600} value={data.timeout||120} onChange={value=>onUpdate({timeout:value||120})}/></label>
    </>}
    {kind==='mcp'&&<section className="mcp-parameters"><label>MCP 工具 *<Select value={data.mcpId} options={mcpTools.filter(tool=>tool.enabled===1&&tool.transport==='stdio').map(tool=>({value:tool.id,label:`${tool.name} · ${tool.toolName}`}))} onChange={mcpId=>{onUpdate({mcpId});setMcpSchema(undefined);}} placeholder="先在项目或全局设置中启用工具"/></label><Button loading={mcpBusy} disabled={mutationDisabled||!data.mcpId} onClick={()=>void inspect()}>读取工具参数说明</Button>
     {inspected?<><div className="mcp-description"><strong>{inspected.name}</strong>{inspected.description&&<p>{inspected.description}</p>}</div><TypedParameters schema={inspected.inputSchema||{type:'object'}} value={args} disabled={mutationDisabled} onChange={next=>onUpdate({arguments:next})}/></>:mcpSchema?<Alert type="warning" message={`“${mcpConfig?.toolName||'所选工具'}”不在返回列表中`} description="已有参数保留，请检查工具配置。"/>:<><p className="node-field-hint">读取说明后，会显示必填参数与类型。已有参数可在下方修改。</p><StructuredFields value={args} label="已有参数" disabled={mutationDisabled} onChange={next=>onUpdate({arguments:next})}/></>}
     {!data.arguments&&<Button size="small" onClick={()=>onUpdate({arguments:{}})}>此工具无需参数，使用空参数表</Button>}
    </section>}
    {kind==='approve'&&<label>希望研究者确认什么？<Input.TextArea rows={5} value={data.question} onChange={event=>onUpdate({question:event.target.value})} placeholder="例如：核对纳排标准、主要结局及证据来源，批准后继续导出。"/></label>}
    {kind==='approve'&&<label>逐项审阅清单<Select aria-label="逐项审阅清单" mode="tags" value={data.reviewChecklist||[]} onChange={reviewChecklist=>onUpdate({reviewChecklist})} placeholder="输入每项必须核对的内容"/></label>}
    {kind==='export'&&<label>要生成什么文件？<Select value={data.format||'docx'} options={['docx','pdf','md','txt'].map(value=>({value,label:value==='docx'?'Word（.docx）':value==='pdf'?'PDF':value.toUpperCase()}))} onChange={format=>onUpdate({format})}/></label>}
    {kind==='check'&&<><label>哪些输入不能为空？ *<Select mode="tags" value={data.requiredFields||[]} options={[...new Set(['text',...Object.keys(data.inputs||{})])].map(value=>({value,label:value==='text'?'正文（text）':value}))} placeholder="选择字段，也可输入自定义名称" onChange={requiredFields=>onUpdate({requiredFields})}/></label><p className="node-field-hint">下一步为同名字段接入资料；运行时逐项检查。</p></>}
    {['document','package'].includes(kind)&&<div className="node-step-note">{kind==='document'?'下一步选择要读取的项目文件。':'这个节点无需额外参数，会整理本次运行已有的成果与记录。'}</div>}
    <details className="node-guide"><summary>用途说明与配置示例</summary><p>{catalogItem.description}</p><ul>{guide.map(item=><li key={item}>{item}</li>)}</ul><label>这一步要做什么（可选）<Input.TextArea value={data.description} onChange={event=>onUpdate({description:event.target.value})} rows={2} placeholder={catalogItem.description}/></label>{Object.keys(catalogItem.example).length>0&&<div className="node-example-action"><Button size="small" onClick={fillExample}>补入空白示例字段</Button><span>已有内容保留</span></div>}</details>
    <Button block onClick={()=>setSection('inputs')}>下一步：接入研究资料 →</Button>
   </section>
   <section hidden={section!=='inputs'} className="node-mapping-section" aria-label="输入资料">
    <h4>这一步使用什么资料？</h4>
    {['document','export','python','r'].includes(kind)&&<label>{kind==='document'?'读取项目文件 *':kind==='export'?'原始 Word 文件（仅修订原文时选择）':'输入文件（可选）'}<Select aria-label="节点项目文件" allowClear value={data.fileId} options={project.files.map(file=>({label:file.name,value:file.id}))} onChange={onFileChange} placeholder={project.files.length?'选择已导入的资料':'先在项目左侧导入资料'}/></label>}
    {['llm','export','approve','check','python','r'].includes(kind)&&<SourceCards data={data} variables={variables} onChange={onUpdate}/>}
    {kind==='document'&&<><label>Excel 工作表（留空读取第一张）<Input aria-label="文档工作表名称" value={data.sheet} onChange={event=>onUpdate({sheet:event.target.value})}/></label><TableFilePreview project={project} data={data}/></>}
    <details className="node-advanced-inputs"><summary>高级：其他输入字段与固定参数</summary>{mapping}</details>
    {variables.length===1&&kind!=='input'&&<p className="node-field-hint">还没有连接上游节点。先在画布连线，再回这里选择来源。</p>}
    <Button block onClick={()=>setSection('outputs')}>下一步：查看输出与检查 →</Button>
   </section>
   <section hidden={section!=='outputs'} aria-label="输出与检查">
    <h4>配置检查</h4>
    {issues.length?<ul className="node-check-list">{issues.map(issue=><li key={issue.key}><WarningOutlined/><span>{issue.message}</span><Button size="small" type="link" onClick={()=>setSection(issue.section)}>去配置</Button></li>)}</ul>:<div className="node-step-note"><CheckCircleOutlined/> 主要配置已填写，可保存后在运行确认中核对实际材料与执行范围。</div>}
    <section className="node-output-section"><h4>完成后会得到什么？</h4><p>{outputPreviews[kind]}</p><div className="node-output-fields">{catalogItem.outputs.map(name=><div key={name}><strong>{outputFieldNames[name]||name}</strong></div>)}</div></section>
    <label>自定义输出字段（可选）<Select mode="tags" value={data.outputFields||[]} placeholder="例如 effect、confidence_interval" onChange={outputFields=>onUpdate({outputFields})}/><span className="node-field-hint">用于让下游节点方便选择；实际结果由脚本或工具生成。</span></label>
    {['python','r'].includes(kind)&&!data.analysisPreset&&<details><summary>合成示例的输出</summary><ReadableValue value={{n:5,summary:{observed:4,missing:1,mean_observed:2.125},text:'合成示例数据：…'}}/></details>}
   </section>
  </fieldset>
  </ConfigProvider>
  <Divider/><Space wrap><Button icon={<CopyOutlined/>} disabled={mutationDisabled} onClick={onCopy}>复制</Button><Button disabled={mutationDisabled} onClick={onSaveTemplate}>存为模板</Button><Button danger icon={<DeleteOutlined/>} disabled={mutationDisabled} onClick={onDelete}>删除</Button></Space>
  {run&&<Button block disabled={mutationDisabled} onClick={onRerun}>从此节点创建重跑分支</Button>}
  <Divider/><h4>本节点运行摘要</h4>{selectedResult?<><Tag color={selectedResult.status==='SUCCESS'?'success':selectedResult.status==='FAILED'?'error':undefined}>{selectedResult.status==='SUCCESS'?'成功':selectedResult.status==='FAILED'?'失败':selectedResult.status}</Tag><MarkdownPreview text={nodeResultSummary(selectedResult,'暂无结果摘要')}/></>:<p className="node-result-empty">{run?`运行 v${run.revision} 中暂无此节点结果。`:'运行后，这里显示实际结果摘要。'}</p>}
  <Button onClick={onPreview}>查看结果与任务文件</Button>
 </aside>;
}
