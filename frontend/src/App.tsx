import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ResearchPage from './pages/ResearchPage';
import LoginPage from './pages/LoginPage';
import KnowledgePage from './pages/KnowledgePage';
import McpToolPage from './pages/McpToolPage';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import {sciNodeTheme} from './theme';

function App() {
  return (
    <ConfigProvider locale={zhCN} theme={sciNodeTheme}>
      <BrowserRouter>
        <Routes>
          <Route path="/research" element={<ResearchPage />} />
          <Route path="/research/:id" element={<ResearchPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/knowledge" element={<KnowledgePage />} />
          <Route path="/mcp-tools" element={<McpToolPage />} />
          <Route path="/" element={<Navigate to="/research" replace />} />
          <Route path="*" element={<Navigate to="/research" replace />} />
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
}

export default App;
