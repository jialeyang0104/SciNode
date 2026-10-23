import {useEffect,useRef,useState} from 'react';
import {Alert,Button,Select,Spin} from 'antd';
import {ReloadOutlined} from '@ant-design/icons';
import type {LLMGlobalConfig} from '../api/llmConfig';
import {research,errorText} from './api';

export interface ModelChoice {configId?:number;model?:string}
interface Props {configs:LLMGlobalConfig[];value:ModelChoice;onChange:(value:ModelChoice)=>void;disabled?:boolean;stacked?:boolean;allowClear?:boolean;ariaLabel?:string}

export default function ModelSelection({configs,value,onChange,disabled=false,stacked=false,allowClear=false,ariaLabel='模型'}:Props){
 const [models,setModels]=useState<string[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[inventoryLoaded,setInventoryLoaded]=useState(false);
 const request=useRef(0),selectedConfig=configs.find(config=>config.id===value.configId);
 const load=async(configId:number,refresh=false)=>{
  const token=++request.current;setLoading(true);setError('');
  try{const inventory=await research.modelInventory(configId,refresh);if(token===request.current){setModels(inventory.models);setInventoryLoaded(true);}}
  catch(reason){if(token===request.current){setModels([]);setInventoryLoaded(false);setError(errorText(reason));}}
  finally{if(token===request.current)setLoading(false);}
 };
 useEffect(()=>{if(value.configId&&selectedConfig)void load(value.configId,false);else{request.current++;setModels([]);setInventoryLoaded(false);setLoading(false);setError('');}return()=>{request.current++;};},[value.configId,selectedConfig?.id]);
 const selectedModel=value.model||selectedConfig?.model||'';
 const modelMissing=!!selectedModel&&inventoryLoaded&&!models.includes(selectedModel);
 const options=Array.from(new Set([...(selectedModel?[selectedModel]:[]),...models])).map(model=>({value:model,label:model===selectedModel&&modelMissing?model+'（未在库存中）':model,disabled:model===selectedModel&&modelMissing}));
 return <div className={stacked?'model-selection model-selection-stacked':'model-selection'} aria-label={ariaLabel}>
  <Select aria-label={`${ariaLabel}服务配置`} allowClear={allowClear} value={value.configId} disabled={disabled} placeholder="选择服务配置" showSearch optionFilterProp="label" options={configs.map(config=>({value:config.id,label:config.configName}))} onChange={configId=>{const config=configs.find(item=>item.id===configId);onChange(config?{configId,model:config.model}:{});if(!config){request.current++;setModels([]);setInventoryLoaded(false);setError('');}}}/>
  <Select aria-label={`${ariaLabel}模型`} value={selectedModel||undefined} disabled={disabled||!value.configId||loading||(!models.length&&!selectedModel)} placeholder={loading?'正在读取模型…':'选择具体模型'} showSearch optionFilterProp="label" options={options} onChange={model=>onChange({...value,model})} notFoundContent={loading?<Spin size="small"/>:'未读取到模型'}/>
  <Button aria-label="刷新模型列表" title="刷新实际模型列表" icon={<ReloadOutlined/>} disabled={disabled||!value.configId} loading={loading} onClick={()=>value.configId&&void load(value.configId,true)}/>
  {modelMissing&&<Alert className="model-selection-error" type="warning" showIcon message={`已保存的模型“${selectedModel}”未在当前服务库存中，请重新选择模型。`}/>}
  {error&&<Alert className="model-selection-error" type="error" showIcon message="模型列表读取失败" description={error}/>}
 </div>;
}
