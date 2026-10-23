import { create } from 'zustand';
import { LLMGlobalConfig, LLMConfigRequest } from '../api/llmConfig';
import {
  getAllConfigs,
  getConfigsByProvider,
  saveConfig,
  deleteConfig,
  setDefaultConfig
} from '../api/llmConfig';

interface LLMConfigState {
  configs: LLMGlobalConfig[];
  loading: boolean;
  error: string | null;

  // Actions
  fetchAllConfigs: () => Promise<void>;
  fetchConfigsByProvider: (provider: string) => Promise<void>;
  saveConfig: (config: LLMConfigRequest) => Promise<LLMGlobalConfig | null>;
  deleteConfig: (id: number) => Promise<boolean>;
  setDefaultConfig: (id: number) => Promise<boolean>;
  getConfigsByProvider: (provider: string) => LLMGlobalConfig[];
  getDefaultConfig: (provider: string) => LLMGlobalConfig | undefined;
  clearError: () => void;
}

export const useLLMConfigStore = create<LLMConfigState>((set, get) => ({
  configs: [],
  loading: false,
  error: null,

  fetchAllConfigs: async () => {
    set({ loading: true, error: null });
    try {
      const result = await getAllConfigs();
      if (result.code === 200) {
        set({ configs: result.data, loading: false });
      } else {
        set({ error: result.message, loading: false });
      }
    } catch (error: any) {
      set({ error: error.message || '获取配置列表失败', loading: false });
    }
  },

  fetchConfigsByProvider: async (provider: string) => {
    set({ loading: true, error: null });
    try {
      const result = await getConfigsByProvider(provider);
      if (result.code === 200) {
        set((state) => {
          const otherConfigs = state.configs.filter((c) => c.provider !== provider);
          return {
            configs: [...otherConfigs, ...result.data],
            loading: false
          };
        });
      } else {
        set({ error: result.message, loading: false });
      }
    } catch (error: any) {
      set({ error: error.message || '获取配置列表失败', loading: false });
    }
  },

  saveConfig: async (config: LLMConfigRequest) => {
    set({ loading: true, error: null });
    try {
      const result = await saveConfig(config);
      if (result.code === 200) {
        await get().fetchAllConfigs();
        return result.data;
      } else {
        set({ error: result.message, loading: false });
        return null;
      }
    } catch (error: any) {
      set({ error: error.message || '保存配置失败', loading: false });
      return null;
    }
  },

  deleteConfig: async (id: number) => {
    set({ loading: true, error: null });
    try {
      const result = await deleteConfig(id);
      if (result.code === 200) {
        set((state) => ({
          configs: state.configs.filter((c) => c.id !== id),
          loading: false
        }));
        return true;
      } else {
        set({ error: result.message, loading: false });
        return false;
      }
    } catch (error: any) {
      set({ error: error.message || '删除配置失败', loading: false });
      return false;
    }
  },

  setDefaultConfig: async (id: number) => {
    set({ loading: true, error: null });
    try {
      const result = await setDefaultConfig(id);
      if (result.code === 200) {
        await get().fetchAllConfigs();
        return true;
      } else {
        set({ error: result.message, loading: false });
        return false;
      }
    } catch (error: any) {
      set({ error: error.message || '设置默认配置失败', loading: false });
      return false;
    }
  },

  getConfigsByProvider: (provider: string) => {
    return get().configs.filter((c) => c.provider === provider);
  },

  getDefaultConfig: (provider: string) => {
    return get().configs.find((c) => c.provider === provider && c.isDefault === 1);
  },

  clearError: () => set({ error: null })
}));
