import type {AssistantDraft,ResearchNode} from './types';
import type {WorkflowDefinition} from './workflowReview';

export const nodeSessionPrefix=(nodeId:string)=>`节点 [${nodeId}] · `;
const storedData=(node:ResearchNode)=>Object.fromEntries(Object.entries(node.data).filter(([key,value])=>!['preview','runVisualState','onAppend'].includes(key)&&typeof value!=='function'));

export function nodeAssistantMaterial(workflow:WorkflowDefinition,nodeId:string){
 const node=workflow.nodes.find(item=>item.id===nodeId);
 if(!node)throw new Error('当前节点已不存在，请重新选择节点。');
 return JSON.stringify({focusNodeId:nodeId,currentNode:{id:node.id,data:storedData(node)},
  availableNodes:workflow.nodes.map(item=>({id:item.id,label:item.data.label,kind:item.data.kind,outputFields:item.data.outputFields})),
  connections:workflow.edges.map(({source,target})=>({source,target})),
 });
}

/** Only the reviewed node data and incident edges are loaded. Other work stays intact. */
export function scopedNodeDraft(current:WorkflowDefinition,draft:AssistantDraft,nodeId:string):AssistantDraft{
 const original=current.nodes.find(node=>node.id===nodeId),proposed=draft.nodes.find(node=>node.id===nodeId);
 if(!original||!proposed)throw new Error('草案必须保留当前节点 ID；如需重构或新增节点，请使用项目对话助手。');
 const nodeIds=new Set(current.nodes.map(node=>node.id));
 const incident=draft.edges.filter(edge=>edge.source===nodeId||edge.target===nodeId);
 if(incident.some(edge=>!nodeIds.has(edge.source)||!nodeIds.has(edge.target)))throw new Error('节点草案连接了尚不存在的节点，请在项目助手中创建所需节点后再连接。');
 const edges=[...current.edges.filter(edge=>edge.source!==nodeId&&edge.target!==nodeId),...incident];
 const pairs=new Set<string>(),ids=new Set<string>();
 for(const edge of edges){const pair=JSON.stringify([edge.source,edge.target]);if(pairs.has(pair)||ids.has(edge.id))throw new Error('草案包含重复连线或连线编号，请让助手修正。');pairs.add(pair);ids.add(edge.id);}
 const incoming=new Map(current.nodes.map(node=>[node.id,0]));
 for(const edge of edges)incoming.set(edge.target,(incoming.get(edge.target)||0)+1);
 const queue=current.nodes.filter(node=>incoming.get(node.id)===0).map(node=>node.id);
 for(let i=0;i<queue.length;i++)for(const edge of edges.filter(item=>item.source===queue[i])){incoming.set(edge.target,incoming.get(edge.target)!-1);if(incoming.get(edge.target)===0)queue.push(edge.target);}
 if(queue.length!==current.nodes.length)throw new Error('建议的连接形成循环，请让助手调整上下游关系。');
 return {...draft,...current,category:current.category||'',description:current.description||'',settings:current.settings,nodes:current.nodes.map(node=>node.id===nodeId?{...node,data:storedData(proposed) as ResearchNode['data']}:node),edges};
}
