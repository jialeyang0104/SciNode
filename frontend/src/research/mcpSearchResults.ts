export interface McpSearchHit {
  title: string;
  siteName: string;
  url: string;
  snippet: string;
  summary: string;
  sortId?: number;
}

/** 将搜索服务返回值整理为预览，不修改或丢弃供调试使用的原始返回。 */
export function mcpSearchPreview(result: Record<string, unknown>) {
  const items: McpSearchHit[] = Array.isArray(result.webResults)
    ? result.webResults
      .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object')
      .map((item) => ({
        title: String(item.title || ''),
        siteName: String(item.siteName || ''),
        url: String(item.url || ''),
        snippet: String(item.snippet || ''),
        summary: String(item.summary || ''),
        sortId: typeof item.sortId === 'number' ? item.sortId : undefined,
      }))
    : [];

  return {
    items,
    requestId: typeof result.requestId === 'string' ? result.requestId : '',
    resultCount: typeof result.resultCount === 'number' ? result.resultCount : items.length,
    summary: typeof result.summary === 'string' ? result.summary : '没有可展示的搜索结果',
  };
}

export function searchExcerpt(text: string, maxLength = 360): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
