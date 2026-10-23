import {Tag} from 'antd';
import {catalog} from './catalog';
import type {AssistantDraft} from './types';
import {ReadableValue} from './StructuredFields';
import {compareWorkflow,type FieldChange,type WorkflowDefinition} from './workflowReview';

function FieldDifference({change}:{change:FieldChange}){
 return <details className="pa-field-difference"><summary>{change.label}</summary><div className="pa-before-after"><div><strong>原配置</strong><ReadableValue value={change.before} emptyLabel="未设置" compact/></div><div><strong>草案配置</strong><ReadableValue value={change.after} emptyLabel="未设置" compact/></div></div></details>;
}

export default function WorkflowChangePreview({previous,draft,expanded=false}:{previous?:WorkflowDefinition;draft:AssistantDraft;expanded?:boolean}){
 const changes=compareWorkflow(previous,draft);
 const nodes=new Map([...(previous?.nodes||[]),...draft.nodes].map(node=>[node.id,node]));
 const relation=(edge:AssistantDraft['edges'][number])=>`${nodes.get(edge.source)?.data.label||edge.source} → ${nodes.get(edge.target)?.data.label||edge.target}`;
 return <div className="pa-workflow-changes" aria-label="草案逐项变更">
  <div className="pa-change-counts">{!previous?<Tag color="blue">新建 {draft.nodes.length} 个节点</Tag>:<>
   {!!changes.added.length&&<Tag color="green">新增 {changes.added.length}</Tag>}{!!changes.changed.length&&<Tag color="blue">修改 {changes.changed.length}</Tag>}{!!changes.removed.length&&<Tag color="red">删除 {changes.removed.length}</Tag>}{!!changes.moved.length&&<Tag>排布 {changes.moved.length}</Tag>}
   {!changes.hasChanges&&<span>与当前工作区配置一致</span>}
  </>}{(!!changes.addedEdges.length||!!changes.removedEdges.length)&&<Tag>连线 +{changes.addedEdges.length} / −{changes.removedEdges.length}</Tag>}{!!changes.metadata.length&&<Tag>项目信息 {changes.metadata.length} 项</Tag>}</div>
  {changes.hasChanges&&<details className="pa-change-details" open={expanded}><summary>查看逐项变更</summary>
   {changes.metadata.map(change=><FieldDifference key={change.key} change={change}/>)}
   {changes.added.map(node=><div className="pa-change-entry" key={`add-${node.id}`}><Tag color="green">新增</Tag><span>{node.data.label} · {catalog[node.data.kind]?.label||node.data.kind}</span></div>)}
   {changes.removed.map(node=><div className="pa-change-entry" key={`remove-${node.id}`}><Tag color="red">删除</Tag><span>{node.data.label}</span></div>)}
   {changes.changed.map(({node,fields})=><section className="pa-change-node" key={node.id}><strong>{node.data.label}</strong>{fields.map(change=><FieldDifference key={change.key} change={change}/>)}</section>)}
   {changes.moved.length>0&&<p className="pa-change-layout">调整排布：{changes.moved.map(node=>node.data.label).join('、')}</p>}
   {changes.removedEdges.map(edge=><div className="pa-change-entry" key={`unlink-${edge.id}`}><Tag color="red">断开</Tag><span>{relation(edge)}</span></div>)}
   {changes.addedEdges.map(edge=><div className="pa-change-entry" key={`link-${edge.id}`}><Tag color="green">连接</Tag><span>{relation(edge)}</span></div>)}
  </details>}
 </div>;
}
