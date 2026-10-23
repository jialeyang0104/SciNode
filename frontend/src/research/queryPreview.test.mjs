import test from 'node:test';
import assert from 'node:assert/strict';
import {queryPreviews} from './queryPreview.ts';

const preview={name:'example',port:5432,database:'mimiciv',status:'success',columns:['value','missing','empty'],rows:[[0,null,'']],returned_rows:1,truncated:false};
test('query preview preserves zero, null, empty strings and truncation',()=>{
 const value={...preview,truncated:true,max_rows:1};
 assert.deepEqual(queryPreviews([value]),[value]);
 assert.deepEqual(queryPreviews([value])[0].rows,[[0,null,'']]);
});
test('empty results keep their headers for the zero-row state',()=>{
 assert.equal(queryPreviews([{...preview,rows:[],returned_rows:0}]).length,1);
});
test('unrelated output and mismatched rows do not replace the normal result view',()=>{
 for(const value of [undefined,{},['text'],[{columns:['a'],rows:[[1]]}],[{...preview,rows:[[1]]}]])assert.deepEqual(queryPreviews(value),[]);
});
