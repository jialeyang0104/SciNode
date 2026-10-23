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
