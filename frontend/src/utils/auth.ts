import axios from 'axios';
import { buildBackendUrl } from '../config/api';

const ACCESS_TOKEN_KEY = 'token';
const REFRESH_TOKEN_KEY = 'refreshToken';
const USERNAME_KEY = 'username';
const REFRESH_ENDPOINT = buildBackendUrl('/api/auth/refresh');

let refreshPromise: Promise<string | null> | null = null;

interface RefreshResult {
  code: number;
  message: string;
  data?: {
    token: string;
    refreshToken: string;
    user: {
      username: string;
    };
  };
}

const decodeJwtPayload = (token: string) => {
  try {
    const parts = token.split('.');
    if (parts.length < 2) {
      return null;
    }

    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return JSON.parse(window.atob(padded)) as { exp?: number };
  } catch {
    return null;
  }
};

export const getAccessToken = () => localStorage.getItem(ACCESS_TOKEN_KEY);

export const getRefreshToken = () => localStorage.getItem(REFRESH_TOKEN_KEY);

export const getUsername = () => localStorage.getItem(USERNAME_KEY);

export const setStoredAuth = (token: string, refreshToken: string, username: string) => {
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  localStorage.setItem(USERNAME_KEY, username);
};

export const clearStoredAuth = () => {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USERNAME_KEY);
};

export const isTokenExpiringSoon = (token: string, bufferSeconds = 30) => {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) {
    return true;
  }

  return payload.exp * 1000 <= Date.now() + bufferSeconds * 1000;
};

export const refreshAccessToken = async () => {
  const currentRefreshToken = getRefreshToken();
  if (!currentRefreshToken) {
    return null;
  }

  if (!refreshPromise) {
    refreshPromise = axios
      .post<RefreshResult>(REFRESH_ENDPOINT, { refreshToken: currentRefreshToken }, {
        headers: { 'Content-Type': 'application/json' }
      })
      .then((response) => {
        const result = response.data;
        if (result.code !== 200 || !result.data) {
          clearStoredAuth();
          return null;
        }

        setStoredAuth(result.data.token, result.data.refreshToken, result.data.user.username);
        return result.data.token;
      })
      .catch(() => {
        clearStoredAuth();
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
};

export const ensureValidAccessToken = async () => {
  const currentToken = getAccessToken();
  if (currentToken && !isTokenExpiringSoon(currentToken)) {
    return currentToken;
  }

  return refreshAccessToken();
};
