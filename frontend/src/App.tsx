import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ResearchPage from './pages/ResearchPage';
import LoginPage from './pages/LoginPage';
import KnowledgePage from './pages/KnowledgePage';
import McpToolPage from './pages/McpToolPage';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';

function App() {
  return (
    <ConfigProvider locale={zhCN} theme={{token:{fontFamily:'"Avenir Next", "Avenir", "PingFang SC", "Noto Sans SC", "Helvetica Neue", sans-serif',colorPrimary:'#514a91',colorSuccess:'#22703e',colorSuccessText:'#166534',colorWarning:'#a65b00',colorWarningText:'#92400e',colorError:'#b42323',colorErrorText:'#991b1b',colorInfo:'#2752ad',colorInfoText:'#1e40af',colorText:'#253248',colorTextSecondary:'#536277',colorTextTertiary:'#607084',colorTextPlaceholder:'#65748b',colorTextDisabled:'#65748b',colorBgLayout:'#f2f5f8',colorBorder:'#d5dde7',borderRadius:10,fontSize:13,controlHeight:36},components:{Button:{fontWeight:500},Modal:{borderRadiusLG:18},Card:{borderRadiusLG:16}}}}>
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
