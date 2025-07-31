import { UserOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import type { AgentResponse } from '@types'
import { Form, Input, Modal, Select, Space, Upload } from 'antd'
import { FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('AgentManagementModal')

interface AgentManagementModalProps {
  visible: boolean
  onClose: () => void
  onSave: (agent: AgentResponse) => void
  agent?: AgentResponse | null // null for create, AgentResponse for edit
  loading?: boolean
}

// Common model options based on the models.ts file
const MODEL_OPTIONS = [
  // Popular models from different providers
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
  { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  { value: 'deepseek-chat', label: 'DeepSeek Chat' },
  { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
  { value: 'qwen2.5-72b-instruct', label: 'Qwen 2.5 72B' },
  { value: 'moonshot-v1-auto', label: 'Moonshot V1 Auto' },
  { value: 'yi-lightning', label: 'Yi Lightning' },
  { value: 'glm-4.5', label: 'GLM-4.5' },
  { value: 'hunyuan-pro', label: 'Hunyuan Pro' },
  { value: 'doubao-pro-32k-241215', label: 'Doubao Pro 32K' },
  { value: 'abab6.5s-chat', label: 'Minimax ABAB 6.5s' },
  { value: 'step-1-8k', label: 'Step 1 8K' },
  { value: 'grok-2-1212', label: 'Grok 2' },
  { value: 'llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
  { value: 'mistral-large-latest', label: 'Mistral Large' }
]

// Common tools that can be enabled for agents
const TOOL_OPTIONS = [
  { value: 'web_search', label: 'Web Search' },
  { value: 'code_interpreter', label: 'Code Interpreter' },
  { value: 'file_search', label: 'File Search' },
  { value: 'dall_e', label: 'DALL·E Image Generation' },
  { value: 'python_execution', label: 'Python Execution' },
  { value: 'browser_automation', label: 'Browser Automation' },
  { value: 'api_calls', label: 'API Calls' },
  { value: 'document_analysis', label: 'Document Analysis' }
]

const AgentManagementModal: FC<AgentManagementModalProps> = ({ visible, onClose, onSave, agent, loading = false }) => {
  const { t } = useTranslation()
  // loading parameter is reserved for future loading state implementation
  void loading
  const [form] = Form.useForm()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string>('')

  const isEditMode = Boolean(agent)
  const modalTitle = isEditMode
    ? t('agent.modal.edit.title', 'Edit Agent')
    : t('agent.modal.create.title', 'Create Agent')

  // Initialize form when agent changes
  useEffect(() => {
    if (visible) {
      if (isEditMode && agent) {
        form.setFieldsValue({
          name: agent.name,
          description: agent.description || '',
          instructions: agent.instructions || '',
          model: agent.model,
          tools: agent.tools || [],
          knowledges: agent.knowledges || []
        })
        setAvatarUrl(agent.avatar || '')
      } else {
        form.resetFields()
        setAvatarUrl('')
      }
    }
  }, [visible, agent, isEditMode, form])

  const handleOk = async () => {
    try {
      setIsSubmitting(true)
      const values = await form.validateFields()

      const agentData = {
        name: values.name,
        description: values.description || '',
        avatar: avatarUrl || '',
        instructions: values.instructions || '',
        model: values.model,
        tools: values.tools || [],
        knowledges: values.knowledges || [],
        configuration: {}
      }

      let result: AgentResponse | null = null

      if (isEditMode && agent) {
        // Update existing agent
        // Update existing agent - no need to store input locally
        // const updateInput: UpdateAgentInput = {
        //   id: agent.id,
        //   ...agentData
        // }

        // Call parent's save handler - it should handle the API call
        result = await new Promise<AgentResponse | null>((resolve) => {
          // This is a bit of a hack - we need to modify the parent interface
          // For now, we'll assume onSave handles the API call and returns the result
          onSave(agentData as AgentResponse)
          resolve(agentData as AgentResponse) // Mock return
        })
      } else {
        // Create new agent - no need to store input locally
        // const createInput: CreateAgentInput = agentData

        // Call parent's save handler
        result = await new Promise<AgentResponse | null>((resolve) => {
          onSave(agentData as AgentResponse)
          resolve(agentData as AgentResponse) // Mock return
        })
      }

      if (result) {
        handleCancel() // Close modal and reset form
      }
    } catch (error) {
      logger.error('Failed to save agent:', error as Error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = () => {
    form.resetFields()
    setAvatarUrl('')
    setIsSubmitting(false)
    onClose()
  }

  const handleAvatarChange = useCallback((info: any) => {
    if (info.file.status === 'done') {
      // In a real app, you'd upload the file and get a URL back
      // For now, we'll just use a placeholder or file URL
      const url = info.file.response?.url || URL.createObjectURL(info.file.originFileObj)
      setAvatarUrl(url)
    }
  }, [])

  return (
    <StyledModal
      title={modalTitle}
      open={visible}
      onOk={handleOk}
      onCancel={handleCancel}
      destroyOnClose
      centered
      width={600}
      confirmLoading={isSubmitting}
      okText={isEditMode ? t('common.save', 'Save') : t('common.create', 'Create')}
      cancelText={t('common.cancel', 'Cancel')}
      styles={{
        header: {
          borderBottom: '0.5px solid var(--color-border)',
          paddingBottom: 16,
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0
        },
        body: {
          paddingTop: 24,
          maxHeight: '70vh',
          overflowY: 'auto'
        }
      }}>
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{
          name: '',
          description: '',
          instructions: '',
          model: 'gpt-4o',
          tools: [],
          knowledges: []
        }}>
        {/* Basic Information Section */}
        <SectionTitle>{t('agent.modal.section.basic', 'Basic Information')}</SectionTitle>

        <Space direction="horizontal" size={24} style={{ width: '100%', alignItems: 'flex-start' }}>
          <AvatarSection>
            <Form.Item label={t('agent.modal.avatar', 'Avatar')}>
              <Upload
                name="avatar"
                listType="picture-circle"
                className="avatar-uploader"
                showUploadList={false}
                onChange={handleAvatarChange}
                beforeUpload={() => false} // Prevent auto upload
              >
                {avatarUrl ? (
                  <AvatarImage src={avatarUrl} alt="avatar" />
                ) : (
                  <AvatarPlaceholder>
                    <UserOutlined style={{ fontSize: 24, color: 'var(--color-text-tertiary)' }} />
                    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                      {t('agent.modal.avatar.upload', 'Upload')}
                    </div>
                  </AvatarPlaceholder>
                )}
              </Upload>
            </Form.Item>
          </AvatarSection>

          <FormFieldsSection>
            <Form.Item
              label={t('agent.modal.name', 'Agent Name')}
              name="name"
              rules={[
                {
                  required: true,
                  message: t('agent.modal.name.required', 'Please enter agent name')
                },
                {
                  max: 50,
                  message: t('agent.modal.name.maxLength', 'Agent name cannot exceed 50 characters')
                }
              ]}>
              <Input
                placeholder={t('agent.modal.name.placeholder', 'Enter a name for your agent')}
                showCount
                maxLength={50}
              />
            </Form.Item>

            <Form.Item label={t('agent.modal.description', 'Description')} name="description">
              <Input.TextArea
                placeholder={t('agent.modal.description.placeholder', 'Brief description of what this agent does')}
                rows={2}
                showCount
                maxLength={200}
              />
            </Form.Item>
          </FormFieldsSection>
        </Space>

        {/* Configuration Section */}
        <SectionTitle style={{ marginTop: 24 }}>{t('agent.modal.section.configuration', 'Configuration')}</SectionTitle>

        <Form.Item
          label={t('agent.modal.model', 'Language Model')}
          name="model"
          rules={[
            {
              required: true,
              message: t('agent.modal.model.required', 'Please select a language model')
            }
          ]}>
          <Select
            placeholder={t('agent.modal.model.placeholder', 'Select a language model')}
            showSearch
            optionFilterProp="label"
            options={MODEL_OPTIONS}
          />
        </Form.Item>

        <Form.Item
          label={t('agent.modal.instructions', 'System Instructions')}
          name="instructions"
          tooltip={t(
            'agent.modal.instructions.tooltip',
            'These instructions guide how the agent behaves and responds'
          )}>
          <Input.TextArea
            placeholder={t('agent.modal.instructions.placeholder', 'You are a helpful assistant that...')}
            rows={4}
            showCount
            maxLength={2000}
          />
        </Form.Item>

        {/* Capabilities Section */}
        <SectionTitle style={{ marginTop: 24 }}>{t('agent.modal.section.capabilities', 'Capabilities')}</SectionTitle>

        <Form.Item
          label={t('agent.modal.tools', 'Available Tools')}
          name="tools"
          tooltip={t('agent.modal.tools.tooltip', 'Select tools that this agent can use')}>
          <Select
            mode="multiple"
            placeholder={t('agent.modal.tools.placeholder', 'Select tools for your agent')}
            options={TOOL_OPTIONS}
            maxTagCount="responsive"
          />
        </Form.Item>

        <Form.Item
          label={t('agent.modal.knowledges', 'Knowledge Bases')}
          name="knowledges"
          tooltip={t('agent.modal.knowledges.tooltip', 'Select knowledge bases this agent can access')}>
          <Select
            mode="multiple"
            placeholder={t('agent.modal.knowledges.placeholder', 'Select knowledge bases (optional)')}
            options={[]} // This would be populated from actual knowledge bases
            maxTagCount="responsive"
          />
        </Form.Item>
      </Form>
    </StyledModal>
  )
}

const StyledModal = styled(Modal)`
  .ant-modal-title {
    font-size: 16px;
    font-weight: 600;
  }

  .ant-modal-close {
    top: 16px;
    right: 16px;
  }
`

const SectionTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-border);
`

const AvatarSection = styled.div`
  flex-shrink: 0;

  .ant-upload-circle {
    width: 80px !important;
    height: 80px !important;
  }
`

const FormFieldsSection = styled.div`
  flex: 1;
  min-width: 0;
`

const AvatarImage = styled.img`
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
`

const AvatarPlaceholder = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  cursor: pointer;
  transition: all 0.3s;

  &:hover {
    color: var(--color-primary);
  }
`

export default AgentManagementModal
