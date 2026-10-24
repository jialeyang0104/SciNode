import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import packageInfo from './package.json'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const proxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:8084';

  return {
    plugins: [react()],
    define: { __APP_VERSION__: JSON.stringify(packageInfo.version) },
    server: {
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
  };
})
