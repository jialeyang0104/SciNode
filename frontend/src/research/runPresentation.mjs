const SUCCESS = 'SUCCESS';

export function runProgress(run) {
  const total = run?.definition?.nodes?.length || 0;
  const results = Object.values(run?.nodeResults || {});
  const complete = results.filter(result => result.status === SUCCESS).length;
  return {total,complete,percent:total ? Math.round((complete / total) * 100) : 0};
}

export function nodeRunState(run,nodeId) {
  if (!run) return 'idle';
  const result = run.nodeResults?.[nodeId];
  if (run.currentNodeId === nodeId) {
    if (run.status === 'RUNNING') return result?.status === 'FAILED' ? 'failed' : 'active';
    if (run.status === 'WAITING_APPROVAL') return 'waiting';
    if (run.status === 'PAUSED') return 'paused';
    if (run.status === 'FAILED') return 'failed';
  }
  if (result?.status === 'FAILED') return 'failed';
  if (result?.status === SUCCESS) return 'success';
  if (result?.status === 'WAITING_APPROVAL') return 'waiting';
  if (result?.status === 'PAUSED') return 'paused';
  if (result?.status === 'RUNNING') return run.status === 'RUNNING' ? 'active' : 'idle';
  return 'idle';
}

export function activeRunEdges(edges,run) {
  if (run?.status !== 'RUNNING' || !run.currentNodeId) return [];
  return edges.filter(edge => edge.target === run.currentNodeId && run.nodeResults?.[edge.source]?.status === SUCCESS && run.nodeResults?.[edge.source]?.output !== undefined);
}

export function runStatusLabel(status) {
  return ({QUEUED:'排队中',RUNNING:'执行中',WAITING_APPROVAL:'等待人工确认',PAUSED:'已暂停',SUCCESS:'运行完成',FAILED:'运行失败',INTERRUPTED:'运行中断',CANCELLED:'运行已结束',REJECTED:'已退回'})[status] || status || '待执行';
}

export function runStatusAnnouncement(status) {
  return ({QUEUED:'运行已排队，节点状态会在画布上更新。',RUNNING:'工作流正在执行。',WAITING_APPROVAL:'运行已暂停在人工确认节点，请检查材料并作出决定。',PAUSED:'运行已暂停，可从当前结果继续。',SUCCESS:'工作流已完成，可检查成果并决定是否冻结。',FAILED:'运行失败，失败节点与诊断摘要已保留在运行记录。',INTERRUPTED:'运行已中断，已有节点结果仍保留。',CANCELLED:'运行已结束，已有节点结果仍保留。',REJECTED:'待确认材料已退回，请检查节点结果。'})[status] || '运行状态已更新。';
}

export function runStatusTransition(before,after,source='live') {
  if (!after || source === 'history') return null;
  if (before?.id === after.id && before.status === after.status) return null;
  const previous = before?.id === after.id ? before.status : 'STARTED';
  return {runId:after.id,previous,status:after.status,key:`${after.id}:${previous}>${after.status}`};
}

/** Present complete structured output as a short description, not clipped JSON. */
export function nodeResultSummary(result,fallback) {
  if (!result) return fallback;
  if(result.status==='SUCCESS'&&result.output){
    const output=result.output;
    if(typeof output.retrieved==='number')return `检索命中 ${output.total} 篇 · 本次获取 ${output.retrieved} 篇 · 含摘要 ${output.abstractCount||0} 篇`;
    if(typeof output.n==='number')return `数据记录 n=${output.n}${typeof output.summary?.analyzed==='number'?` · 分析 n=${output.summary.analyzed}`:''}${output.figureCount?` · 图表 ${output.figureCount} 张`:''}`;
  }
  const summary=result.summary || fallback;
  const isStructured=value=>/^\s*(?:\{|\[\s*(?:[\[{"\d-]|\]|true\b|false\b|null\b))/.test(value)
    && !/^\s*\[[^\]\r\n]+\](?:\(|\[|:|\s+\S)/.test(value);
  if (!isStructured(summary)) return summary;
  let content=result.output;
  const text=typeof content?.text==='string'?content.text:summary;
  if (typeof text==='string' && isStructured(text)) {
    try { content=JSON.parse(text); }
    catch { return '结构化内容摘录，打开节点预览查看完整结果。'; }
  }
  if (Array.isArray(content?.patches)) return `${content.patches.length} 项修订已生成。打开预览查看原文与修订稿。`;
  if (Array.isArray(content)) return `${content.length} 项结构化结果，打开预览查看详细内容。`;
  return '结构化结果，打开节点预览查看字段与内容。';
}
