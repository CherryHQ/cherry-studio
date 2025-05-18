import { useAssistant } from '@renderer/hooks/useAssistant'
import { useFlowEngineProvider } from '@renderer/hooks/useFlowEngineProvider'
import i18n from '@renderer/i18n'
import { uploadFile } from '@renderer/services/FlowEngineService'
import store, { useAppDispatch } from '@renderer/store'
import { updateOneBlock } from '@renderer/store/messageBlock'
import { fetchAndProcessWorkflowResponseImpl } from '@renderer/store/thunk/flowThunk'
import { saveUpdatedBlockToDB } from '@renderer/store/thunk/messageThunk'
import { IUserInputFormItemType, IUserInputFormItemValueBase } from '@renderer/types'
import { FormMessageBlock, Message, MessageBlockStatus } from '@renderer/types/newMessage'
import { Button, Card, Form, Input, InputNumber, Select } from 'antd'
import React, { FC } from 'react'

import FileUpload from './FileUpload'

interface Props {
  block: FormMessageBlock
  message: Message
}

const WorkflowForm: FC<Props> = ({ block, message }) => {
  const [form] = Form.useForm()
  const { flowEngineProvider } = useFlowEngineProvider(block.flow.providerId)
  const { assistant } = useAssistant(message.assistantId)

  const dispatch = useAppDispatch()

  const renderFormItem = (type: IUserInputFormItemType, item: IUserInputFormItemValueBase) => {
    switch (type) {
      case 'text-input':
        return <Input maxLength={item.max_length} />
      case 'paragraph':
        return <Input.TextArea />
      case 'select':
        return (
          <Select>
            {item.options?.map((option) => (
              <Select.Option key={option} value={option}>
                {option}
              </Select.Option>
            ))}
          </Select>
        )
      case 'number':
        return <InputNumber style={{ width: '100%' }} />
      case 'file':
        return (
          <FileUpload
            mode="single"
            disabled={block.isFinished}
            allowed_file_types={item.allowed_file_types}
            uploadFile={uploadFile}
            workflow={block.flow}
            provider={flowEngineProvider}
          />
        )
      case 'file-list':
        return (
          <FileUpload
            maxCount={item.max_length}
            disabled={block.isFinished}
            allowed_file_types={item.allowed_file_types}
            uploadFile={uploadFile}
            workflow={block.flow}
            provider={flowEngineProvider}
          />
        )

      default:
        console.warn('Unsupported form item type:', type)
        return <Input disabled placeholder={`不支持的类型: ${type}`} />
    }
  }

  const handleFinish = async (values: any) => {
    try {
      if (block.flow.type === 'workflow') {
        await dispatch(
          fetchAndProcessWorkflowResponseImpl(
            message.topicId,
            assistant,
            block.flow,
            values,
            block.id,
            message.askId ?? ''
          )
        )
      } else {
        const changes: Partial<FormMessageBlock> = {
          flow: {
            ...block.flow,
            inputs: values
          },
          status: MessageBlockStatus.SUCCESS
        }
        dispatch(updateOneBlock({ id: block.id, changes }))
        saveUpdatedBlockToDB(block.id, message.assistantId, message.topicId, store.getState)
      }
    } catch (error) {
      console.error('Error processing workflow response:', error)
      window.message.error({ content: i18n.t('common.form.validation.error') })
    }
  }

  const formItems = React.useMemo(() => {
    const items: Array<{ type: IUserInputFormItemType; item: IUserInputFormItemValueBase }> = []
    if (block.flow.parameters) {
      if (Array.isArray(block.flow.parameters)) {
        block.flow.parameters.forEach((param) => {
          const type = Object.keys(param)[0] as IUserInputFormItemType
          const item = param[type] as IUserInputFormItemValueBase

          if (type && item) {
            items.push({ type: type, item: item })
          }
        })
      }
    }
    return items
  }, [block.flow.parameters])

  // 设置表单初始值, 防止切换时丢失数据
  const initialValues = block.flow.inputs || {}

  return (
    <Card title={block.flow.name} variant={'outlined'} style={{ maxWidth: 400 }}>
      <Form
        disabled={block.isFinished}
        form={form}
        layout="vertical"
        onFinish={handleFinish}
        initialValues={initialValues}
        size="small">
        {formItems.map(({ type, item }) => {
          if (!item.variable || !item.label) {
            console.error('Invalid parameter item:', item)
            return null
          }
          return (
            <Form.Item
              key={item.variable}
              name={item.variable}
              label={item.label}
              rules={[
                { required: item.required, message: i18n.t('common.form.validation.required', { field: item.label }) }
              ]}
              style={{ marginBottom: 10 }}>
              {renderFormItem(type, item)}
            </Form.Item>
          )
        })}
        <Form.Item style={{ marginBottom: 0, marginTop: 15 }}>
          <Button type="primary" htmlType="submit">
            {i18n.t('common.submit')}
          </Button>
        </Form.Item>
      </Form>
    </Card>
  )
}

export default WorkflowForm
