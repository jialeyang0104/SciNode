import {Checkbox,Input,Tag} from 'antd';
import {FileTextOutlined} from '@ant-design/icons';
import type {ResearchData} from './types';
import type {MappingOption} from './InputMappingEditor';
import {references,togglePromptSource} from './sourceBindings';

export function SourceCards({data,variables,onChange}:{data:ResearchData;variables:MappingOption[];onChange:(data:Partial<ResearchData>)=>void}){
 const options=variables.filter(option=>option.value.endsWith('.text}}'));
 const sources=references(data.prompt).map(value=>value.replace(/\s/g,''));
 return <div className="source-cards" aria-label="已连接的资料">
  {options.map(option=>{const checked=data.kind==='llm'?sources.includes(option.value):data.inputs?.text===option.value;
   return <Checkbox className={`source-card ${checked?'source-selected':''}`} key={option.value} checked={checked} onChange={event=>{
    if(data.kind==='llm'){
     const inputs={...data.inputs};if(!event.target.checked&&inputs.text===option.value)delete inputs.text;
     onChange({prompt:togglePromptSource(data.prompt||'',option.value,event.target.checked),inputs});
    }else onChange({inputs:{...data.inputs,text:event.target.checked?option.value:undefined}});
   }}><FileTextOutlined aria-hidden/><span>{option.label}</span></Checkbox>;})}
  <p className="node-field-hint">{data.kind==='llm'?'勾选即加入任务，可同时选择多份资料。':'选择本任务使用的正文。统计数据表在任务设置中选择。'}</p>
 </div>;
}

export function PromptEditor({value,variables,onChange}:{value:string;variables:MappingOption[];onChange:(value:string)=>void}){
 const parts=value.split(/(\{\{\s*[\w.-]+\s*}})/g);
 return <div className="prompt-editor" aria-label="任务说明与资料">
  {parts.map((part,index)=>index%2===1?<Tag key={index} icon={<FileTextOutlined/>} color="blue">{variables.find(option=>option.value===part.replace(/\s/g,''))?.label||'待连接的资料'}</Tag>:
   <Input.TextArea key={index} aria-label={`任务说明 ${Math.floor(index/2)+1}`} autoSize={{minRows:part?2:1,maxRows:8}} value={part} onChange={event=>onChange(parts.map((value,i)=>i===index?event.target.value:value).join(''))} placeholder="写明任务要求；在“输入资料”中勾选材料"/>)}
 </div>;
}
