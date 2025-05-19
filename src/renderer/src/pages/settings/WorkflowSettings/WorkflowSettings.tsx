import { DeleteOutlined, LoadingOutlined, SaveOutlined } from '@ant-design/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useFlowEngineProvider } from '@renderer/hooks/useFlowEngineProvider'
import { check, getAppParameters } from '@renderer/services/FlowEngineService'
import { Flow, FlowType } from '@renderer/types'
import type { RadioChangeEvent } from 'antd'
import { Button, Flex, Form, Input, Radio } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDivider, SettingGroup, SettingTitle } from '..'

interface Props {
  flow: Flow
}

interface WorkflowFormValues {
  name: string
  trigger: string
  description?: string
  apiKey: string
  apiHost: string
  type: FlowType
}

const WorkflowSettings: FC<Props> = ({ flow: _flow }) => {
  const { flowEngineProvider } = useFlowEngineProvider(_flow.providerId)
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [form] = Form.useForm<WorkflowFormValues>()
  const [flow, setFlow] = useState<Flow>(_flow)
  const [apiChecking, setApiChecking] = useState(false)
  const { updateFlow, removeFlow } = useFlowEngineProvider(flow.providerId)
  const [flowType, setFlowType] = useState<FlowType>(flow.type)

  const onSave = async (): Promise<boolean> => {
    try {
      await form.validateFields()
      const values = form.getFieldsValue()

      const newWorkflow: Flow = {
        ...flow,
        name: values.name,
        trigger: values.trigger || '',
        description: values.description,
        apiKey: values.apiKey || '',
        apiHost: values.apiHost || '',
        type: flowType
      }

      setFlow(newWorkflow)
      await updateFlow(newWorkflow)

      window.message.success({ content: t('settings.workflow.saveSuccess'), key: 'flow-list' })

      if (newWorkflow.apiHost && newWorkflow.apiKey) {
        setApiChecking(true)
        try {
          const { valid, error } = await check(flowEngineProvider, newWorkflow)

          if (valid) {
            await getParameters()
            window.message.success({ content: t('settings.workflow.checkSuccess'), key: 'flow-list' })
          } else {
            const errorMessage = error?.message ? ` ${error.message}` : ''
            window.message.error({ content: t('settings.workflow.checkError') + errorMessage, key: 'flow-list' })
          }
        } catch (checkError) {
          console.error('Error checking API after save:', checkError)
          window.message.error({ content: t('settings.workflow.checkError'), key: 'flow-list' })
        } finally {
          setApiChecking(false)
        }
      }
      return true
    } catch (errorInfo: any) {
      console.error('Error saving workflow settings:', errorInfo)
      const isValidationError = errorInfo.errorFields?.length > 0
      window.message.error({
        content: t(isValidationError ? 'common.formValidationError' : 'settings.workflow.saveError'),
        key: 'flow-list'
      })
      return false
    }
  }

  const getParameters = async () => {
    const parameters = await getAppParameters(flowEngineProvider, flow)
    const updatedFlow = { ...flow, parameters }
    setFlow(updatedFlow)
    updateFlow(updatedFlow)
  }

  const onDelete = useCallback(() => {
    window.modal.confirm({
      title: t('settings.workflow.deleteConfirm'),
      onOk: () => {
        removeFlow(flow)
        window.message.success({ content: t('settings.workflow.deleteSuccess'), key: 'flow-list' })
      }
    })
  }, [flow, removeFlow, t])

  const handleTypeChange = (e: RadioChangeEvent) => {
    setFlowType(e.target.value as FlowType)
  }

  useEffect(() => {
    form.setFieldsValue({
      name: flow.name,
      trigger: flow.trigger,
      description: flow.description,
      apiKey: flow.apiKey,
      apiHost: flow.apiHost,
      type: flow.type
    })
  }, [flow, form])

  const isCheckDisabled =
    apiChecking || !((form.getFieldValue('apiHost') || flow.apiHost) && (form.getFieldValue('apiKey') || flow.apiKey))

  return (
    <SettingContainer theme={theme} style={{ background: 'var(--color-background)' }}>
      <SettingGroup style={{ marginBottom: 0 }}>
        <SettingTitle>
          <Flex justify="space-between" align="center" gap={5} style={{ marginRight: 10 }}>
            <WorkflowName className="text-nowrap">{flow?.name}</WorkflowName>
            <Button danger icon={<DeleteOutlined />} type="text" onClick={onDelete} />
          </Flex>
          <Flex align="center" gap={16}>
            <Button type="primary" onClick={onSave} disabled={isCheckDisabled}>
              {apiChecking ? (
                <LoadingOutlined spin />
              ) : (
                <>
                  <SaveOutlined /> <span>{t('common.save')}</span>
                </>
              )}
            </Button>
          </Flex>
        </SettingTitle>
        <SettingDivider />
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            ...flow,
            type: flow.type
          }}
          style={{
            overflowY: 'auto',
            width: 'calc(100% + 10px)',
            paddingRight: '10px'
          }}>
          <Form.Item name="name" label={t('settings.workflow.name')} rules={[{ required: true, message: '' }]}>
            <Input placeholder={t('common.name')} />
          </Form.Item>

          <Form.Item
            name="trigger"
            label={t('settings.workflow.trigger')}
            rules={[{ required: true }]}
            tooltip={t('settings.workflow.triggerTooltip')}>
            <Input placeholder={t('settings.workflow.trigger')} />
          </Form.Item>

          <Form.Item name="description" label={t('settings.workflow.description')}>
            <TextArea rows={2} placeholder={t('common.description')} />
          </Form.Item>

          <Form.Item name="type" label={t('settings.workflow.type')}>
            <Radio.Group onChange={handleTypeChange} value={flowType}>
              <Radio value="workflow">{t('settings.workflow.workflow')}</Radio>
              <Radio value="chatflow">{t('settings.workflow.chatflow')}</Radio>
            </Radio.Group>
          </Form.Item>

          <Form.Item name="apiKey" label={t('settings.workflow.apiKey')} rules={[{ required: true, message: '' }]}>
            <Input.Password placeholder={t('settings.workflow.apiKey')} />
          </Form.Item>
          <Form.Item name="apiHost" label={t('settings.workflow.apiHost')} rules={[{ required: true, message: '' }]}>
            <Input placeholder={t('settings.workflow.apiHost')} />
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
