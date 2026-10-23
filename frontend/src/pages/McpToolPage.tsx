import { useEffect, useState } from 'react';
import { Button, Form, Input, List, Modal, Popconfirm, Space, Tag, Typography, message } from 'antd';
import { ApiOutlined, ArrowLeftOutlined, DeleteOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
  McpToolConfig,
  createAgentPlanWebSearchMcp,
  deleteMcpTool,
  getMcpTools,
  testMcpTool,
} from '../api/mcpTools';

interface WebSearchResultItem {
  title?: string;
  siteName?: string;
  url?: string;
  snippet?: string;
  summary?: string;
  sortId?: number;
}

const McpToolPage = () => {
  const navigate = useNavigate();
  const [tools, setTools] = useState<McpToolConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testingTool, setTestingTool] = useState<McpToolConfig | null>(null);
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [createForm] = Form.useForm();
  const [testForm] = Form.useForm();

  useEffect(() => {
    loadTools();
  }, []);

  const loadTools = async () => {
    setLoading(true);
    try {
      const result = await getMcpTools();
      if (result.code === 200) {
        setTools(result.data);
      }
    } catch (error) {
      message.error(`加载 MCP 工具失败: ${error instanceof Error ? error.message : '网络错误'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAgentPlanSearch = async () => {
    const values = await createForm.validateFields();
    const result = await createAgentPlanWebSearchMcp(values);
    if (result.code === 200) {
      message.success('Agent Plan 联网搜索 MCP 已添加');
      setCreateOpen(false);
      createForm.resetFields();
      await loadTools();
    }
  };

  const handleDelete = async (id: number) => {
    const result = await deleteMcpTool(id);
    if (result.code === 200) {
      message.success('MCP 工具已删除');
      await loadTools();
    }
  };

  const handleOpenTest = (tool: McpToolConfig) => {
    setTestingTool(tool);
    setTestResult(null);
    testForm.setFieldsValue({ query: '沉默王二 人物 外貌' });
    setTestOpen(true);
  };

  const handleTest = async () => {
    if (!testingTool) return;
    const values = await testForm.validateFields();
    setTestLoading(true);
    try {
      const result = await testMcpTool(testingTool.id, values);
      if (result.code === 200) {
        setTestResult(result.data);
        message.success('MCP 工具调用成功');
      }
    } finally {
      setTestLoading(false);
    }
  };

  const getWebResults = (result: Record<string, unknown> | null): WebSearchResultItem[] => {
    if (!result || !Array.isArray(result.webResults)) {
      return [];
    }
    return result.webResults
      .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object')
      .map((item) => ({
        title: String(item.title || ''),
        siteName: String(item.siteName || ''),
        url: String(item.url || ''),
        snippet: String(item.snippet || ''),
        summary: String(item.summary || ''),
        sortId: typeof item.sortId === 'number' ? item.sortId : undefined,
      }));
  };

  const truncateText = (text: string, maxLength = 360) => {
    if (!text || text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}...`;
  };

  const renderTestResult = () => {
    if (!testResult) return null;

    const webResults = getWebResults(testResult);
    const requestId = typeof testResult.requestId === 'string' ? testResult.requestId : '';
    const resultCount = typeof testResult.resultCount === 'number' ? testResult.resultCount : webResults.length;

    return (
      <div className="mcp-test-result">
        <div className="mcp-test-summary">
          <Space wrap>
            <Tag color="success">调用成功</Tag>
            <span>返回 {resultCount} 条结果</span>
            {requestId && <Typography.Text type="secondary">RequestId: {requestId}</Typography.Text>}
          </Space>
        </div>

        {webResults.length > 0 ? (
          <List
            className="mcp-test-result-list"
            dataSource={webResults}
            renderItem={(item, index) => (
              <List.Item>
                <List.Item.Meta
                  title={(
                    <Space size={8} wrap>
                      <Tag>{item.sortId || index + 1}</Tag>
                      {item.url ? (
                        <Typography.Link href={item.url} target="_blank" rel="noreferrer">
                          {item.title || item.url}
                        </Typography.Link>
                      ) : (
                        <span>{item.title || '未命名结果'}</span>
                      )}
                      {item.siteName && <Tag color="blue">{item.siteName}</Tag>}
                    </Space>
                  )}
                  description={(
                    <Space direction="vertical" size={4}>
                      {item.url && <Typography.Text type="secondary">{item.url}</Typography.Text>}
                      <Typography.Paragraph className="mcp-test-snippet">
                        {truncateText(item.summary || item.snippet || '没有摘要')}
                      </Typography.Paragraph>
                    </Space>
                  )}
                />
              </List.Item>
            )}
          />
        ) : (
          <Typography.Paragraph className="mcp-test-snippet">
            {typeof testResult.summary === 'string' ? testResult.summary : '没有可展示的搜索结果'}
          </Typography.Paragraph>
        )}

        <details className="mcp-test-raw">
          <summary>查看原始返回</summary>
          <pre>{JSON.stringify(testResult, null, 2)}</pre>
        </details>
      </div>
    );
  };

  return (
    <div className="knowledge-shell">
      <header className="knowledge-topbar">
        <div className="knowledge-title-group">
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/editor')}>工作流</Button>
          <div>
            <div className="knowledge-kicker">Resource</div>
            <h2>MCP 工具</h2>
          </div>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          添加 Agent Plan 联网搜索
        </Button>
      </header>

      <div className="knowledge-layout">
        <aside className="knowledge-sidebar">
          <List
            loading={loading}
            dataSource={tools}
            renderItem={(tool) => (
              <List.Item className="knowledge-base-item">
                <div className="knowledge-base-icon"><ApiOutlined /></div>
                <div className="knowledge-base-body">
                  <div className="knowledge-base-name">{tool.name}</div>
                  <div className="knowledge-muted">{tool.toolName} · {tool.transport}</div>
                </div>
                <Tag color={tool.enabled === 1 ? 'success' : 'default'}>{tool.enabled === 1 ? '启用' : '停用'}</Tag>
              </List.Item>
            )}
          />
        </aside>

        <main className="knowledge-main">
          <div className="knowledge-panel">
            <div className="knowledge-panel-header">
              <div>
                <div className="knowledge-kicker">MCP Runtime</div>
                <h3>工具配置</h3>
              </div>
            </div>
            <List
              dataSource={tools}
              locale={{ emptyText: '还没有 MCP 工具，先添加 Agent Plan 联网搜索' }}
              renderItem={(tool) => (
                <List.Item
                  actions={[
                    <Button key="test" icon={<SearchOutlined />} onClick={() => handleOpenTest(tool)}>测试</Button>,
                    <Popconfirm key="delete" title="删除这个 MCP 工具？" onConfirm={() => handleDelete(tool.id)}>
                      <Button danger icon={<DeleteOutlined />}>删除</Button>
                    </Popconfirm>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={<div className="knowledge-base-icon"><ApiOutlined /></div>}
                    title={(
                      <Space>
                        <span>{tool.name}</span>
                        <Tag>{tool.toolType}</Tag>
                        {tool.preset === 1 && <Tag color="blue">预设</Tag>}
                      </Space>
                    )}
                    description={(
                      <Space direction="vertical" size={4}>
                        <span>{tool.description || '未填写描述'}</span>
                        <Typography.Text code>{tool.command} {tool.args.join(' ')}</Typography.Text>
                        <span className="knowledge-muted">
                          Env: {Object.keys(tool.env || {}).join(', ') || '无'}
                        </span>
                      </Space>
                    )}
                  />
                </List.Item>
              )}
            />
          </div>
        </main>
      </div>

      <Modal
        title="添加 Agent Plan 联网搜索 MCP"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreateAgentPlanSearch}
        okText="添加"
        width={640}
      >
        <Form form={createForm} layout="vertical" initialValues={{ name: 'Agent Plan 联网搜索' }}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="可选，用于区分不同 Agent Plan key 或额度来源" />
          </Form.Item>
          <Form.Item name="apiKey" label="联网搜索 API Key" rules={[{ required: true, message: '请输入联网搜索 API Key' }]}>
            <Input.Password placeholder="来自 Agent Plan 使用配置 / 配置 Harness 的联网搜索 API Key" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`测试 ${testingTool?.name || ''}`}
        open={testOpen}
        onCancel={() => setTestOpen(false)}
        onOk={handleTest}
        okText="调用"
        confirmLoading={testLoading}
        width={860}
      >
        <Form form={testForm} layout="vertical">
          <Form.Item name="query" label="搜索 Query" rules={[{ required: true, message: '请输入搜索 Query' }]}>
            <Input />
          </Form.Item>
        </Form>
        {renderTestResult()}
      </Modal>
    </div>
  );
};

export default McpToolPage;
