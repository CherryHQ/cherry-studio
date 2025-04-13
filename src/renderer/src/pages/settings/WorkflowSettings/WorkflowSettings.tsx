import { CheckOutlined, DeleteOutlined, LoadingOutlined, SaveOutlined } from '@ant-design/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useWorkflowProvider } from '@renderer/hooks/useWorkflowProvider'
import { checkWorkflowApi, getParameters } from '@renderer/services/WorkflowService'
import { FlowConfig } from '@renderer/types'
import { Button, Flex, Form, Input, Switch } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDivider, SettingGroup, SettingTitle } from '..'

interface Props {
  workflow: FlowConfig
}

interface WorkflowFormValues {
  name: string
  description?: string
  apiKey: string
  apiHost: string
  enabled: boolean
}
const WorkflowSettings: FC<Props> = ({ workflow: _workflow }) => {
  const { workflowProvider } = useWorkflowProvider(_workflow.providerId)
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [form] = Form.useForm<WorkflowFormValues>()
  const [workflow, setWorkflow] = useState<FlowConfig>(_workflow)
  const [apiValid, setApiValid] = useState(false)
  const [apiChecking, setApiChecking] = useState(false)
  const { updateWorkflow, removeWorkflow } = useWorkflowProvider(workflow.providerId)

  const onCheckApi = async () => {
    try {
      setApiChecking(true)
      const { valid, error } = await checkWorkflowApi(workflowProvider, workflow)
      console.log('API check result', valid, error)
      setApiValid(valid)
      if (!valid) {
        const errorMessage = error && error?.message ? ' ' + error?.message : ''
        window.message.error({ content: errorMessage, key: 'workflow-list' })
      }
      setApiChecking(false)

      const response = await getParameters(workflowProvider, workflow)
    } catch (error) {
      console.error('Error checking API', error)
      window.message.error({ content: t('settings.workflow.checkApiError'), key: 'workflow-list' })
    }
    setTimeout(() => setApiValid(false), 3000)
  }

  const onSave = () => {
    try {
      const values = form.getFieldsValue()
      console.log('Saving workflow settings', values)
      const newWorkflow: FlowConfig = {
        ...workflow,
        name: values.name,
        description: values.description,
        apiKey: values.apiKey,
        apiHost: values.apiHost,
        enabled: values.enabled
      }
      updateWorkflow(newWorkflow)
      window.message.success({ content: t('settings.workflow.saveSuccess'), key: 'workflow-list' })
    } catch (error) {
      console.error('Error saving workflow settings', error)
      window.message.error({ content: t('settings.workflow.saveError'), key: 'workflow-list' })
    }
  }

  const onDelete = useCallback(() => {
    try {
      window.modal.confirm({
        title: t('settings.workflow.deleteConfirm'),
        onOk: () => {
          removeWorkflow(workflow)
          window.message.success({ content: t('settings.workflow.deleteSuccess'), key: 'workflow-list' })
        }
      })
    } catch (error) {
      console.error('Error deleting workflow', error)
      window.message.error({ content: t('settings.workflow.deleteError'), key: 'workflow-list' })
    }
  }, [workflow, removeWorkflow, t])

  useEffect(() => {
    console.log('WorkflowSettings useEffect', workflow)
    form.setFieldsValue({
      name: workflow.name,
      description: workflow.description,
      apiKey: workflow.apiKey,
      apiHost: workflow.apiHost,
      enabled: workflow.enabled
    })
  }, [workflow, form])

  return (
    <SettingContainer theme={theme} style={{ background: 'var(--color-background)' }}>
      <SettingGroup style={{ marginBottom: 0 }}>
        <SettingTitle>
          <Flex justify="space-between" align="center" gap={5} style={{ marginRight: 10 }}>
            <WorkflowName className="text-nowrap">{workflow?.name}</WorkflowName>
            <Button danger icon={<DeleteOutlined />} type="text" onClick={onDelete} />
          </Flex>
          <Flex align="center" gap={16}>
            <Switch
              checked={workflow.enabled}
              onChange={(checked) => {
                setWorkflow({
                  ...workflow,
                  enabled: checked
                })
                updateWorkflow({ ...workflow, enabled: checked })
              }}
            />
            <Button
              type={apiValid ? 'primary' : 'default'}
              ghost={apiValid}
              onClick={onCheckApi}
              disabled={!workflow.apiHost || apiChecking}>
              {apiChecking ? <LoadingOutlined spin /> : apiValid ? <CheckOutlined /> : t('settings.provider.check')}
            </Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={onSave}>
              {t('common.save')}
            </Button>
          </Flex>
        </SettingTitle>
        <SettingDivider />
        <Form
          form={form}
          layout="vertical"
          style={{
            overflowY: 'auto',
            width: 'calc(100% + 10px)',
            paddingRight: '10px'
          }}>
          <Form.Item name="name" label={t('settings.workflow.name')} rules={[{ required: true, message: '' }]}>
            <Input
              placeholder={t('common.name')}
              onChange={(e) =>
                setWorkflow({
                  ...workflow,
                  name: e.target.value
                })
              }
            />
          </Form.Item>
          <Form.Item name="description" label={t('settings.workflow.description')}>
            <TextArea
              rows={2}
              placeholder={t('common.description')}
              onChange={(e) =>
                setWorkflow({
                  ...workflow,
                  description: e.target.value
                })
              }
            />
          </Form.Item>
          <Form.Item name="apiKey" label={t('settings.workflow.apiKey')} rules={[{ required: true, message: '' }]}>
            <Input.Password
              placeholder={t('settings.workflow.apiKey')}
              onChange={(e) => setWorkflow({ ...workflow, apiKey: e.target.value })}
            />
          </Form.Item>
          <Form.Item name="apiHost" label={t('settings.workflow.apiHost')} rules={[{ required: true, message: '' }]}>
            <Input
              placeholder={t('settings.workflow.apiHost')}
              onChange={(e) => setWorkflow({ ...workflow, apiHost: e.target.value })}
            />
          </Form.Item>
        </Form>
      </SettingGroup>
    </SettingContainer>
  )
}

const WorkflowName = styled.span`
  font-size: 14px;
  font-weight: 500;
`

export default WorkflowSettings
