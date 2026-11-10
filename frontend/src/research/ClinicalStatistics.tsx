import {useEffect,useState} from 'react';
import {Alert,Input,InputNumber,Radio,Select,Spin,Table,Tag} from 'antd';
import type {AnalysisConfig,Project,ResearchData,TableInspection} from './types';
import {research,errorText} from './api';
import {statisticPresets} from './clinicalCatalog';
import QueryResultPreview from './QueryResultPreview';

function tableFileId(project:Project,data:ResearchData):string|undefined{
 if(data.fileId)return data.fileId;
 const source=typeof data.inputs?.dataPath==='string'?/^\{\{([\w-]+)\.dataPath}}$/.exec(data.inputs.dataPath)?.[1]:undefined;
 return project.nodes.find(node=>node.id===source)?.data.fileId;
}
function useInspection(project:Project,data:ResearchData){
 const sourceId=typeof data.inputs?.dataPath==='string'?/^\{\{([\w-]+)\.dataPath}}$/.exec(data.inputs.dataPath)?.[1]:undefined;
 const fileId=tableFileId(project,data),sheet=data.analysis?.sheet||data.sheet||(!data.fileId?project.nodes.find(node=>node.id===sourceId)?.data.sheet:undefined);
 const [inspection,setInspection]=useState<TableInspection>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{
  let current=true;setInspection(undefined);setError('');
  const file=project.files.find(file=>file.id===fileId);
  if(!fileId||!file||!/\.(csv|xlsx)$/i.test(file.name)){setBusy(false);return;}
  setBusy(true);
  research.tablePreview(project.id,fileId,sheet).then(value=>{if(current)setInspection(value);}).catch(error=>{if(current)setError(errorText(error));}).finally(()=>{if(current)setBusy(false);});
  return()=>{current=false;};
 },[fileId,sheet,project.id,project.files]);
 return {inspection,error,busy,fileId,sheet};
}
function Inspection({value}:{value:TableInspection}){
 return <details className="table-inspection"><summary>查看列名与数据 · {value.n.toLocaleString()} 行 / {value.columns.length} 列</summary>
  <Table size="small" rowKey="name" pagination={{pageSize:8,hideOnSinglePage:true}} scroll={{x:'max-content'}} dataSource={value.columns} columns={[
   {title:'列名',dataIndex:'name'},{title:'类型',dataIndex:'type'},{title:'非空',dataIndex:'nonNull'},{title:'缺失',dataIndex:'missing'},
   {title:'本地示例',dataIndex:'examples',render:(examples:unknown[])=>examples.map(String).join('、')},
  ]}/><QueryResultPreview value={value.preview}/>
 </details>;
}
export function TableFilePreview({project,data}:{project:Project;data:ResearchData}){
 const {inspection,error,busy}=useInspection(project,data);
 return <>{busy&&<Spin tip="读取本地表格"><div style={{minHeight:60}}/></Spin>}{error&&<Alert type="error" showIcon message="数据表预览失败" description={error}/>} {inspection&&<Inspection value={inspection}/>}</>;
}

