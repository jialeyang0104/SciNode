import test from 'node:test';
import assert from 'node:assert/strict';
import {activeRunEdges,nodeRunState,runProgress,runStatusAnnouncement,runStatusTransition} from './runPresentation.mjs';

const run={status:'RUNNING',currentNodeId:'b',definition:{nodes:[{id:'a'},{id:'b'},{id:'c'}]},nodeResults:{a:{status:'SUCCESS',output:{result:1}},b:{status:'RUNNING'},c:{status:'QUEUED'}}};

test('run maps current, completed and waiting states to node classes and progress',()=>{
  assert.equal(nodeRunState(run,'b'),'active');
  assert.equal(nodeRunState(run,'a'),'success');
  assert.equal(nodeRunState({...run,status:'WAITING_APPROVAL'},'b'),'waiting');
  assert.equal(nodeRunState({...run,status:'PAUSED'},'b'),'paused');
  assert.equal(nodeRunState({...run,status:'FAILED'},'b'),'failed');
  assert.deepEqual(runProgress(run),{total:3,complete:1,percent:33});
});

test('only edges carrying a successful upstream output to the running target animate',()=>{
  const edges=[{id:'ab',source:'a',target:'b'},{id:'cb',source:'c',target:'b'},{id:'ac',source:'a',target:'c'}];
  assert.deepEqual(activeRunEdges(edges,run).map(edge=>edge.id),['ab']);
  assert.deepEqual(activeRunEdges(edges,{...run,status:'PAUSED'}),[]);
  assert.deepEqual(activeRunEdges(edges,{...run,nodeResults:{a:{status:'SUCCESS'},b:{status:'RUNNING'}}}),[]);
});

test('status notices describe live transitions, ignore same-state updates, and skip history selection',()=>{
  assert.match(runStatusAnnouncement('WAITING_APPROVAL'),/人工确认/);
  const before={id:'run',status:'RUNNING'};
  assert.equal(runStatusTransition(before,{...before}),null);
  assert.deepEqual(runStatusTransition(before,{...before,status:'FAILED'}),{runId:'run',previous:'RUNNING',status:'FAILED',key:'run:RUNNING>FAILED'});
  assert.equal(runStatusTransition(before,{id:'older-run',status:'SUCCESS'},'history'),null);
});

test('node summaries describe complete structured outputs without exposing clipped JSON',async()=>{
  const {nodeResultSummary}=await import('./runPresentation.mjs');
  const output={text:JSON.stringify({patches:[{index:1,text:'正文'},{index:2,text:'新正文'}]})};
  const original=structuredClone(output);
  assert.equal(nodeResultSummary({summary:'{"patches":[{"index":1,"text":"',output},'待执行'),'2 项修订已生成。打开预览查看原文与修订稿。');
  assert.deepEqual(output,original);
  assert.match(nodeResultSummary({summary:'{"truncated":'},'待执行'),/完整结果/);
  assert.match(nodeResultSummary({summary:'[]',output:{text:'[]'}},'待执行'),/^0 项/);
  assert.equal(nodeResultSummary(undefined,'待执行'),'待执行');
  assert.equal(nodeResultSummary({summary:'## 研究摘要\n零例不良事件'},'待执行'),'## 研究摘要\n零例不良事件');
  assert.equal(nodeResultSummary({summary:'连接失败'},'待执行'),'连接失败');
});

test('Markdown links, citations and scientific brackets remain readable summaries',async()=>{
  const {nodeResultSummary}=await import('./runPresentation.mjs');
  for (const summary of ['[PubMed](https://pubmed.ncbi.nlm.nih.gov/) 检索完成','[1] 文献记录','[IL-6] 水平升高','[来源][reference]']) {
    assert.equal(nodeResultSummary({summary},'待执行'),summary);
  }
  assert.match(nodeResultSummary({summary:'[1,2]',output:[1,2]},'待执行'),/^2 项结构化结果/);
  assert.match(nodeResultSummary({summary:'[1,2] \n',output:[1,2]},'待执行'),/^2 项结构化结果/);
});
