import {useEffect,useState} from 'react';
import {Alert,Button,Space,Tag} from 'antd';
import {DownloadOutlined} from '@ant-design/icons';
import type {Artifact,ResearchNode,Run} from './types';
import {research,errorText} from './api';
import MarkdownPreview from './MarkdownPreview';
import QueryResultPreview from './QueryResultPreview';
import {ReadableValue} from './StructuredFields';
import {nodeResultSummary} from './runPresentation.mjs';

type FileAction=(run:Run,index:number)=>void;
const previewable=(name:string)=>/\.(png|jpe?g|gif|webp|pdf|txt|md|json|csv|log|py|r)$/i.test(name);
const role=(artifact:Artifact)=>artifact.role||(/\.log$/i.test(artifact.name)?'log':artifact.name==='manifest.json'?'provenance':'result');

function ArtifactImage({run,index}:{run:Run;index:number}){
 const [url,setUrl]=useState(''),[error,setError]=useState('');
 useEffect(()=>{let current=true,objectUrl='';setUrl('');setError('');
  research.blob(run,index).then(blob=>{if(current){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}}).catch(error=>{if(current)setError(errorText(error));});
  return()=>{current=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[run,index]);
 return error?<Alert type="error" message="图表读取失败" description={error}/>:url?<img src={url} alt={run.artifacts[index].name}/>:<p>正在载入图表…</p>;
}

export function TaskFiles({run,nodeId,onPreview,onDownload}:{run:Run;nodeId?:string;onPreview:FileAction;onDownload:FileAction}){
 const entries=run.artifacts.map((artifact,index)=>({artifact,index})).filter(({artifact})=>!nodeId||artifact.nodeId===nodeId);
 const list=(category:string)=>entries.filter(({artifact})=>role(artifact)===category).map(({artifact,index})=><div className="task-file-row" key={index}>
  <span>{artifact.relativePath?.replace(/^tasks\/[^/]+\//,'')||artifact.name}</span><Space>{previewable(artifact.name)&&<Button size="small" onClick={()=>onPreview(run,index)}>预览</Button>}<Button size="small" icon={<DownloadOutlined/>} onClick={()=>onDownload(run,index)}>下载</Button></Space>
 </div>);
 return <div className="node-task-files">
  {list('result')}
  {[['code','执行代码'],['provenance','任务说明、输入与复现配置'],['log','运行日志']].map(([key,label])=>{const content=list(key);return content.length?<details className="artifact-group" key={key}><summary>{label} · {content.length} 个文件</summary>{content}</details>:null;})}
  <details><summary>文件来源与校验记录</summary><ReadableValue value={entries.map(({artifact})=>artifact)}/></details>
  {!entries.length&&<p>此任务暂无文件。</p>}
 </div>;
}

export function RunTaskFiles({run,onPreview,onDownload}:{run:Run;onPreview:FileAction;onDownload:FileAction}){
 const ids=[...new Set(run.artifacts.map(artifact=>artifact.nodeId))];
 return <>{ids.map(id=><details className="artifact-group" key={id} open={run.definition.nodes.find(node=>node.id===id)?.data.kind==='package'}><summary>{run.definition.nodes.find(node=>node.id===id)?.data.label||id} · {run.artifacts.filter(artifact=>artifact.nodeId===id).length} 个文件</summary><TaskFiles run={run} nodeId={id} onPreview={onPreview} onDownload={onDownload}/></details>)}</>;
}

export default function TaskResults({run,node,onPreview,onDownload}:{run:Run|null;node?:ResearchNode;onPreview:FileAction;onDownload:FileAction}){
 const result=node&&run?.nodeResults[node.id],output=result?.output;
 return <>
  {result?.error&&<Alert type="error" showIcon message="本任务执行失败" description={result.error}/>}
  <div className="node-result-content">
   {typeof output?.text==='string'?<MarkdownPreview text={output.text}/>:<p>{nodeResultSummary(result,run?'此节点尚无结果。':'保存后运行，查看实际结果。')}</p>}
   <QueryResultPreview value={output?.preview}/>
   {run&&node&&<div className="node-result-figures">{run.artifacts.map((artifact,index)=>({artifact,index})).filter(({artifact})=>artifact.nodeId===node.id&&/\.png$/i.test(artifact.name)).map(({index})=><ArtifactImage key={index} run={run} index={index}/>)}</div>}
  </div>
  {run&&node&&<TaskFiles run={run} nodeId={node.id} onPreview={onPreview} onDownload={onDownload}/>}
  <details><summary>数据溯源与技术审计日志</summary>
   {node&&<><Tag>当次任务配置</Tag><ReadableValue value={node.data}/></>}
   <h4>实际输入</h4><ReadableValue value={result?.input}/><h4>完整输出与日志</h4><ReadableValue value={output}/>
   {result?.sentPreview&&<><h4>实际发送预览 · {result.sentCharacters} 字符（显示前 2,000 字符）</h4><pre>{result.sentPreview}</pre></>}
  </details>
 </>;
}
