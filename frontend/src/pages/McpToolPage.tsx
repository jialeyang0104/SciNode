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
import { mcpSearchPreview, searchExcerpt } from '../research/mcpSearchResults';

interface SearchFormValues { query: string }
interface ConnectionFormValues { name: string; description?: string; apiKey: string }

const RESEARCH_QUERY_EXAMPLE = '脓毒症患者 ICU 后康复 随机对照试验';

function SearchPreview({ result }: { result: Record<string, unknown> }) {
  const preview = mcpSearchPreview(result);
  return (
    <section className="mcp-test-result" aria-label="检索结果预览">
      <div className="mcp-test-summary">
        <Space wrap>
          <Tag color="success">调用成功</Tag>
          <span>返回 {preview.resultCount} 条结果</span>
          {preview.requestId && <Typography.Text type="secondary">RequestId: {preview.requestId}</Typography.Text>}
        </Space>
      </div>
      {preview.items.length > 0 ? (
        <List
          className="mcp-test-result-list"
          dataSource={preview.items}
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
                    ) : <span>{item.title || '未命名结果'}</span>}
                    {item.siteName && <Tag color="blue">{item.siteName}</Tag>}
                  </Space>
                )}
                description={(
                  <Space direction="vertical" size={4}>
                    {item.url && <Typography.Text type="secondary">{item.url}</Typography.Text>}
                    <Typography.Paragraph className="mcp-test-snippet">
                      {searchExcerpt(item.summary || item.snippet || '没有摘要')}
                    </Typography.Paragraph>
                  </Space>
                )}
              />
            </List.Item>
          )}
        />
      ) : <Typography.Paragraph className="mcp-test-snippet">{preview.summary}</Typography.Paragraph>}
      <details className="mcp-test-raw">
        <summary>查看原始返回</summary>
        <pre>{JSON.stringify(result, null, 2)}</pre>
      </details>
    </section>
  );
}

function ToolDetails({ tool }: { tool: McpToolConfig }) {
  return (
    <List.Item.Meta
      avatar={<div className="knowledge-base-icon"><ApiOutlined /></div>}
      title={(
        <Space wrap>
          <span>{tool.name}</span>
          <Tag>{tool.toolType}</Tag>
          {tool.preset === 1 && <Tag color="blue">预设</Tag>}
        </Space>
      )}
      description={(
        <Space direction="vertical" size={4}>
          <span>{tool.description || '未填写描述'}</span>
          <Typography.Text code>{tool.command} {tool.args.join(' ')}</Typography.Text>
          <span className="knowledge-muted">环境变量：{Object.keys(tool.env || {}).join(', ') || '无'}</span>
        </Space>
      )}
    />
  );
}

