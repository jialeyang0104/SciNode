import test from 'node:test';
import assert from 'node:assert/strict';
import {mcpSearchPreview, searchExcerpt} from './mcpSearchResults.ts';

test('search preview preserves titles, links, summaries, ranks and request metadata', () => {
  const hit = {title:'研究综述',siteName:'PubMed',url:'https://pubmed.ncbi.nlm.nih.gov/',snippet:'片段',summary:'摘要',sortId:2};
  const result = {webResults:[hit],requestId:'fixture-request',resultCount:15,extra:{source:'fixture'}};
  const before = structuredClone(result);
  assert.deepEqual(mcpSearchPreview(result), {items:[hit],requestId:'fixture-request',resultCount:15,summary:'没有可展示的搜索结果'});
  assert.deepEqual(result, before);
});

test('malformed entries are filtered while valid partial results keep their original conversions', () => {
  const preview = mcpSearchPreview({webResults:[null,3,'text',{title:12,url:'https://example.org',sortId:'1'}]});
  assert.deepEqual(preview.items,[{title:'12',siteName:'',url:'https://example.org',snippet:'',summary:'',sortId:undefined}]);
  assert.equal(preview.resultCount,1);
});

test('empty search results keep server summaries and explicit zero counts', () => {
  assert.deepEqual(mcpSearchPreview({summary:'未找到相关文献',resultCount:0,requestId:4}),{
    items:[],summary:'未找到相关文献',resultCount:0,requestId:'',
  });
  assert.equal(mcpSearchPreview({summary:''}).summary,'');
  assert.deepEqual(mcpSearchPreview({webResults:'not-an-array'}).items,[]);
});

test('the preview retains zero ranks and the original raw result can still be displayed', () => {
  const result = {webResults:[{title:'',sortId:0}],summary:'原始摘要',providerData:{status:'ok'}};
  assert.equal(mcpSearchPreview(result).items[0].sortId,0);
  assert.equal(JSON.parse(JSON.stringify(result)).providerData.status,'ok');
});

test('long summaries retain the existing 360-character preview limit', () => {
  assert.equal(searchExcerpt(''),'');
  assert.equal(searchExcerpt('x'.repeat(360)),'x'.repeat(360));
  assert.equal(searchExcerpt('x'.repeat(361)),'x'.repeat(360)+'...');
});
