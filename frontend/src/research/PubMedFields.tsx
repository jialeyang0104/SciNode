import {Input,InputNumber,Select} from 'antd';
import type {PubmedSearch,ResearchData} from './types';
import {buildPubmedQuery} from './pubmedQuery';

export default function PubMedFields({data,onChange}:{data:ResearchData;onChange:(data:Partial<ResearchData>)=>void}){
 const search=data.pubmedSearch||{};
 const update=(patch:Partial<PubmedSearch>)=>{const pubmedSearch={...search,...patch};onChange({pubmedSearch,query:buildPubmedQuery(pubmedSearch)});};
 return <section aria-label="医学检索式助手">
  <p className="node-field-hint">输入英文医学词；同义词用逗号分隔。助手按标题/摘要组合检索，可在下方核对或补充 MeSH 词。</p>
  <label>疾病 / 人群<Input aria-label="疾病 / 人群" value={search.population} placeholder="heat stroke, heatstroke" onChange={event=>update({population:event.target.value})}/></label>
  <label>干预 / 暴露<Input aria-label="干预 / 暴露" value={search.exposure} onChange={event=>update({exposure:event.target.value})}/></label>
  <label>结局（可选）<Input aria-label="检索结局" value={search.outcome} onChange={event=>update({outcome:event.target.value})}/></label>
  <label>发表范围<Select aria-label="发表范围" allowClear value={search.years} placeholder="全部年份" options={[3,5,10].map(value=>({value,label:`最近 ${value} 个日历年`}))} onChange={years=>update({years})}/></label>
  <label>研究类型<Select aria-label="研究类型" mode="multiple" value={search.types||[]} options={[{value:'rct',label:'随机试验'},{value:'cohort',label:'队列研究关键词'},{value:'meta',label:'Meta 分析'},{value:'review',label:'综述'}]} onChange={types=>update({types})}/></label>
  <label>最多获取篇数<InputNumber aria-label="最多获取篇数" min={1} max={100} value={data.limit||10} onChange={value=>onChange({limit:value||10})}/></label>
  <details open={!data.pubmedSearch}><summary>查看 / 自定义完整检索式</summary><Input.TextArea aria-label="完整 PubMed 检索式" rows={4} value={data.query} onChange={event=>onChange({query:event.target.value,pubmedSearch:undefined})}/><p>自定义检索式会保留；再次填写助手条件将重新生成检索式。</p></details>
 </section>;
}
