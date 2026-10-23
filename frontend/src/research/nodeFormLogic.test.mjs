import assert from 'node:assert/strict';
import test from 'node:test';
import {applyPromptPreset,defaultForSchema,fillBlankExample,findPromptPresetMatch,hasUnsupportedSchema,removeArrayValue,renameRecordKey,schemaFieldDefinitions,setRecordValue} from './nodeFormLogic.ts';

test('editing an input mapping preserves untouched nested values and arrays',()=>{
  const original={text:'{{source.text}}',papers:[{pmid:'123',tags:['review','RCT']}],metadata:{source:{name:'PubMed',complete:false}}};
  const next=setRecordValue(original,'newField','{{input.text}}');
  assert.deepEqual(next,{...original,newField:'{{input.text}}'});
  assert.deepEqual(next.papers,[{pmid:'123',tags:['review','RCT']}]);
  assert.deepEqual(next.metadata,{source:{name:'PubMed',complete:false}});
  assert.deepEqual(original,{text:'{{source.text}}',papers:[{pmid:'123',tags:['review','RCT']}],metadata:{source:{name:'PubMed',complete:false}}});
});

test('applying a research task preset changes only the prompt',()=>{
  const old={kind:'llm',prompt:'old task',configId:9,model:'research-model',fileId:'original-word',inputs:{text:'{{doc.text}}',patches:{patches:[{index:0,text:'new'}]}},arguments:{filters:['keep me']}};
  const preset={id:'revision-plan',label:'修订计划',guidance:'Plan revisions.',prompt:'New prompt\n{{input.text}}'};
  const next=applyPromptPreset(old,preset);
  assert.equal(next.prompt,preset.prompt);
  assert.equal(next.configId,old.configId);
  assert.equal(next.model,old.model);
  assert.equal(next.fileId,old.fileId);
  assert.deepEqual(next.inputs,old.inputs);
  assert.deepEqual(next.arguments,old.arguments);
});

test('preset material source fills one template slot and stays recognizable for a later source change',()=>{
  const preset={id:'literature-extraction',label:'文献提取',guidance:'Extract evidence.',prompt:'提取材料：\n{{input.text}}\n输出字段。'};
  const original={kind:'llm',prompt:'previous prompt',configId:9,inputs:{text:'{{papers.papers}}'}};
  const applied=applyPromptPreset(original,preset,original.inputs.text);
  assert.equal(applied.prompt,'提取材料：\n{{papers.papers}}\n输出字段。');
  assert.deepEqual(findPromptPresetMatch(applied.prompt,[preset]),{preset,source:'{{papers.papers}}'});
  assert.equal(applyPromptPreset(applied,preset,'{{review.text}}').prompt,'提取材料：\n{{review.text}}\n输出字段。');
  assert.equal(findPromptPresetMatch(`${applied.prompt}\n额外指令`,[preset]),undefined);
});

test('example fill adds only missing task fields and preserves files, model, and mappings',()=>{
  const original={kind:'llm',configId:7,model:'m1',fileId:'draft.docx',inputs:{text:'{{doc.text}}',patches:{patches:[{index:2,original:'old',text:'new'}]}},prompt:''};
  const next=fillBlankExample(original,{kind:'llm',configId:99,fileId:'other.docx',inputs:{text:'{{input.text}}'},prompt:'example prompt',timeout:120});
  assert.equal(next.configId,7);
  assert.equal(next.fileId,'draft.docx');
  assert.deepEqual(next.inputs,original.inputs);
  assert.equal(next.prompt,'example prompt');
  assert.equal(next.timeout,120);
});

test('schema helpers expose enum, required, object, and array controls without dropping values',()=>{
  const schema={type:'object',required:['mode','filter'],properties:{
    mode:{type:'string',enum:['summary','full']},
    filter:{type:'object',properties:{dateRange:{type:'array',items:{type:'string'}}}},
    maxResults:{type:'integer'},
  }};
  const fields=schemaFieldDefinitions(schema);
  assert.deepEqual(fields.map(({name,type,required})=>({name,type,required})),[
    {name:'mode',type:'string',required:true},
    {name:'filter',type:'object',required:true},
    {name:'maxResults',type:'integer',required:false},
  ]);
  assert.equal(defaultForSchema({enum:['summary','full']}),'summary');
  assert.deepEqual(defaultForSchema({type:'object'}),{});
  assert.deepEqual(defaultForSchema({type:'array',items:{type:'integer'}}),[]);
  assert.deepEqual(removeArrayValue([{id:'a'},['nested']],0),[['nested']]);
  assert.deepEqual(renameRecordKey({filter:{tags:['old']}},'filter','criteria'),{criteria:{tags:['old']}});
});

test('advanced schemas use the generic editor so their existing values remain editable',()=>{
  assert.equal(hasUnsupportedSchema({type:'object',properties:{query:{type:'string',anyOf:[{type:'string'},{type:'null'}]}}}),true);
  assert.equal(hasUnsupportedSchema({type:'array',items:[{type:'string'},{type:'number'}]}),true);
  assert.equal(hasUnsupportedSchema({type:'object',patternProperties:{'^x-':{type:'string'}}}),true);
  assert.equal(hasUnsupportedSchema({type:'object',properties:{query:{type:'string'},limit:{type:'integer'}}}),false);
});
