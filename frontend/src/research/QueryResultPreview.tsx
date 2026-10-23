import {Empty,Table,Tag} from 'antd';
import {queryPreviews} from './queryPreview';
import './QueryResultPreview.css';

export default function QueryResultPreview({value}:{value:unknown}){
 const results=queryPreviews(value);
 if(!results.length)return null;
 const cell=(value:unknown)=>value===null?<span className="query-null">空值</span>:value===''?<span className="query-null">空字符串</span>:typeof value==='object'?JSON.stringify(value):String(value);
 return <section className="query-result-preview" aria-label="数据提取结果预览"><h3>结果预览</h3>
  {results.map((result,index)=><section className="query-preview-item" key={`${result.name}-${index}`}>
   <header><strong>{result.name}</strong><Tag>{result.port}/{result.database}</Tag><span>返回 {result.returned_rows.toLocaleString()} 行 · 预览 {result.rows.length} 行</span>{result.truncated&&<Tag color="warning">已达 {result.max_rows?.toLocaleString()||'查询'} 行上限</Tag>}</header>
   <Table size="small" bordered pagination={false} scroll={{x:'max-content',y:280}} locale={{emptyText:<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="查询完成，符合条件的记录为 0 行"/>}}
    columns={result.columns.map((name,index)=>({key:String(index),dataIndex:String(index),title:name,render:cell}))}
    dataSource={result.rows.map((row,index)=>({key:String(index),...Object.fromEntries(row.map((value,column)=>[String(column),value]))}))}/>
  </section>)}<p>此处展示各查询前 20 行；完整结果可在下方下载 CSV 或 JSONL。</p>
 </section>;
}
