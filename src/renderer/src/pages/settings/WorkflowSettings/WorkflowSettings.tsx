import { DeleteOutlined, LoadingOutlined, SaveOutlined } from '@ant-design/icons'
// Remove getFlowEngineProviderLogo import if miniAppConfig is removed
// import { getFlowEngineProviderLogo } from '@renderer/config/workflowProviders'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useFlowEngineProvider } from '@renderer/hooks/useFlowEngineProvider'
import { check } from '@renderer/services/FlowEngineService'
// Import FlowType and update FlowConfig import if necessary
import { Flow, FlowType } from '@renderer/types' // Import WorkflowSpecificConfig, remove Chatflow, Workflow specific imports if not needed elsewhere
import { Button, Flex, Form, Input, Radio, Switch } from 'antd' // Add Radio
import TextArea from 'antd/es/input/TextArea'
import { FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDivider, SettingGroup, SettingTitle } from '..'

interface Props {
  flow: Flow
}

// Update form values: remove url, apiKey/apiHost are always present
interface WorkflowFormValues {
  name: string
  description?: string
  apiKey: string // Now required based on FlowBase
  apiHost: string // Now required based on FlowBase
  // url?: string // Remove url field
  enabled: boolean
  type: FlowType // Keep type field
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

  // Type state to control the Radio button
  const [flowType, setFlowType] = useState<FlowType>(flow.type)

  const onCheckApi = async () => {
    // Save before checking
    const savedSuccessfully = await onSave(true) // Pass flag to indicate it's part of check
    if (!savedSuccessfully) {
      window.message.error({ content: t('settings.workflow.saveErrorBeforeCheck'), key: 'flow-list' })
      return // Don't proceed if save failed
    }

    // Get the latest saved flow state for checking
    // Use the flow state directly as it's updated in onSave
    const currentFlowToCheck = flow

    try {
      setApiChecking(true)
      // Check API using the current flow state
      const { valid, error } = await check(flowEngineProvider, currentFlowToCheck)
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

      // Construct the newWorkflow object - structure is now simpler
      const newWorkflow: Flow = {
        // Common fields from FlowBase
        id: flow.id,
        providerId: flow.providerId,
        name: values.name,
        description: values.description,
        enabled: flow.enabled, // Use state value for enabled
        apiKey: values.apiKey || '', // Ensure non-null
        apiHost: values.apiHost || '', // Ensure non-null
        type: flowType
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

  // Update form fields when workflow state changes (simpler logic)
  useEffect(() => {
    console.log('WorkflowSettings useEffect', flow, flowType)
    // Set all common fields directly from the flow state
    form.setFieldsValue({
      name: flow.name,
      description: flow.description,
      enabled: flow.enabled,
      apiKey: flow.apiKey, // Now common
      apiHost: flow.apiHost, // Now common
      type: flowType // Keep setting type for the Radio group
      // url: undefined // Remove url
    })
    // No need for complex conditional logic based on flowType for apiKey/apiHost/url
  }, [flow, form, flowType]) // Keep flowType dependency for the Radio group state

  // Handle type change from Radio group
  const handleTypeChange = (e) => {
    const newType = e.target.value
    setFlowType(newType)
    // No need to reset fields anymore as apiKey/apiHost are common and url is removed
    // form.resetFields(['apiKey', 'apiHost', 'url']) // Remove this line
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
                // Update local state immediately for responsiveness
                const updatedFlow = { ...flow, enabled: checked }
                setFlow(updatedFlow)
                // Persist the change (consider debouncing or saving explicitly)
                updateFlow(updatedFlow)
              }}
            />
            {/* Update Check API button disabled logic */}
            <Button
              onClick={onCheckApi}
              disabled={
                apiChecking ||
                // Check should depend on apiKey and apiHost having values from the form or the saved state
                !(form.getFieldValue('apiHost') || flow.apiHost) ||
                !(form.getFieldValue('apiKey') || flow.apiKey)
                // Remove url check
                // (flowType === 'workflow' && !(form.getFieldValue('url') || (flow.type === 'workflow' && flow.url)))
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
          // Set initial values based on the passed flow, including new common fields
          initialValues={{
            ...flow,
            type: flow.type // Ensure initial type is set for Radio
          }}
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

          {/* Type Selector - Still needed */}
          <Form.Item name="type" label={t('settings.workflow.type')}>
            <Radio.Group onChange={handleTypeChange} value={flowType}>
              <Radio value="workflow">{t('settings.workflow.workflow')}</Radio>
              <Radio value="chatflow">{t('settings.workflow.chatflow')}</Radio>
            </Radio.Group>
          </Form.Item>

          {/* Always show apiKey and apiHost fields */}
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
