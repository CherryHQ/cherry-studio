import { IUserInputFormItemType, IUserInputFormItemValueBase } from '@dify-chat/api'
import { useFlowEngineProvider } from '@renderer/hooks/useFlowEngineProvider'
import i18n from '@renderer/i18n'
import { runWorkflow, uploadFile } from '@renderer/services/FlowEngineService'
import { useAppDispatch } from '@renderer/store'
import { Workflow } from '@renderer/types'
import { Message } from '@renderer/types/newMessage'
import { Button, Card, Form, Input, InputNumber, Select } from 'antd'
import { UploadFile } from 'antd/lib'
import { FC } from 'react'

import FileUpload from './FileUpload'

export interface IUploadFileItem extends UploadFile {
  type?: string
  transfer_method?: 'local_file' | 'remote_url'
  upload_file_id?: string
  related_id?: string
  remote_url?: string
  filename?: string
}

interface Props {
  workflow: Workflow
  message: Message
}

const WorkflowForm: FC<Props> = ({ workflow, message }) => {
  const [form] = Form.useForm()
  const { flowEngineProvider } = useFlowEngineProvider(workflow.providerId)
  const dispatch = useAppDispatch()
  console.log('Received workflow prop:', workflow) // 添加这行来检查传入的 workflow

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
            disabled={false}
            allowed_file_types={item.allowed_file_types}
            uploadFile={uploadFile}
            workflow={workflow}
            provider={flowEngineProvider}
          />
        )
      case 'file-list':
        return (
          <FileUpload
            maxCount={item.max_length}
            disabled={false}
            allowed_file_types={item.allowed_file_types}
            uploadFile={uploadFile}
            workflow={workflow}
            provider={flowEngineProvider}
          />
        )

      default:
        console.warn('Unsupported form item type:', type)
        return <Input disabled placeholder={`不支持的类型: ${type}`} />
    }
  }

  const handleFinish = async (values: any) => {
    console.log('Form values:', values)
    // await runWorkflow(flowEngineProvider, workflow, values)
    await dispatch(runWorkflow(message.topicId, flowEngineProvider, workflow, values, message.assistantId))
  }

  // 处理可能是数组或Record的情况
  const formItems: Array<{ type: IUserInputFormItemType; item: IUserInputFormItemValueBase }> = []

  if (workflow.parameters) {
    if (Array.isArray(workflow.parameters)) {
      workflow.parameters.forEach((param) => {
        const type = Object.keys(param)[0] as IUserInputFormItemType
        const item = param[type] as IUserInputFormItemValueBase

        if (type && item) {
          formItems.push({ type: type, item: item })
        }
      })
    } else {
      // 如果是Record格式，按照IUserInputForm的定义处理
      Object.entries(workflow.parameters).forEach(([type, item]) => {
        formItems.push({
          type: type as IUserInputFormItemType,
          item: item as IUserInputFormItemValueBase
        })
      })
    }
  }

  // 设置表单初始值
  const initialValues = formItems.reduce(
    (acc, { item }) => {
      if (item.variable && item.default) {
        acc[item.variable] = item.default
      }
      return acc
    },
    {} as Record<string, any>
  )

  return (
    <Card title={workflow.name} variant={'outlined'} style={{ maxWidth: 400 }}>
      <Form
        form={form}
        layout="vertical"
        onFinish={handleFinish}
        initialValues={initialValues}
        size="small"
        // 从 Form 移除 maxWidth 样式，因为它现在由 Card 控制
        // style={{ maxWidth: 400 }}
      >
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
              rules={[{ required: item.required, message: `${item.label} 是必填项` }]}
              style={{ marginBottom: 10 }} // 可以适当调整间距
            >
              {renderFormItem(type, item)}
            </Form.Item>
          )
        })}
        <Form.Item style={{ marginBottom: 0, marginTop: 15 }}>
          {/* 调整按钮的上边距 */}
          <Button type="primary" htmlType="submit">
            {i18n.t('common.submit')}
          </Button>
        </Form.Item>
      </Form>
    </Card>
  )
}

export default WorkflowForm
