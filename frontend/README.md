# SciNode Frontend

React + TypeScript + Vite，包含科研项目主页、可视化工作流、模型设置、全局与项目设置及登录页。

```sh
npm install
npm run dev
npm run build
npx eslint src/pages/ResearchPage.tsx src/components/LLMConfigModal.tsx src/App.tsx
```

API 通过 `/api` 连接后端。服务地址由 `.env.local` 的 `VITE_API_PROXY_TARGET` 配置。字体、控件主题和背景分别定义在 `index.css`、`App.tsx` 及页面样式中。
