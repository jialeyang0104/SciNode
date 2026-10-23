import { create } from 'zustand';
import { clearStoredAuth, getAccessToken, getRefreshToken, getUsername, setStoredAuth } from '../utils/auth';

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  username: string | null;
  isAuthenticated: boolean;
  setAuth: (token: string, refreshToken: string, username: string) => void;
  clearAuth: () => void;
}

/**
 * 认证状态管理
 */
export const useAuthStore = create<AuthState>((set) => ({
  token: getAccessToken(),
  refreshToken: getRefreshToken(),
  username: getUsername(),
  isAuthenticated: !!getRefreshToken(),
  
  setAuth: (token: string, refreshToken: string, username: string) => {
    setStoredAuth(token, refreshToken, username);
    set({ token, refreshToken, username, isAuthenticated: true });
  },
  
  clearAuth: () => {
    clearStoredAuth();
    set({ token: null, refreshToken: null, username: null, isAuthenticated: false });
  },
}));
