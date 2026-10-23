import {useState} from 'react';
import {Button,Input,Select} from 'antd';
import {DeleteOutlined,PlusOutlined} from '@ant-design/icons';
import {removeRecordKey,renameRecordKey,setRecordValue,type ValueRecord} from './nodeFormLogic';
import {FieldNameInput,StructuredValue} from './StructuredFields';
import './StructuredFields.css';

export interface MappingOption {value:string;label:string}

export function InputMappingEditor({value,variables,onChange,disabled=false}:{value:ValueRecord;variables:MappingOption[];onChange:(value:ValueRecord)=>void;disabled?:boolean}){
  const [newKey,setNewKey]=useState('');
  const entries=Object.entries(value||{});
  return <div className="input-mapping-editor">
    <div className="input-mapping-heading"><strong>输入字段</strong><strong>资料来源或固定值</strong><span/></div>
    {entries.length?entries.map(([key,entry])=>{
      const isVariable=typeof entry==='string'&&/^\{\{[^{}]+\}\}$/.test(entry);
      const options=typeof entry==='string'&&isVariable&&!variables.some(variable=>variable.value===entry)?[{value:entry,label:`原有来源 · ${entry}`},...variables]:variables;
      return <div className="input-mapping-row" key={key}>
        <FieldNameInput ariaLabel="输入字段名称" value={key} disabled={disabled} onCommit={nextKey=>{if(Object.prototype.hasOwnProperty.call(value,nextKey))return false;onChange(renameRecordKey(value,key,nextKey));}}/>
        <div className="input-mapping-value">
          <Select aria-label={`${key} 的取值方式`} disabled={disabled} size="small" value={isVariable?'source':'fixed'} options={[{value:'source',label:'上游资料'},{value:'fixed',label:'固定值'}]} onChange={mode=>onChange(setRecordValue(value,key,mode==='source'?(variables[0]?.value||'{{input.text}}'):''))}/>
          {isVariable?<Select aria-label={`${key} 的资料来源`} disabled={disabled} showSearch optionFilterProp="label" size="small" value={entry} options={options} onChange={source=>onChange(setRecordValue(value,key,source))}/>:<StructuredValue value={entry} disabled={disabled} onChange={next=>onChange(setRecordValue(value,key,next))}/>}
        </div>
        <Button aria-label={`删除输入字段 ${key}`} disabled={disabled} size="small" type="text" danger icon={<DeleteOutlined/>} onClick={()=>onChange(removeRecordKey(value,key))}/>
      </div>;
    }):<p className="structured-empty">此节点暂未设置输入映射。选择上游资料，或添加一项固定值。</p>}
    <div className="input-mapping-add"><Input aria-label="新输入字段名称" disabled={disabled} size="small" value={newKey} onChange={event=>setNewKey(event.target.value)} onPressEnter={()=>{if(newKey.trim()&&!Object.prototype.hasOwnProperty.call(value,newKey.trim())){onChange(setRecordValue(value,newKey.trim(),''));setNewKey('');}}} placeholder="如 text、papers、source"/><Button disabled={disabled||!newKey.trim()||Object.prototype.hasOwnProperty.call(value,newKey.trim())} size="small" icon={<PlusOutlined/>} onClick={()=>{onChange(setRecordValue(value,newKey.trim(),''));setNewKey('');}}>添加输入行</Button></div>
  </div>;
}
