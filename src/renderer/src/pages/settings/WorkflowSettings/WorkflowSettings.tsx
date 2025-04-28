import { DeleteOutlined, LoadingOutlined, SaveOutlined } from '@ant-design/icons'
import { getFlowEngineProviderLogo } from '@renderer/config/workflowProviders'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useFlowEngineProvider } from '@renderer/hooks/useFlowEngineProvider'
import { check } from '@renderer/services/FlowEngineService'
// Import FlowType and update FlowConfig import if necessary
import { Chatflow, Flow, FlowType, Workflow } from '@renderer/types' // Import WorkflowSpecificConfig
import { Button, Flex, Form, Input, Radio, Switch } from 'antd' // Add Radio
import TextArea from 'antd/es/input/TextArea'
import { FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDivider, SettingGroup, SettingTitle } from '..'

interface Props {
  flow: Flow
}

// Update form values to include type and url
interface WorkflowFormValues {
  name: string
  description?: string
  apiKey?: string // Optional now
  apiHost?: string // Optional now
  url?: string // Add url field
  enabled: boolean
  type: FlowType // Add type field
}
const WorkflowSettings: FC<Props> = ({ flow: _flow }) => {
  const { flowEngineProvider } = useFlowEngineProvider(_flow.providerId)
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [form] = Form.useForm<WorkflowFormValues>()
  // Initialize workflow state with the passed flow, including its type
  const [flow, setFlow] = useState<Flow>(_flow)
  // Remove apiValid state
  const [apiChecking, setApiChecking] = useState(false)
  const { updateFlow, removeFlow } = useFlowEngineProvider(flow.providerId)

  // Type state to control the Radio button and conditional rendering
  const [flowType, setFlowType] = useState<FlowType>(flow.type)

  const onCheckApi = async () => {
    // Save before checking
    const savedSuccessfully = await onSave(true) // Pass flag to indicate it's part of check
    if (!savedSuccessfully) {
      window.message.error({ content: t('settings.workflow.saveErrorBeforeCheck'), key: 'flow-list' })
      return // Don't proceed if save failed
    }

    // Get the latest saved flow state for checking
    const currentFlow = flow // Use the state updated by onSave

    try {
      setApiChecking(true)
      // Check API based on the current flow type
      const { valid, error } = await check(flowEngineProvider, currentFlow)
      console.log('API check result', valid, error)
      if (valid) {
        window.message.success({ content: t('settings.workflow.checkSuccess'), key: 'flow-list' })
      } else {
        const errorMessage = error && error?.message ? ' ' + error?.message : ''
        window.message.error({ content: t('settings.workflow.checkError') + errorMessage, key: 'flow-list' })
      }
      setApiChecking(false)
    } catch (error) {
      console.error('Error checking API', error)
      window.message.error({ content: t('settings.workflow.checkError'), key: 'flow-list' })
      setApiChecking(false) // Ensure loading state is reset on error
    }
    // Remove timeout related to apiValid
  }

  // Modify onSave to return a boolean indicating success/failure for onCheckApi
  const onSave = async (calledFromCheck = false): Promise<boolean> => {
    try {
      await form.validateFields() // Validate form fields before saving
      const values = form.getFieldsValue()
      console.log('Saving workflow settings', values)

      // Construct the newWorkflow object based on the selected type
      let newWorkflow: Flow
      if (flowType === 'workflow') {
        newWorkflow = {
          // Common fields
          id: flow.id,
          providerId: flow.providerId,
          name: values.name,
          description: values.description,
          enabled: flow.enabled,
          type: 'workflow',
          url: values.url || '',
          miniAppConfig: {
            id: flow.id,
            name: values.name,
            url: values.url || '',
            logo: getFlowEngineProviderLogo(flow.providerId)
          }
        } as Workflow // Type assertion
      } else {
        // flowType === 'chatflow'
        newWorkflow = {
          // Common fields
          id: flow.id,
          providerId: flow.providerId,
          name: values.name,
          description: values.description,
          enabled: flow.enabled,
          type: 'chatflow',
          apiKey: values.apiKey || '',
          apiHost: values.apiHost || ''
        } as Chatflow // Type assertion
      }

      // Update the state and call the provider update function
      setFlow(newWorkflow) // Update local state first
      await updateFlow(newWorkflow) // Make sure updateFlow is awaited if it's async
      if (!calledFromCheck) {
        window.message.success({ content: t('settings.workflow.saveSuccess'), key: 'flow-list' })
      }
      return true // Indicate success
    } catch (errorInfo: any) {
      // Handle validation errors or other save errors
      console.error('Error saving workflow settings:', errorInfo)
      if (!calledFromCheck) {
        // Show specific validation error or generic save error
        if (errorInfo.errorFields && errorInfo.errorFields.length > 0) {
          // Antd validation error
          window.message.error({ content: t('common.formValidationError'), key: 'flow-list' })
        } else {
          // Other errors during save
          window.message.error({ content: t('settings.workflow.saveError'), key: 'flow-list' })
        }
      }
      return false // Indicate failure
    }
  }

  const onDelete = useCallback(() => {
    try {
      window.modal.confirm({
        title: t('settings.workflow.deleteConfirm'),
        onOk: () => {
          removeFlow(flow)
          window.message.success({ content: t('settings.workflow.deleteSuccess'), key: 'flow-list' })
        }
      })
    } catch (error) {
      console.error('Error deleting workflow', error)
      window.message.error({ content: t('settings.workflow.deleteError'), key: 'flow-list' })
    }
  }, [flow, removeFlow, t])

  // Update form fields when workflow state changes or flowType changes
  useEffect(() => {
    console.log('WorkflowSettings useEffect', flow, flowType)
    const baseValues = {
      name: flow.name,
      description: flow.description,
      enabled: flow.enabled,
      type: flowType // Set type for the Radio group
    }
    if (flowType === 'workflow' && flow.type === 'workflow') {
      form.setFieldsValue({
        ...baseValues,
        url: flow.url,
        apiKey: undefined, // Clear chatflow fields
        apiHost: undefined // Clear chatflow fields
      })
    } else if (flowType === 'chatflow' && flow.type === 'chatflow') {
      form.setFieldsValue({
        ...baseValues,
        apiKey: flow.apiKey,
        apiHost: flow.apiHost,
        url: undefined // Clear workflow fields
      })
    } else {
      // Handle cases where the type is changing but the underlying workflow object hasn't been saved yet
      form.setFieldsValue({
        ...baseValues,
        // Clear fields based on the *new* selected type
        url: flowType === 'workflow' ? form.getFieldValue('url') : undefined,
        apiKey: flowType === 'chatflow' ? form.getFieldValue('apiKey') : undefined,
        apiHost: flowType === 'chatflow' ? form.getFieldValue('apiHost') : undefined
      })
    }
  }, [flow, form, flowType]) // Add flowType dependency

  // Handle type change from Radio group
  const handleTypeChange = (e) => {
    const newType = e.target.value
    setFlowType(newType)
    // Optionally reset parts of the form or workflow state here if needed
    // e.g., clear fields that are not relevant to the new type
    form.resetFields(['apiKey', 'apiHost', 'url']) // Reset specific fields when type changes
  }

  return (
    <SettingContainer theme={theme} style={{ background: 'var(--color-background)' }}>
      <SettingGroup style={{ marginBottom: 0 }}>
        <SettingTitle>
          <Flex justify="space-between" align="center" gap={5} style={{ marginRight: 10 }}>
            <WorkflowName className="text-nowrap">{flow?.name}</WorkflowName>
            <Button danger icon={<DeleteOutlined />} type="text" onClick={onDelete} />
          </Flex>
          <Flex align="center" gap={16}>
            <Switch
              checked={flow.enabled}
              onChange={(checked) => {
                setFlow((prev) => ({ ...prev, enabled: checked }))
                updateFlow({ ...flow, enabled: checked }) //
              }}
            />
            {/* Show Check API button always, adjust disabled logic */}

            <Button
              onClick={onCheckApi}
              disabled={
                apiChecking ||
                (flowType === 'chatflow' &&
                  !(form.getFieldValue('apiHost') || (flow.type === 'chatflow' && flow.apiHost))) ||
                (flowType === 'workflow' && !(form.getFieldValue('url') || (flow.type === 'workflow' && flow.url)))
              }>
              {apiChecking ? <LoadingOutlined spin /> : t('settings.provider.check')}
            </Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={async () => onSave()}>
              {t('common.save')}
            </Button>
          </Flex>
        </SettingTitle>
        <SettingDivider />
        <Form
          form={form}
          layout="vertical"
          initialValues={flow} // Set initial values based on the passed flow
          style={{
            overflowY: 'auto',
            width: 'calc(100% + 10px)',
            paddingRight: '10px'
          }}>
          {/* Common Fields */}
          <Form.Item name="name" label={t('settings.workflow.name')} rules={[{ required: true, message: '' }]}>
            <Input placeholder={t('common.name')} />
          </Form.Item>
          <Form.Item name="description" label={t('settings.workflow.description')}>
            <TextArea rows={2} placeholder={t('common.description')} />
          </Form.Item>

          {/* Type Selector */}
          <Form.Item name="type" label={t('settings.workflow.type')}>
            <Radio.Group onChange={handleTypeChange} value={flowType}>
              <Radio value="workflow">{t('settings.workflow.workflow')}</Radio>
              <Radio value="chatflow">{t('settings.workflow.chatflow')}</Radio>
            </Radio.Group>
          </Form.Item>

          {/* Conditional Fields based on Type */}
          {flowType === 'workflow' && (
            <Form.Item name="url" label={t('settings.workflow.url')} rules={[{ required: true, message: '' }]}>
              <Input placeholder={t('settings.workflow.url')} />
            </Form.Item>
            // Add MinAppConfig fields here if needed
          )}

          {flowType === 'chatflow' && (
            <>
              <Form.Item name="apiKey" label={t('settings.workflow.apiKey')} rules={[{ required: true, message: '' }]}>
                <Input.Password placeholder={t('settings.workflow.apiKey')} />
              </Form.Item>
              <Form.Item
                name="apiHost"
                label={t('settings.workflow.apiHost')}
                rules={[{ required: true, message: '' }]}>
                <Input placeholder={t('settings.workflow.apiHost')} />
              </Form.Item>
            </>
          )}
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
