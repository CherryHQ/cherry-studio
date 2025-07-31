import { FolderOpenOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import type { AgentResponse, SessionResponse } from '@types'
import { Button, Form, Input, Modal, Select } from 'antd'
import { FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('SessionManagementModal')

interface SessionManagementModalProps {
  visible: boolean
  onClose: () => void
  onSave: (session: SessionResponse) => void
  session?: SessionResponse | null // null for create, SessionResponse for edit
  agents: AgentResponse[]
  loading?: boolean
  currentWorkingDirectory?: string
}

const SessionManagementModal: FC<SessionManagementModalProps> = ({
  visible,
  onClose,
  onSave,
  session,
  agents,
  loading = false,
  currentWorkingDirectory = '/Users/weliu'
}) => {
  const { t } = useTranslation()
  // loading parameter is reserved for future loading state implementation
  void loading
  const [form] = Form.useForm()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])

  const isEditMode = Boolean(session)
  const modalTitle = isEditMode
    ? t('session.modal.edit.title', 'Edit Session')
    : t('session.modal.create.title', 'Create New Session')

  // Initialize form when session changes
  useEffect(() => {
    if (visible) {
      if (isEditMode && session) {
        form.setFieldsValue({
          user_prompt: session.user_prompt || '',
          agent_ids: session.agent_ids || [],
          status: session.status || 'idle'
        })
        setSelectedPaths(session.accessible_paths || [])
      } else {
        form.resetFields()
        setSelectedPaths([currentWorkingDirectory])
        // Set default values for new session
        form.setFieldsValue({
          user_prompt: '',
          agent_ids: agents.length > 0 ? [agents[0].id] : [],
          status: 'idle'
        })
      }
    }
  }, [visible, session, isEditMode, form, agents, currentWorkingDirectory])

  const handleOk = async () => {
    try {
      setIsSubmitting(true)
      const values = await form.validateFields()

      const sessionData = {
        user_prompt: values.user_prompt || 'New session',
        agent_ids: values.agent_ids || [],
        status: values.status || 'idle',
        accessible_paths: selectedPaths
      }

      let result: SessionResponse | null = null

      if (isEditMode && session) {
        // Update existing session
        // Update existing session - no need to store input locally
        // const updateInput: UpdateSessionInput = {
        //   id: session.id,
        //   ...sessionData
        // }

        result = await new Promise<SessionResponse | null>((resolve) => {
          // Mock the update - in real implementation, this would call the API
          const updatedSession: SessionResponse = {
            ...session,
            ...sessionData,
            updated_at: new Date().toISOString()
          }
          onSave(updatedSession)
          resolve(updatedSession)
        })
      } else {
        // Create new session - no need to store input locally
        // const createInput: CreateSessionInput = sessionData

        result = await new Promise<SessionResponse | null>((resolve) => {
          // Mock the creation - in real implementation, this would call the API
          const newSession: SessionResponse = {
            id: crypto.randomUUID(),
            ...sessionData,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
          onSave(newSession)
          resolve(newSession)
        })
      }

      if (result) {
        handleCancel() // Close modal and reset form
      }
    } catch (error) {
      logger.error('Failed to save session:', error as Error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = () => {
    form.resetFields()
    setSelectedPaths([])
    setIsSubmitting(false)
    onClose()
  }

  const handleAddPath = useCallback(async () => {
    try {
      const selectedPath = await window.api.file.selectFolder()
      if (selectedPath && !selectedPaths.includes(selectedPath)) {
        setSelectedPaths((prev) => [...prev, selectedPath])
      }
    } catch (error) {
      logger.error('Failed to select directory:', error as Error)
    }
  }, [selectedPaths])

  const handleRemovePath = useCallback((pathToRemove: string) => {
    setSelectedPaths((prev) => prev.filter((path) => path !== pathToRemove))
  }, [])

  // Agent options for the select
  const agentOptions = agents.map((agent) => ({
    value: agent.id,
    label: agent.name,
    disabled: false
  }))

  const statusOptions = [
    { value: 'idle', label: t('session.status.idle', 'Idle') },
    { value: 'running', label: t('session.status.running', 'Running') },
    { value: 'completed', label: t('session.status.completed', 'Completed') },
    { value: 'failed', label: t('session.status.failed', 'Failed') },
    { value: 'stopped', label: t('session.status.stopped', 'Stopped') }
  ]

  return (
    <StyledModal
      title={modalTitle}
      open={visible}
      onOk={handleOk}
      onCancel={handleCancel}
      destroyOnClose
      centered
      width={550}
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
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          label={t('session.modal.prompt', 'Session Goal/Prompt')}
          name="user_prompt"
          rules={[
            {
              required: true,
              message: t('session.modal.prompt.required', 'Please enter a session goal or prompt')
            },
            {
              max: 200,
              message: t('session.modal.prompt.maxLength', 'Prompt cannot exceed 200 characters')
            }
          ]}>
          <Input.TextArea
            placeholder={t(
              'session.modal.prompt.placeholder',
              'Describe what you want to accomplish in this session...'
            )}
            rows={3}
            showCount
            maxLength={200}
          />
        </Form.Item>

        <Form.Item
          label={t('session.modal.agents', 'Assigned Agents')}
          name="agent_ids"
          rules={[
            {
              required: true,
              message: t('session.modal.agents.required', 'Please select at least one agent')
            }
          ]}>
          <Select
            mode="multiple"
            placeholder={t('session.modal.agents.placeholder', 'Select agents for this session')}
            options={agentOptions}
            maxTagCount="responsive"
            disabled={agents.length === 0}
            notFoundContent={
              agents.length === 0 ? t('session.modal.agents.noAgents', 'No agents available') : undefined
            }
          />
        </Form.Item>

        {isEditMode && (
          <Form.Item label={t('session.modal.status', 'Status')} name="status">
            <Select
              placeholder={t('session.modal.status.placeholder', 'Select session status')}
              options={statusOptions}
            />
          </Form.Item>
        )}

        <Form.Item
          label={t('session.modal.paths', 'Accessible Directories')}
          tooltip={t('session.modal.paths.tooltip', 'Directories that agents can access during this session')}>
          <PathsContainer>
            {selectedPaths.map((path, index) => (
              <PathItem key={index}>
                <PathText>{path}</PathText>
                <Button
                  type="text"
                  size="small"
                  onClick={() => handleRemovePath(path)}
                  style={{ color: 'var(--color-error)' }}>
                  Remove
                </Button>
              </PathItem>
            ))}
            <Button
              type="dashed"
              icon={<FolderOpenOutlined />}
              onClick={handleAddPath}
              style={{ width: '100%', marginTop: selectedPaths.length > 0 ? 8 : 0 }}>
              {t('session.modal.addPath', 'Add Directory')}
            </Button>
          </PathsContainer>
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

const PathsContainer = styled.div`
  min-height: 40px;
`

const PathItem = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background-color: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  margin-bottom: 8px;

  &:last-child {
    margin-bottom: 0;
  }
`

const PathText = styled.span`
  font-family: 'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace;
  font-size: 12px;
  color: var(--color-text);
  flex: 1;
  margin-right: 12px;
  word-break: break-all;
`

export default SessionManagementModal
