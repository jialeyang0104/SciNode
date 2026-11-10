# SciNode Frontend

React + TypeScript + Vite，包含科研项目主页、可视化工作流、模型设置、全局与项目设置及登录页。

```sh
npm install
npm run dev
npm run build
npx eslint src/pages/ResearchPage.tsx src/components/LLMConfigModal.tsx src/App.tsx
```

API 通过 `/api` 连接后端。服务地址由 `.env.local` 的 `VITE_API_PROXY_TARGET` 配置。字体、控件主题和背景分别定义在 `index.css`、`App.tsx` 及页面样式中。


临床入口分工：`clinicalCatalog.ts` 维护模板/任务说明，`ClinicalStatistics.tsx` 负责真实列名选择，`PubMedFields.tsx` 组合检索条件，`SourceCards.tsx` 管理资料勾选与引用标签，`TaskResults.tsx` 按任务展示报告、图表、代码及复现文件。`ResearchPage.tsx` 负责画布、路由与运行状态。

回归检查：`node --test src/research/*.test.mjs`；修改组件使用项目 ESLint。统计执行、数据保护和表格解析由后端负责，前端不运行统计代码。
