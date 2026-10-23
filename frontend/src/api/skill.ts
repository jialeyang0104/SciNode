import api from '../utils/request';

export interface SkillSummary {
  name: string;
  description: string;
}

export interface Skill {
  name: string;
  description: string;
  content: string;
  references: string[];
}

export interface ApiResult<T> {
  code: number;
  message: string;
  data: T;
}

/**
 * 获取所有 Skills 列表
 */
export const getSkills = (): Promise<ApiResult<SkillSummary[]>> => {
  return api.get('/api/skills');
};

/**
 * 获取指定 Skill 详情
 */
export const getSkill = (name: string): Promise<ApiResult<Skill>> => {
  return api.get(`/api/skills/${name}`);
};

/**
 * 获取 Skill 的 reference 文档
 */
export const getSkillReference = (skillName: string, referenceName: string): Promise<ApiResult<string>> => {
  return api.get(`/api/skills/${skillName}/references/${referenceName}`);
};
