import type {ResearchData,ResearchNode} from './types';
import type {Edge} from '@xyflow/react';

export const references=(prompt='')=>Array.from(new Set(prompt.match(/\{\{\s*[\w.-]+\s*}}/g)||[]));
export function togglePromptSource(prompt:string,source:string,checked:boolean){
 if(checked)return references(prompt).some(value=>value.replace(/\s/g,'')===source)?prompt:`${prompt}\n\n参考资料：\n${source}`;
 return prompt.replace(/\{\{\s*[\w.-]+\s*}}/g,value=>value.replace(/\s/g,'')===source?'':value);
}

/** Bind only an unconfigured primary input; preserve intentional selections. */
export function autoBindSource(source:ResearchNode,target:ResearchNode):ResearchData{
 const data=target.data,ref=`{{${source.id}.text}}`;
 if(data.kind==='input'||['document','pubmed','package','mcp'].includes(data.kind))return data;
 if(data.analysisPreset&&source.data.kind==='document'&&!data.fileId&&!data.inputs?.dataPath)return {...data,inputs:{...data.inputs,dataPath:`{{${source.id}.dataPath}}`,sheet:`{{${source.id}.sheet}}`}};
 if(data.inputs?.text)return data;
 if(data.kind==='llm'){
  if(references(data.prompt).some(value=>value.replace(/\s/g,'')!=='{{input.text}}'))return data;
  const prompt=(data.prompt||'').includes('{{input.text}}')?(data.prompt||'').split('{{input.text}}').join(ref):togglePromptSource(data.prompt||'',ref,true);
  return {...data,prompt,inputs:{...data.inputs,text:ref}};
 }
 return {...data,inputs:{...data.inputs,text:ref}};
}

export function stepNumbers(nodes:ResearchNode[],edges:Edge[]):Map<string,number>{
 const pending=new Map(nodes.map(node=>[node.id,0]));
 edges.forEach(edge=>{if(pending.has(edge.source)&&pending.has(edge.target))pending.set(edge.target,(pending.get(edge.target)||0)+1);});
 const queue=nodes.filter(node=>pending.get(node.id)===0).map(node=>node.id),order=new Map<string,number>();
 while(queue.length){const id=queue.shift()!;order.set(id,order.size+1);for(const edge of edges.filter(edge=>edge.source===id)){const count=(pending.get(edge.target)||0)-1;pending.set(edge.target,count);if(count===0)queue.push(edge.target);}}
 return order;
}
