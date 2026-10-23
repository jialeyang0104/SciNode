import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL } from '../config/api';
import { clearStoredAuth, getAccessToken, refreshAccessToken } from './auth';

interface RetryableAxiosRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

const isAbsoluteApiBaseUrl = /^https?:\/\//.test(API_BASE_URL);

/**
 * Axios 实例
 */
const api: AxiosInstance = axios.create({
  baseURL: isAbsoluteApiBaseUrl ? API_BASE_URL : '',
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * 请求拦截器
 */
api.interceptors.request.use(
  (config) => {
    const token = getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * 响应拦截器
 */
api.interceptors.response.use(
  (response) => {
    return response.data;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableAxiosRequestConfig | undefined;
    const isUnauthorized = error.response?.status === 401;
    const isRefreshRequest = originalRequest?.url?.includes('/api/auth/refresh');

    if (isUnauthorized && originalRequest && !originalRequest._retry && !isRefreshRequest) {
      originalRequest._retry = true;

      const refreshedToken = await refreshAccessToken();
      if (refreshedToken) {
        originalRequest.headers.Authorization = `Bearer ${refreshedToken}`;
        return api(originalRequest);
      }
    }

    if (isUnauthorized) {
      clearStoredAuth();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