export default function McpToolPage() {
  const navigate = useNavigate();
  const [tools, setTools] = useState<McpToolConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [testingTool, setTestingTool] = useState<McpToolConfig | null>(null);
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [createForm] = Form.useForm<ConnectionFormValues>();
  const [testForm] = Form.useForm<SearchFormValues>();

  const loadTools = async () => {
    setLoading(true);
    try {
      const result = await getMcpTools();
      if (result.code === 200) setTools(result.data);
      else message.error(result.message || '加载 MCP 工具失败');
    } catch (error) {
      message.error(`加载 MCP 工具失败：${error instanceof Error ? error.message : '网络错误'}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadTools(); }, []);

  const createSearchConnection = async () => {
    const values = await createForm.validateFields();
    setCreating(true);
    try {
      const result = await createAgentPlanWebSearchMcp(values);
      if (result.code !== 200) {
        message.error(result.message || '添加联网检索失败');
        return;
      }
      message.success('科研联网检索已添加');
      setCreateOpen(false);
      createForm.resetFields();
      await loadTools();
    } catch (error) {
      message.error(`添加联网检索失败：${error instanceof Error ? error.message : '网络错误'}`);
    } finally {
      setCreating(false);
    }
  };

  const removeConnection = async (id: number) => {
    try {
      const result = await deleteMcpTool(id);
      if (result.code !== 200) {
        message.error(result.message || '删除 MCP 工具失败');
        return;
      }
      message.success('MCP 工具已删除');
      await loadTools();
    } catch (error) {
      message.error(`删除 MCP 工具失败：${error instanceof Error ? error.message : '网络错误'}`);
    }
  };

  const openSearchTest = (tool: McpToolConfig) => {
    setTestingTool(tool);
    setTestResult(null);
    testForm.setFieldsValue({ query: RESEARCH_QUERY_EXAMPLE });
  };

  const runSearchTest = async () => {
    if (!testingTool) return;
    const values = await testForm.validateFields();
    setTestLoading(true);
    setTestResult(null);
    try {
      const result = await testMcpTool(testingTool.id, values);
      if (result.code === 200) {
        setTestResult(result.data);
        message.success('MCP 工具调用成功');
      } else message.error(result.message || 'MCP 工具调用失败');
    } catch (error) {
      message.error(`MCP 工具调用失败：${error instanceof Error ? error.message : '网络错误'}`);
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <div className="knowledge-shell">
      <header className="knowledge-topbar">
        <div className="knowledge-title-group">
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/research')}>科研工作台</Button>
          <div><div className="knowledge-kicker">SciNode · 科研工具</div><h2>科研 MCP 工具</h2></div>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>添加联网检索</Button>
      </header>
      <div className="knowledge-layout">
        <aside className="knowledge-sidebar">
          <List loading={loading} dataSource={tools} renderItem={(tool) => (
            <List.Item className="knowledge-base-item">
              <div className="knowledge-base-icon"><ApiOutlined /></div>
              <div className="knowledge-base-body">
                <div className="knowledge-base-name">{tool.name}</div>
                <div className="knowledge-muted">{tool.toolName} · {tool.transport}</div>
              </div>
              <Tag color={tool.enabled === 1 ? 'success' : 'default'}>{tool.enabled === 1 ? '启用' : '停用'}</Tag>
            </List.Item>
          )} />
        </aside>
        <main className="knowledge-main">
          <div className="knowledge-panel">
            <div className="knowledge-panel-header"><div>
              <div className="knowledge-kicker">连接与验证</div><h3>已配置的工具</h3>
            </div></div>
            <List dataSource={tools} locale={{ emptyText: '还没有 MCP 工具，点击“添加联网检索”开始配置' }} renderItem={(tool) => (
              <List.Item actions={[
                <Button key="test" icon={<SearchOutlined />} onClick={() => openSearchTest(tool)}>测试</Button>,
                <Popconfirm key="delete" title="删除这个 MCP 工具？" onConfirm={() => removeConnection(tool.id)}>
                  <Button danger icon={<DeleteOutlined />}>删除</Button>
                </Popconfirm>,
              ]}>
                <ToolDetails tool={tool} />
              </List.Item>
            )} />
          </div>
        </main>
      </div>
      <Modal title="添加科研联网检索" open={createOpen} onCancel={() => setCreateOpen(false)}
        onOk={createSearchConnection} okText="添加" confirmLoading={creating} width={640}>
        <Typography.Paragraph type="secondary">
          此预设连接火山方舟 Agent Plan 的联网搜索 MCP 服务，使用该服务提供的搜索 API Key。
        </Typography.Paragraph>
        <Form form={createForm} layout="vertical" initialValues={{ name: '科研联网检索' }}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}><Input /></Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="例如：用于文献线索检索和研究背景核验" />
          </Form.Item>
          <Form.Item name="apiKey" label="联网搜索 API Key" rules={[{ required: true, message: '请输入联网搜索 API Key' }]}>
            <Input.Password placeholder="火山方舟 Agent Plan 联网搜索 API Key" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal title={`测试 ${testingTool?.name || ''}`} open={testingTool !== null}
        onCancel={() => setTestingTool(null)} onOk={runSearchTest} okText="调用" confirmLoading={testLoading} width={860}>
        <Form form={testForm} layout="vertical">
          <Form.Item name="query" label="检索问题或关键词" rules={[{ required: true, message: '请输入检索问题或关键词' }]}>
            <Input placeholder="输入科研主题、文献关键词或需要核验的问题" />
          </Form.Item>
        </Form>
        {testResult && <SearchPreview result={testResult} />}
      </Modal>
    </div>
  );
}
