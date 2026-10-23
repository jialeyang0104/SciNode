import React, { useEffect, useState, useRef } from 'react';
import {
  Modal,
  Alert,
  Form,
  Input,
  AutoComplete,
  Select,
  Button,
  Table,
  Space,
  message,
  Popconfirm
} from 'antd';
import { SettingOutlined, PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { research, errorText } from '../research/api';
import { useLLMConfigStore } from '../store/llmConfigStore';
import { LLMGlobalConfig, LLMConfigRequest } from '../api/llmConfig';
import { getProviderLabel, normalizeProviderKey } from '../utils/provider';

const PROVIDERS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'qwen', label: '通义千问' },
  { value: 'step', label: '阶跃星辰' },
  { value: 'agnes', label: 'Agnes AI' },
  { value: 'apifree', label: 'APIFree / SkyClaw' },
  { value: 'volcengine_agent_plan', label: '火山方舟 Agent Plan' }
];

interface LLMConfigModalProps {
  visible?: boolean;
  onClose?: () => void;
}

const LLMConfigModal: React.FC<LLMConfigModalProps> = ({ visible, onClose }) => {
  const [modalVisible, setModalVisible] = useState(visible || false);
  const [formVisible, setFormVisible] = useState(false);
  const [editingConfig, setEditingConfig] = useState<LLMGlobalConfig | null>(null);
  const [form] = Form.useForm();
  const [modelList,setModelList]=useState<string[]>([]);
  const [discovering,setDiscovering]=useState(false);
  const [discoveryError,setDiscoveryError]=useState('');
  const modelGeneration=useRef(0);
  const apiUrl=Form.useWatch('apiUrl',form),apiKey=Form.useWatch('apiKey',form);
  useEffect(()=>{const generation=++modelGeneration.current;setModelList([]);setDiscoveryError('');setDiscovering(false);if(!formVisible||!apiUrl||!apiKey)return;let current=true;const timer=setTimeout(()=>{setDiscovering(true);research.discover({apiUrl,apiKey}).then(r=>{if(current&&generation===modelGeneration.current)setModelList(r.models);}).catch(e=>{if(current&&generation===modelGeneration.current)setDiscoveryError(errorText(e));}).finally(()=>{if(current&&generation===modelGeneration.current)setDiscovering(false);});},650);return()=>{current=false;clearTimeout(timer);};},[apiUrl,apiKey,formVisible]);
  const discoverModels=async()=>{const generation=++modelGeneration.current;setDiscovering(true);setDiscoveryError('');setModelList([]);try{const r=await research.discover({apiUrl:form.getFieldValue('apiUrl'),apiKey:form.getFieldValue('apiKey')});if(generation===modelGeneration.current)setModelList(r.models);}catch(e){if(generation===modelGeneration.current)setDiscoveryError(errorText(e));}finally{if(generation===modelGeneration.current)setDiscovering(false);}};
  const [testingId,setTestingId]=useState<number|null>(null);
  const [connectionResult,setConnectionResult]=useState<Record<string,unknown>|null>(null);
  const testConnection = async (id: number) => {
    setTestingId(id);
    try { setConnectionResult(await research.test(id)); }
    catch (error) { message.error(errorText(error)); }
    finally { setTestingId(null); }
  };

  const {
    configs,
    loading,
    error,
    fetchAllConfigs,
    saveConfig,
    deleteConfig,
    clearError
  } = useLLMConfigStore();

  const providerOptions = Array.from(
    new Map(
      [...PROVIDERS, ...configs.map((config) => ({
        value: normalizeProviderKey(config.provider),
        label: getProviderLabel(config.provider)
      }))]
        .map((item) => [normalizeProviderKey(item.value), item])
    ).values()
  ).map((item) => ({
    value: normalizeProviderKey(item.value),
    label: item.label
  }));

  useEffect(() => {
    if (modalVisible) {
      fetchAllConfigs();
    }
  }, [modalVisible,fetchAllConfigs]);

  useEffect(() => {
    if (visible !== undefined) {
      setModalVisible(visible);
    }
  }, [visible]);

  useEffect(() => {
    if (error) {
      message.error(error);
      clearError();
    }
  }, [error,clearError]);

  const handleOpenModal = () => {
    setModalVisible(true);
  };

  const handleCloseModal = () => {
    setModalVisible(false);
    setFormVisible(false);
    setEditingConfig(null);
    form.resetFields();
    onClose?.();
  };

  const handleOpenForm = (config?: LLMGlobalConfig) => {
    setEditingConfig(config || null);
    setFormVisible(true);
    if (config) {
      form.setFieldsValue({
        configName: config.configName,
        provider: config.provider,
        apiUrl: config.apiUrl,
        apiKey: config.apiKey,
        model: config.model
      });
    } else {
      form.resetFields();
    }
  };

  const handleCloseForm = () => {
    setFormVisible(false);
    setEditingConfig(null);
    form.resetFields();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const provider = normalizeProviderKey(values.provider);
      const request: LLMConfigRequest = {
        id: editingConfig?.id,
        provider,
        configName: values.configName.trim(),
        apiUrl: values.apiUrl,
        apiKey: values.apiKey,
        model: values.model,
        ttsModel: editingConfig?.ttsModel,
        embeddingModel: editingConfig?.embeddingModel,
        imageModel: editingConfig?.imageModel,
        videoModel: editingConfig?.videoModel,
        memoryEnabled: editingConfig?.memoryEnabled ?? 0
      };

      const result = await saveConfig(request);
      if (result) {
        message.success(editingConfig ? '配置已更新' : '配置已创建');
        handleCloseForm();
      }
    } catch (error) {
      console.error('Form validation failed:', error);
    }
  };

  const handleDelete = async (id: number) => {
    const success = await deleteConfig(id);
    if (success) {
      message.success('配置已删除');
    }
  };

  const columns = [
    {
      title: '提供商',
      dataIndex: 'provider',
      key: 'provider',
      ellipsis: true,
      width: 88,
      render: (provider: string) => {
        return getProviderLabel(provider);
      }
    },
    {
      title: '端口名称',
      dataIndex: 'configName',
      key: 'configName',
      ellipsis: true,
      width: 170
    },
    {
      title: 'API 地址',
      dataIndex: 'apiUrl',
      key: 'apiUrl',
      ellipsis: true,
      width: 210
    },
    {
      title: '模型',
      dataIndex: 'model',
      key: 'model',
      width: 170
    },
    {
      title: '操作',
      key: 'action',
      width: 185,
      render: (_: unknown, record: LLMGlobalConfig) => (
        <Space size="small">
          <Button type="link" size="small" loading={testingId === record.id} onClick={() => testConnection(record.id)}>测试连接</Button>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleOpenForm(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定要删除此配置吗？"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <>
      <Modal title="模型实际调用测试" open={!!connectionResult} onCancel={() => setConnectionResult(null)} footer={<Button onClick={() => setConnectionResult(null)}>关闭</Button>}>
        {connectionResult && <>
          <Alert type={connectionResult.callSucceeded ? 'success' : 'error'} message={connectionResult.callSucceeded ? '模型实际调用成功' : '模型调用失败'} />
          <p>模型：{String(connectionResult.model)} · 耗时：{String(connectionResult.elapsedMs)}ms</p>
          <p>服务连接：{connectionResult.connected ? '通过' : '失败'} · 结构化输出：{connectionResult.structuredOutput ? '通过' : '待修复'}</p>
          <pre style={{whiteSpace:'pre-wrap'}}>{String(connectionResult.reply || connectionResult.error || '')}</pre>
        </>}
      </Modal>
      {visible === undefined && (
        <Button
          icon={<SettingOutlined />}
          onClick={handleOpenModal}
          title="模型配置管理"
        >
          模型管理
        </Button>
      )}

      <Modal
        title="全局模型配置管理"
        open={modalVisible}
        onCancel={handleCloseModal}
        footer={null}
        width={960}
        style={{ maxWidth: 'calc(100vw - 32px)' }}
      >
        <div className="mb-4">
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => handleOpenForm()}
          >
            新增配置
          </Button>
          <div className="text-xs text-gray-500 mt-2">
            每条配置保存服务地址、密钥和默认模型。点击“测试连接”验证实际调用。
          </div>
        </div>

        <Table
          columns={columns}
          dataSource={configs}
          rowKey="id"
          loading={loading}
          pagination={false}
          size="small"
          tableLayout="fixed"
          scroll={{ x: 840 }}
        />

        <Modal
          title={editingConfig ? '编辑配置' : '新增配置'}
          open={formVisible}
          onCancel={handleCloseForm}
          onOk={handleSubmit}
          confirmLoading={loading}
          okText="保存"
          cancelText="取消"
          width={720}
        >
          <Form
            form={form}
            layout="vertical"
            autoComplete="off"
          >
            <Form.Item
              name="configName"
              label="端口名称"
              rules={[
                { required: true, message: '请输入端口名称' },
                { max: 100, message: '端口名称最多 100 个字符' },
                {
                  validator: (_, value) =>
                    typeof value === 'string' && value.trim()
                      ? Promise.resolve()
                      : Promise.reject(new Error('请输入端口名称'))
                }
              ]}
              extra="例如：本地网关8317 → 本地网关8317.gpt-6.1-sol"
            >
              <Input maxLength={100} placeholder="例如：本地网关8317" />
            </Form.Item>

            <Form.Item
              name="provider"
              label="提供商"
              rules={[
                { required: true, message: '请输入或选择提供商' },
                {
                  validator: (_, value) =>
                    value?.trim()
                      ? Promise.resolve()
                      : Promise.reject(new Error('请输入或选择提供商'))
                }
              ]}
              extra="支持直接手填，也可以从已有供应商中选择。"
            >
              <AutoComplete
                placeholder="请输入或选择提供商"
                options={providerOptions}
                disabled={!!editingConfig}
                filterOption={(inputValue, option) =>
                  (option?.value ?? '').toLowerCase().includes(inputValue.toLowerCase()) ||
                  String(option?.label ?? '').toLowerCase().includes(inputValue.toLowerCase())
                }
              />
            </Form.Item>

            <Form.Item
              name="apiUrl"
              label="API 地址"
              rules={[{ required: true, message: '请输入 API 地址' }]}
            >
              <Input placeholder="例如: https://api.openai.com, https://api.stepfun.com/v1" />
            </Form.Item>

            <Form.Item
              name="apiKey"
              label="API 密钥"
              rules={[{ required: true, message: '请输入 API 密钥' }]}
            >
              <Input.Password placeholder="输入 API 密钥" />
            </Form.Item>

            <Form.Item
              name="model"
              label="默认 LLM 模型"
              rules={[{ required: true, message: '请从服务返回的模型中选择' },{validator:(_,value)=>modelList.includes(value)?Promise.resolve():Promise.reject(new Error('请刷新模型列表并选择服务当前提供的模型'))}]}
            >
              <Select showSearch loading={discovering} options={modelList.map(value=>({value,label:value}))} placeholder="从当前端口的模型列表选择" />
            </Form.Item>

            <Space><Button loading={discovering} onClick={discoverModels}>刷新实际模型列表</Button><span>{modelList.length?`已发现 ${modelList.length} 个模型`:''}</span></Space>
            {discoveryError&&<Alert style={{marginTop:12}} type="error" message={discoveryError}/>}
          </Form>
        </Modal>
      </Modal>
    </>
  );
};

export default LLMConfigModal;
