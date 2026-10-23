import api from '../utils/request';

export interface LLMGlobalConfig {
  id: number;
  provider: string;
  configName: string;
  apiUrl: string;
  apiKey: string;
  model: string;
  ttsModel?: string;
  embeddingModel?: string;
  imageModel?: string;
  videoModel?: string;
  memoryEnabled?: number;
  temperature: number;
  isDefault: number;
  createdAt: string;
  updatedAt: string;
}

export interface LLMConfigRequest {
  id?: number;
  provider: string;
  configName: string;
  apiUrl: string;
  apiKey: string;
  model: string;
  ttsModel?: string;
  embeddingModel?: string;
  imageModel?: string;
  videoModel?: string;
  memoryEnabled?: number;
  temperature?: number;
  isDefault?: number;
}

export interface ApiResult<T> {
  code: number;
  message: string;
  data: T;
}

/**
 * 获取所有配置列表
 */
export const getAllConfigs = (): Promise<ApiResult<LLMGlobalConfig[]>> => {
  return api.get('/api/llm-config');
};

/**
 * 获取指定提供商的配置列表
 */
export const getConfigsByProvider = (provider: string): Promise<ApiResult<LLMGlobalConfig[]>> => {
  return api.get(`/api/llm-config/${provider}`);
};

/**
 * 获取配置详情
 */
export const getConfigById = (id: number): Promise<ApiResult<LLMGlobalConfig>> => {
  return api.get(`/api/llm-config/detail/${id}`);
};

/**
 * 获取指定提供商的默认配置
 */
export const getDefaultConfig = (provider: string): Promise<ApiResult<LLMGlobalConfig>> => {
  return api.get(`/api/llm-config/default/${provider}`);
};

/**
 * 保存配置（新增或更新）
 */
export const saveConfig = (config: LLMConfigRequest): Promise<ApiResult<LLMGlobalConfig>> => {
  return api.post('/api/llm-config', config);
};

/**
 * 删除配置
 */
export const deleteConfig = (id: number): Promise<ApiResult<void>> => {
  return api.delete(`/api/llm-config/${id}`);
};

/**
 * 设置默认配置
 */
export const setDefaultConfig = (id: number): Promise<ApiResult<void>> => {
  return api.post(`/api/llm-config/${id}/default`);
};
