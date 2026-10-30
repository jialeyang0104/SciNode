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
import {bindTextSource,materialReferences,nodeSetupIssues,outputFieldNames,type ConfigurationSection} from './workflowReview';

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
 const [variable,setVariable]=useState<string>();
 const [section,setSection]=useState<ConfigurationSection>('task');
 useEffect(()=>{setMcpSchema(undefined);setVariable(undefined);},[selected.id,selected.data.mcpId]);
 const data=selected.data,kind=data.kind;
 const promptSources=materialReferences(data.prompt);
 const promptPresetMatch=findPromptPresetMatch(data.prompt||'',llmTaskPresets);
 const mappedTaskSource=typeof data.inputs?.text==='string'&&/^\{\{[^{}]+\}\}$/.test(data.inputs.text)?data.inputs.text:undefined;
 const selectedTaskSource=variable||promptPresetMatch?.source||mappedTaskSource||(kind==='llm'?promptSources[0]:undefined)||'{{input.text}}';
 const taskSourceOptions=variables.some(option=>option.value===selectedTaskSource)?variables:[{value:selectedTaskSource,label:`当前资料来源 · ${selectedTaskSource}`},...variables];
 const mcpConfig=kind==='mcp'?mcpTools.find(tool=>tool.id===data.mcpId):undefined;
 const inspected=mcpConfig?mcpSchema?.tools.find(tool=>tool.name===mcpConfig.toolName):undefined;
 const args=data.arguments&&typeof data.arguments==='object'&&!Array.isArray(data.arguments)?data.arguments:{};
 const effectiveModel=modelForNode(data);
 const issues=nodeSetupIssues(data,{sources:variables.map(option=>option.value),modelReady:!!(effectiveModel.config&&effectiveModel.model),fileIds:project.files.map(file=>file.id)});
 const guide=nodeGuidance[kind],catalogItem=catalog[kind];
 const showPreset=(id:string)=>{
  const preset=llmTaskPresets.find(item=>item.id===id);if(!preset)return;
  const apply=()=>{onUpdate(applyPromptPreset(data,preset,selectedTaskSource));message.success(`已套用“${preset.label}”，可在“输入资料”中调整来源`);};
  if(data.prompt&&data.prompt!==preset.prompt)Modal.confirm({title:`切换为“${preset.label}”？`,content:'替换任务提示词；模型、文件和其他输入映射保持不变。',okText:'替换提示词',cancelText:'取消',onOk:apply});else apply();
 };
 const chooseTaskSource=(source:string)=>{
  setVariable(source);
  if(kind==='llm'&&promptPresetMatch&&promptPresetMatch.source!==source)onUpdate({prompt:applyPromptPreset(data,promptPresetMatch.preset,source).prompt});
 };
 const fillExample=()=>{
  if(!Object.keys(catalogItem.example).length)return;
  Modal.confirm({title:'补入本节点示例字段？',content:'只补空白任务字段，保留已填写内容、模型、文件和输入映射。',okText:'补入空白字段',cancelText:'取消',onOk:()=>{onUpdate(fillBlankExample(data,catalogItem.example));message.success('已补入空白示例字段');}});
 };
 const bindSource=()=>{
  const apply=()=>{onUpdate(bindTextSource(data,selectedTaskSource));message.success('已接入正文 text，原有其他输入保留');};
  if(data.inputs?.text!==undefined&&data.inputs.text!==''&&data.inputs.text!==selectedTaskSource)Modal.confirm({title:'替换当前正文来源？',content:'只更换正文 text，其他输入字段保持不变。',okText:'更换来源',cancelText:'取消',onOk:apply});else apply();
 };
 const inspect=async()=>{
  if(!data.mcpId)return;setMcpBusy(true);
  try{setMcpSchema(await research.inspectMcp(data.mcpId));}
  catch(error){message.error(errorText(error));}
  finally{setMcpBusy(false);}
 };
 const mapping=<InputMappingEditor value={data.inputs||{}} variables={variables} disabled={mutationDisabled} onChange={inputs=>onUpdate({inputs})}/>;
 const promptAlreadyContainsSource=promptSources.includes(selectedTaskSource);
 const sourceLabel=(source:string)=>variables.find(option=>option.value===source)?.label||source;
 return <aside className="research-config">
  <div className="node-config-heading"><div><span className="node-config-eyebrow">NODE SETTINGS</span><h3>节点设置 <Tag>{catalogItem.label}</Tag></h3></div></div>
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
     <section className="task-preset-block"><label>想让模型做什么？<Select aria-label="科研任务预设" value={promptPresetMatch?.preset.id??null} options={llmTaskPresets.map(preset=>({value:preset.id,label:preset.label}))} onChange={showPreset} placeholder="选一个预设，再按你的研究修改"/></label><p>{promptPresetMatch?.preset.guidance||'可直接编写任务；套用预设将替换下面的提示词。'}</p></section>
     <label>使用哪个模型？<span className="node-field-hint">{data.configId?'当前节点单独指定模型':'未单独指定时，沿用项目或全局默认设置'}</span></label>
     <ModelSelection configs={configs} value={effectiveModel} disabled={mutationDisabled} allowClear ariaLabel={`${data.label}模型`} onChange={choice=>onUpdate({configId:choice.configId,model:choice.model})}/>
     <label>模型收到的任务提示词 *<Input.TextArea aria-label="任务提示词" rows={7} value={data.prompt} onChange={event=>onUpdate({prompt:event.target.value})} placeholder="写明研究任务、输出要求。下一步可将资料插入这里。"/></label>
    </>}
    {kind==='input'&&<><label>固定任务内容（可选）<Input.TextArea aria-label="固定任务内容" rows={7} value={data.text} onChange={event=>onUpdate({text:event.target.value})} placeholder="写下研究目标与交付要求；也可使用每次运行时输入的内容。"/></label><Button size="small" onClick={()=>onUpdate({text:'{{input.text}}'})}>使用每次运行时填写的内容</Button></>}
    {kind==='pubmed'&&<><label>PubMed 检索式 *<Input.TextArea rows={3} value={data.query} onChange={event=>onUpdate({query:event.target.value})} placeholder="例如 sepsis AND lactate AND mortality"/></label><label>最多返回多少篇？<InputNumber min={1} max={100} value={data.limit||10} onChange={value=>onUpdate({limit:value||10})}/></label></>}
    {['python','r'].includes(kind)&&<><Alert type="info" message="此节点在本机执行脚本。运行前检查输入资料、操作范围和输出文件。"/><details className="custom-script-details" open={!data.script?.trim()}><summary>{kind==='python'?'Python':'R'} 脚本 · 查看或修改</summary><label>执行脚本 *<Input.TextArea rows={16} className="code-input" value={data.script} onChange={event=>onUpdate({script:event.target.value})} spellCheck={false}/></label></details><label>最长运行时间（秒）<InputNumber min={1} max={3600} value={data.timeout||120} onChange={value=>onUpdate({timeout:value||120})}/></label></>}
    {kind==='mcp'&&<section className="mcp-parameters"><label>MCP 工具 *<Select value={data.mcpId} options={mcpTools.filter(tool=>tool.enabled===1&&tool.transport==='stdio').map(tool=>({value:tool.id,label:`${tool.name} · ${tool.toolName}`}))} onChange={mcpId=>{onUpdate({mcpId});setMcpSchema(undefined);}} placeholder="先在项目或全局设置中启用工具"/></label><Button loading={mcpBusy} disabled={mutationDisabled||!data.mcpId} onClick={()=>void inspect()}>读取工具参数说明</Button>
     {inspected?<><div className="mcp-description"><strong>{inspected.name}</strong>{inspected.description&&<p>{inspected.description}</p>}</div><TypedParameters schema={inspected.inputSchema||{type:'object'}} value={args} disabled={mutationDisabled} onChange={next=>onUpdate({arguments:next})}/></>:mcpSchema?<Alert type="warning" message={`“${mcpConfig?.toolName||'所选工具'}”不在返回列表中`} description="已有参数保留，请检查工具配置。"/>:<><p className="node-field-hint">读取说明后，会显示必填参数与类型。已有参数可在下方修改。</p><StructuredFields value={args} label="已有参数" disabled={mutationDisabled} onChange={next=>onUpdate({arguments:next})}/></>}
     {!data.arguments&&<Button size="small" onClick={()=>onUpdate({arguments:{}})}>此工具无需参数，使用空参数表</Button>}
    </section>}
    {kind==='approve'&&<label>希望研究者确认什么？<Input.TextArea rows={5} value={data.question} onChange={event=>onUpdate({question:event.target.value})} placeholder="例如：核对纳排标准、主要结局及证据来源，批准后继续导出。"/></label>}
    {kind==='export'&&<label>要生成什么文件？<Select value={data.format||'docx'} options={['docx','pdf','md','txt'].map(value=>({value,label:value==='docx'?'Word（.docx）':value==='pdf'?'PDF':value.toUpperCase()}))} onChange={format=>onUpdate({format})}/></label>}
    {kind==='check'&&<><label>哪些输入不能为空？ *<Select mode="tags" value={data.requiredFields||[]} options={[...new Set(['text',...Object.keys(data.inputs||{})])].map(value=>({value,label:value==='text'?'正文（text）':value}))} placeholder="选择字段，也可输入自定义名称" onChange={requiredFields=>onUpdate({requiredFields})}/></label><p className="node-field-hint">下一步为同名字段接入资料；运行时逐项检查。</p></>}
    {['document','package'].includes(kind)&&<div className="node-step-note">{kind==='document'?'下一步选择要读取的项目文件。':'这个节点无需额外参数，会整理本次运行已有的成果与记录。'}</div>}
    <details className="node-guide"><summary>用途说明与配置示例</summary><p>{catalogItem.description}</p><ul>{guide.map(item=><li key={item}>{item}</li>)}</ul><label>这一步要做什么（可选）<Input.TextArea value={data.description} onChange={event=>onUpdate({description:event.target.value})} rows={2} placeholder={catalogItem.description}/></label>{Object.keys(catalogItem.example).length>0&&<div className="node-example-action"><Button size="small" onClick={fillExample}>补入空白示例字段</Button><span>已有内容保留</span></div>}</details>
    <Button block onClick={()=>setSection('inputs')}>下一步：接入研究资料 →</Button>
   </section>
   <section hidden={section!=='inputs'} className="node-mapping-section" aria-label="输入资料">
    <h4>这一步使用什么资料？</h4>
    {['document','export','python','r'].includes(kind)&&<label>{kind==='document'?'读取项目文件 *':kind==='export'?'原始 Word 文件（仅修订原文时选择）':'输入文件（可选）'}<Select aria-label="节点项目文件" allowClear value={data.fileId} options={project.files.map(file=>({label:file.name,value:file.id}))} onChange={onFileChange} placeholder={project.files.length?'选择已导入的资料':'先在项目左侧导入资料'}/></label>}
    {kind==='llm'?<>
     <label>将哪份资料交给模型？<Select aria-label="本任务资料来源" showSearch optionFilterProp="label" value={selectedTaskSource} options={taskSourceOptions} onChange={chooseTaskSource}/></label>
     <p className="node-field-hint">{promptPresetMatch?'预设已连接此来源，切换选项会同步更新任务提示词。':'选好来源后，点击下方按钮才会将资料插入任务提示词。'}</p>
     <Button block disabled={mutationDisabled||promptAlreadyContainsSource} onClick={()=>onUpdate({prompt:(data.prompt||'')+'\n\n参考资料：\n'+selectedTaskSource})}>{promptAlreadyContainsSource?'✓ 此来源已在提示词中':'将所选资料加入任务提示词'}</Button>
     <div className="node-source-preview"><strong>提示词已接入的资料</strong>{promptSources.length?<ul>{promptSources.map(source=><li key={source}>{sourceLabel(source)}</li>)}</ul>:<p>当前提示词未引用资料，只会发送任务文字。</p>}</div>
     <details className="node-advanced-inputs"><summary>其他输入字段（高级）</summary><p className="node-field-hint">映射仅保存在节点输入中。交给模型的材料以提示词中的引用为准。</p>{mapping}</details>
    </>:<>
     {['export','check','approve','python','r'].includes(kind)&&<section className="node-quick-source"><label>快速接入正文 text<Select aria-label="快速正文来源" showSearch optionFilterProp="label" value={selectedTaskSource} options={taskSourceOptions} onChange={setVariable}/></label><Button block onClick={bindSource} disabled={mutationDisabled||data.inputs?.text===selectedTaskSource}>{data.inputs?.text===selectedTaskSource?'✓ 已接入此正文':'接入所选正文'}</Button></section>}
     {kind==='export'&&<p className="node-field-hint">正文 text 用于新建报告。修订原 Word 时，还需在下方接入段落修改列表 patches。</p>}
     {['input','document','package','pubmed'].includes(kind)?<details className="node-advanced-inputs"><summary>其他输入字段（可选）</summary>{mapping}</details>:mapping}
    </>}
    {variables.length===1&&kind!=='input'&&<p className="node-field-hint">还没有连接上游节点。先在画布连线，再回这里选择来源。</p>}
    <Button block onClick={()=>setSection('outputs')}>下一步：查看输出与检查 →</Button>
   </section>
   <section hidden={section!=='outputs'} aria-label="输出与检查">
    <h4>配置检查</h4>
    {issues.length?<ul className="node-check-list">{issues.map(issue=><li key={issue.key}><WarningOutlined/><span>{issue.message}</span><Button size="small" type="link" onClick={()=>setSection(issue.section)}>去配置</Button></li>)}</ul>:<div className="node-step-note"><CheckCircleOutlined/> 主要配置已填写，可保存后在运行确认中核对实际材料与执行范围。</div>}
    <section className="node-output-section"><h4>完成后会得到什么？</h4><p>{outputPreviews[kind]}</p><div className="node-output-fields">{catalogItem.outputs.map(name=><div key={name}><strong>{outputFieldNames[name]||name}</strong><code>{name}</code></div>)}</div></section>
    <label>自定义输出字段（可选）<Select mode="tags" value={data.outputFields||[]} placeholder="例如 effect、confidence_interval" onChange={outputFields=>onUpdate({outputFields})}/><span className="node-field-hint">用于让下游节点方便选择；实际结果由脚本或工具生成。</span></label>
    {['python','r'].includes(kind)&&<details><summary>合成示例的输出</summary><ReadableValue value={{n:5,summary:{observed:4,missing:1,mean_observed:2.125},text:'合成示例数据：…'}}/></details>}
   </section>
  </fieldset>
  </ConfigProvider>
  <Divider/><Space wrap><Button icon={<CopyOutlined/>} disabled={mutationDisabled} onClick={onCopy}>复制</Button><Button disabled={mutationDisabled} onClick={onSaveTemplate}>存为模板</Button><Button danger icon={<DeleteOutlined/>} disabled={mutationDisabled} onClick={onDelete}>删除</Button></Space>
  {run&&<Button block disabled={mutationDisabled} onClick={onRerun}>从此节点创建重跑分支</Button>}
  <Divider/><h4>本节点运行摘要</h4>{selectedResult?<><Tag color={selectedResult.status==='SUCCESS'?'success':selectedResult.status==='FAILED'?'error':undefined}>{selectedResult.status==='SUCCESS'?'成功':selectedResult.status==='FAILED'?'失败':selectedResult.status}</Tag><p>{selectedResult.summary}</p></>:<p className="node-result-empty">{run?`运行 v${run.revision} 中暂无此节点结果。`:'运行后，这里显示实际结果摘要。'}</p>}
  <Button onClick={onPreview}>查看完整输入、输出与日志</Button>
 </aside>;
}
