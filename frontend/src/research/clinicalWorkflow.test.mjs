import test from 'node:test';
import assert from 'node:assert/strict';
import {autoBindSource,stepNumbers,togglePromptSource} from './sourceBindings.ts';
import {buildPubmedQuery} from './pubmedQuery.ts';
import {recordedReviewChecks} from './ApprovalReviewParser.ts';
const node=(id,data={})=>({id,data:{kind:'llm',label:id,...data}});

test('connecting a first source binds text and preserves later intentional choices',()=>{
 const a=node('a'),b=node('b',{prompt:'研究任务 {{input.text}}',inputs:{metadata:7}});
 const bound=autoBindSource(a,b);
 assert.equal(bound.prompt,'研究任务 {{a.text}}');assert.equal(bound.inputs.metadata,7);
 assert.equal(autoBindSource(node('c'),{...b,data:bound}),bound);
 const code=node('analysis',{kind:'python',analysisPreset:'quality'});
 assert.equal(autoBindSource(node('table',{kind:'document'}),code).inputs.dataPath,'{{table.dataPath}}');
});
test('source toggles preserve surrounding task text and bind a source only once',()=>{
 const text='证据：{{ a.text }}\n结论：{{b.text}}';
 assert.equal(togglePromptSource(text,'{{a.text}}',true),text);
 assert.equal(togglePromptSource(text,'{{a.text}}',false),'证据：\n结论：{{b.text}}');
});
test('step ordering follows edges even if nodes were saved in a different order',()=>{
 const numbers=stepNumbers([node('c'),node('b'),node('a')],[{source:'a',target:'b'},{source:'b',target:'c'}]);
 assert.deepEqual([...numbers],[['a',1],['b',2],['c',3]]);
});
test('PubMed concepts combine synonyms, year boundaries and study filters',()=>{
 const query=buildPubmedQuery({population:'heat stroke, heatstroke',exposure:'cooling',years:5,types:['rct','cohort']},new Date(2026,10,10));
 assert.match(query,/"heat stroke"\[Title\/Abstract\] OR "heatstroke"/);
 assert.match(query,/2022\/01\/01/);assert.match(query,/2026\/11\/10/);
 assert.match(query,/Randomized Controlled Trial\[Publication Type\] OR cohort/);
 assert.equal(buildPubmedQuery({years:5}), '');
});

test('completed review shows only the latest checks for the matching node',()=>{
 const history=[
  {nodeId:'confirm',approved:true,checkedItems:['定义','缺失','旧项目']},
  {nodeId:'other',approved:true,checkedItems:['定义']},
  {action:'stop'},
 ];
 assert.deepEqual(recordedReviewChecks(history,'confirm',['定义','缺失']),['定义','缺失']);
 assert.deepEqual(recordedReviewChecks(history,'other',['定义','缺失']),['定义']);
 assert.deepEqual(recordedReviewChecks(history,'new',['定义']),[]);
 assert.deepEqual(recordedReviewChecks(history,undefined,['定义']),[]);
 assert.deepEqual(recordedReviewChecks([...history,{nodeId:'confirm',approved:false}],'confirm',['定义']),[]);
 assert.deepEqual(recordedReviewChecks({nodeId:'confirm',approved:true},'confirm',['定义']),[]);
 assert.deepEqual(history[0].checkedItems,['定义','缺失','旧项目']);
});
