import { IUserInputFormItemType, IUserInputFormItemValueBase } from '@dify-chat/api'
import { runWorkflow, uploadFile } from '@renderer/services/FlowEngineService'
import { FlowEngine, Workflow } from '@renderer/types'
import { Button, Form, Input, InputNumber, Select } from 'antd'
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
  provider: FlowEngine
  onSubmit: (values: any) => void
}

const WorkflowForm: FC<Props> = ({ workflow, provider, onSubmit }) => {
  const [form] = Form.useForm()
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
            provider={provider}
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
            provider={provider}
          />
        )

      default:
        console.warn('Unsupported form item type:', type)
        return <Input disabled placeholder={`不支持的类型: ${type}`} />
    }
  }

  const handleFinish = async (values: any) => {
    console.log('Form values:', values)
    await runWorkflow(provider, workflow, values)
    onSubmit(values)
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
    <Form form={form} layout="vertical" onFinish={handleFinish} initialValues={initialValues}>
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
            rules={[{ required: item.required, message: `${item.label} 是必填项` }]}>
            {renderFormItem(type, item)}
          </Form.Item>
        )
      })}
      <Form.Item>
        <Button type="primary" htmlType="submit">
          提交
        </Button>
      </Form.Item>
    </Form>
  )
}

export default WorkflowForm
