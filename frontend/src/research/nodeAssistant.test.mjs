import test from 'node:test';
import assert from 'node:assert/strict';
import {nodeAssistantMaterial,nodeSessionPrefix,scopedNodeDraft} from './nodeAssistant.ts';
const node=(id,extra={})=>({id,type:'research',position:{x:10,y:20},data:{kind:'llm',label:id,prompt:'研究 '+id,...extra}});
const edge=(source,target,id=source+'-'+target)=>({id,source,target});
const current=()=>({name:'未保存项目名',category:'数据分析',description:'待保存介绍',clinicalData:true,settings:{agentRules:'本地规则'},nodes:[node('a'),node('b',{prompt:'未保存提示词'}),node('c')],edges:[edge('a','b'),edge('b','c')]});

test('node material uses the working node and live graph, not a saved snapshot or runtime decorations',()=>{
 const workflow=current();workflow.nodes[1].data.preview={summary:'运行机密'};workflow.nodes[1].data.onAppend=()=>{};
 const material=JSON.parse(nodeAssistantMaterial(workflow,'b'));
 assert.equal(material.currentNode.data.prompt,'未保存提示词');assert.equal(material.currentNode.data.preview,undefined);
 assert.deepEqual(material.connections,[{source:'a',target:'b'},{source:'b',target:'c'}]);
 assert.equal(material.availableNodes.length,3);assert.match(nodeSessionPrefix('b'),/\[b\]/);
 assert.throws(()=>nodeAssistantMaterial(workflow,'gone'),/不存在/);
});

test('scoped application preserves other unsaved nodes, metadata, layout, and unrelated edges',()=>{
 const base=current();base.edges=[edge('a','c'),edge('a','b')];
 const proposal={...current(),name:'模型新名称',category:'别的分类',clinicalData:false,settings:undefined,nodes:[node('a',{prompt:'不应覆盖'}),{...node('b',{prompt:'新任务',preview:{text:'不存'}}),position:{x:999,y:999}},node('c'),node('new')],edges:[edge('b','c')]};
 const result=scopedNodeDraft(base,proposal,'b');
 assert.equal(result.name,base.name);assert.deepEqual(result.settings,base.settings);assert.equal(result.clinicalData,true);
 assert.equal(result.nodes.length,3);assert.equal(result.nodes[0],base.nodes[0]);assert.equal(result.nodes[1].data.prompt,'新任务');assert.equal(result.nodes[1].data.preview,undefined);
 assert.deepEqual(result.nodes[1].position,{x:10,y:20});assert.deepEqual(result.edges,[edge('a','c'),edge('b','c')]);
 assert.equal(base.nodes[1].data.prompt,'未保存提示词');
 const noSettings={...base,settings:undefined};assert.equal(scopedNodeDraft(noSettings,{...proposal,settings:{agentRules:'错误范围'}},'b').settings,undefined);
});

test('rejects deleted focus, nonexistent endpoints, duplicate edges and cyclic proposals',()=>{
 const base=current();
 assert.throws(()=>scopedNodeDraft(base,{...base,nodes:base.nodes.filter(n=>n.id!=='b')},'b'),/保留当前节点/);
 assert.throws(()=>scopedNodeDraft(base,{...base,edges:[edge('b','missing')]},'b'),/不存在/);
 assert.throws(()=>scopedNodeDraft(base,{...base,edges:[edge('a','b'),edge('a','b','second')]},'b'),/重复/);
 assert.throws(()=>scopedNodeDraft(base,{...base,edges:[edge('b','b')]},'b'),/循环/);
 const chain={...base,edges:[edge('a','c')]};
 assert.throws(()=>scopedNodeDraft(chain,{...base,edges:[edge('c','b'),edge('b','a')]},'b'),/循环/);
});
