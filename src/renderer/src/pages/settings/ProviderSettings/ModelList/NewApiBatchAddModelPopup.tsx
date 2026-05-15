import { TopView } from '@renderer/components/TopView'
import { endpointTypeOptions } from '@renderer/config/endpointTypes'
import { isNotSupportTextDeltaModel } from '@renderer/config/models'
import { useDynamicLabelWidth } from '@renderer/hooks/useDynamicLabelWidth'
import { useProvider } from '@renderer/hooks/useProvider'
import type { EndpointType, Model, Provider } from '@renderer/types'
import type { FormProps } from 'antd'
import { Button, Flex, Form, Modal, Select } from 'antd'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ShowParams {
  title: string
  provider: Provider
  batchModels: Model[]
}

interface ResolveData {
  success: boolean
}

interface Props extends ShowParams {
  resolve: (data: ResolveData | null) => void
}

type FieldType = {
  endpointType: EndpointType
}

const PopupContainer: React.FC<Props> = ({ title, provider, resolve, batchModels }) => {
  const [open, setOpen] = useState(true)
  const [form] = Form.useForm()
  const { addModel } = useProvider(provider.id)
  const { t } = useTranslation()
  const labelWidth = useDynamicLabelWidth([t('settings.models.add.endpoint_type.label')])
  const didResolve = useRef(false)

  const resolveOnce = (data: ResolveData | null) => {
    if (!didResolve.current) {
      didResolve.current = true
      resolve(data)
    }
  }

  const onClose = () => {
    resolveOnce(null)
  }

  const onCancel = () => {
    resolveOnce(null)
    setOpen(false)
  }

  const onAddModel = (values: FieldType) => {
    batchModels.forEach((model) => {
      addModel({
        ...model,
        endpoint_type: values.endpointType,
        supported_text_delta: !isNotSupportTextDeltaModel(model)
      })
    })
    return true
  }

  const onFinish: FormProps<FieldType>['onFinish'] = (values) => {
    if (didResolve.current) return
    onAddModel(values)
    setOpen(false)
    resolveOnce({ success: true })
  }

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onCancel}
      maskClosable={false}
      afterClose={onClose}
      footer={null}
      transitionName="animation-move-down"
      centered>
      <Form
        form={form}
        labelCol={{ style: { width: labelWidth } }}
        labelAlign="left"
        colon={false}
        style={{ marginTop: 25 }}
        onFinish={onFinish}
        initialValues={{
          endpointType: 'openai'
        }}>
        <Form.Item
          name="endpointType"
          label={t('settings.models.add.endpoint_type.label')}
          tooltip={t('settings.models.add.endpoint_type.tooltip')}
          rules={[{ required: true, message: t('settings.models.add.endpoint_type.required') }]}>
          <Select placeholder={t('settings.models.add.endpoint_type.placeholder')}>
            {endpointTypeOptions.map((opt) => (
              <Select.Option key={opt.value} value={opt.value}>
                {t(opt.label)}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>
        <Form.Item style={{ marginBottom: 8, textAlign: 'center' }}>
          <Flex justify="end" align="center" style={{ position: 'relative' }}>
            <Button type="primary" htmlType="submit" size="middle">
              {t('settings.models.add.add_model')}
            </Button>
          </Flex>
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default class NewApiBatchAddModelPopup {
  static hide() {
    TopView.hide('NewApiBatchAddModelPopup')
  }
  static show(props: ShowParams) {
    return new Promise<ResolveData | null>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            this.hide()
          }}
        />,
        'NewApiBatchAddModelPopup'
      )
    })
  }
}