export default function ClinicalStatistics({project,data,onChange}:{project:Project;data:ResearchData;onChange:(patch:Partial<ResearchData>)=>void}){
 const {inspection,error,busy,fileId,sheet}=useInspection(project,data);
 const config=data.analysis||{},preset=data.analysisPreset||'quality';
 const update=(patch:Partial<AnalysisConfig>)=>onChange({analysis:{...config,...patch}});
 const options=inspection?.columns.map(column=>({value:column.name,label:`${column.name} · ${column.type}`}))||[];
 const select=(key:keyof AnalysisConfig,label:string,multiple=false,choices=options)=><label>{label}<Select aria-label={label} mode={multiple?'multiple':undefined} allowClear showSearch optionFilterProp="label" loading={busy} options={choices} value={config[key] as string|string[]|undefined} onChange={value=>update({[key]:value})} placeholder={options.length?'选择实际列名':'先选择或接入数据表'}/></label>;
 const modeling=preset==='regression'||preset==='prediction';
 return <section className="clinical-statistics" aria-label="临床统计向导">
  <Radio.Group className="statistics-presets" value={preset} onChange={event=>onChange({analysisPreset:event.target.value})}>
   {statisticPresets.map(item=><Radio.Button key={item.value} value={item.value}><strong>{item.label}</strong><small>{item.description}</small></Radio.Button>)}
  </Radio.Group>
  <label>分析数据表<Select aria-label="分析数据表" value={fileId} placeholder="在左侧导入 CSV / Excel 后选择" options={project.files.filter(file=>/\.(csv|xlsx)$/i.test(file.name)).map(file=>({value:file.id,label:file.name}))} onChange={fileId=>{const inputs={...data.inputs};delete inputs.dataPath;delete inputs.sheet;onChange({fileId,inputs});}}/></label>
  {fileId&&project.files.find(file=>file.id===fileId)?.name.toLowerCase().endsWith('.xlsx')&&<label>工作表名称（留空沿用上游或读取第一张）<Input aria-label="工作表名称" placeholder={sheet?`当前读取：${sheet}`:'第一张工作表'} onBlur={event=>{if(event.target.value!==config.sheet)update({sheet:event.target.value});}} key={fileId} defaultValue={config.sheet}/><span className="node-field-hint">当前读取：{sheet||'第一张工作表'}</span></label>}
  {error&&<Alert type="error" showIcon message="数据表读取失败" description={error}/>}
  {preset==='quality'&&select('idColumn','患者 ID 列（用于重复与缺失检查）')}
  {preset==='table1'&&<>{select('group','分组变量（可选）')}{select('continuous','连续变量',true)}{select('categorical','分类变量',true)}<label>连续变量展示<Select aria-label="连续变量展示" value={config.continuousFormat||'auto'} options={[{value:'auto',label:'按组内分布自动判断'},{value:'mean',label:'均值 ± 标准差'},{value:'median',label:'中位数 [Q1, Q3]'}]} onChange={continuousFormat=>update({continuousFormat})}/></label></>}
  {preset==='regression'&&<label>分析方法<Select aria-label="分析方法" value={config.method||'logistic'} options={[{value:'logistic',label:'Logistic · 二分类结局（OR）'},{value:'cox',label:'Cox · 生存结局（HR）'}]} onChange={method=>update({method})}/></label>}
  {(modeling||preset==='km')&&<>{select('outcome','结局 / 事件状态列')}<label>代表事件发生的取值<Input aria-label="代表事件发生的取值" value={config.eventValue??'1'} onChange={event=>update({eventValue:event.target.value})}/></label></>}
  {(preset==='km'||preset==='regression'&&config.method==='cox')&&<>{select('time','随访时间列')}<label>随访时间单位<Select aria-label="随访时间单位" value={config.timeUnit||'days'} options={['days','months','years'].map(value=>({value,label:({days:'天',months:'月',years:'年'})[value]}))} onChange={timeUnit=>update({timeUnit})}/></label></>}
  {preset==='km'&&select('group','生存曲线分组列')}
  {modeling&&<>{select('covariates',preset==='prediction'?'预先指定的预测因子':'暴露 / 自变量与协变量',true)}{select('categorical','其中的分类变量',true,options.filter(option=>config.covariates?.includes(option.value)))}</>}
  {preset==='prediction'&&<>{select('idColumn','唯一患者 ID 列（每人一行）')}<label>验证集比例<InputNumber aria-label="验证集比例" min={.2} max={.5} step={.05} value={config.testFraction??.25} onChange={value=>update({testFraction:value??.25})}/></label><label>随机种子<InputNumber aria-label="随机种子" min={0} max={2147483647} value={config.seed??2026} onChange={value=>update({seed:value??2026})}/></label><p className="node-field-hint">先划分训练/验证集；插补、标准化和编码仅在训练集拟合，报告内部留出验证结果。</p></>}
  {(preset==='regression'||preset==='km')&&<p className="node-field-hint">使用所选变量的完整病例，报告因缺失排除人数。事件列须有两个取值。</p>}
  <Tag>内置 Python 统计流程 · 代码与依赖随任务保存</Tag>
  {inspection&&<Inspection value={inspection}/>}
 </section>;
}
