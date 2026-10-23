import api from '../utils/request';

export interface KnowledgeBase {
  id: number;
  name: string;
  description?: string;
  configId?: number;
  embeddingModel?: string;
  chunkSize: number;
  chunkOverlap: number;
  status: string;
  documentCount: number;
  chunkCount: number;
  charCount: number;
  createdAt?: string;
  updatedAt?: string;
  documents?: KnowledgeDocument[];
  recentTasks?: KnowledgeIndexTask[];
}

export interface KnowledgeDocument {
  id: number;
  knowledgeBaseId: number;
  title: string;
  sourceType: string;
  sourceUrl?: string;
  fileName?: string;
  tags?: string;
  status: string;
  charCount: number;
  errorMessage?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface KnowledgeChunkPreview {
  chunkIndex: number;
  content: string;
  charCount: number;
}

export interface KnowledgeIndexTask {
  id: number;
  knowledgeBaseId: number;
  documentId: number;
  status: string;
  progress: number;
  totalChunks: number;
  finishedChunks: number;
  errorMessage?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface KnowledgeSearchResult {
  chunks: Array<{
    chunkId: number;
    knowledgeBaseId: number;
    documentId: number;
    title?: string;
    content: string;
    score: number;
  }>;
  citations: number[];
  context: string;
}

interface ApiResult<T> {
  code: number;
  message: string;
  data: T;
}

export const getKnowledgeBases = (): Promise<ApiResult<KnowledgeBase[]>> =>
  api.get('/api/knowledge-bases');

export const createKnowledgeBase = (data: {
  name: string;
  description?: string;
  configId?: number;
  embeddingModel?: string;
  chunkSize?: number;
  chunkOverlap?: number;
}): Promise<ApiResult<KnowledgeBase>> => api.post('/api/knowledge-bases', data);

export const getKnowledgeBase = (id: number): Promise<ApiResult<KnowledgeBase>> =>
  api.get(`/api/knowledge-bases/${id}`);

export const deleteKnowledgeBase = (id: number): Promise<ApiResult<void>> =>
  api.delete(`/api/knowledge-bases/${id}`);

export const importKnowledgeText = (
  id: number,
  data: { title?: string; content: string; tags?: string }
): Promise<ApiResult<KnowledgeDocument>> =>
  api.post(`/api/knowledge-bases/${id}/documents/text`, data);

export const uploadKnowledgeTextFile = (
  id: number,
  file: File
): Promise<ApiResult<KnowledgeDocument>> => {
  const formData = new FormData();
  formData.append('file', file);
  return api.post(`/api/knowledge-bases/${id}/documents/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

export const previewKnowledgeChunks = (
  id: number,
  documentId: number,
  data?: { chunkSize?: number; chunkOverlap?: number }
): Promise<ApiResult<KnowledgeChunkPreview[]>> =>
  api.post(`/api/knowledge-bases/${id}/documents/${documentId}/preview-chunks`, data || {});

export const indexKnowledgeDocument = (
  id: number,
  documentId: number
): Promise<ApiResult<KnowledgeIndexTask>> =>
  api.post(`/api/knowledge-bases/${id}/documents/${documentId}/index`);

export const searchKnowledgeBase = (
  id: number,
  data: { query: string; topK?: number; scoreThreshold?: number }
): Promise<ApiResult<KnowledgeSearchResult>> =>
  api.post(`/api/knowledge-bases/${id}/search`, data);
