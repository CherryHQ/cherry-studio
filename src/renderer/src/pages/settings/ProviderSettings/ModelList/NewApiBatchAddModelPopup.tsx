import { Flex } from '@cherrystudio/ui'
import { Button } from '@cherrystudio/ui'
import { useModelMutations } from '@data/hooks/useModels'
import { TopView } from '@renderer/components/TopView'
import { endpointTypeOptions } from '@renderer/config/endpointTypes'
import { useDynamicLabelWidth } from '@renderer/hooks/useDynamicLabelWidth'
import type { CreateModelDto } from '@shared/data/api/schemas/models'
import type { Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE, type EndpointType, parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { FormProps } from 'antd'
import { Form, Modal, Select } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ShowParams {
  title: string
  provider: Provider
  batchModels: Model[]
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

type FieldType = {
  provider: string
  group?: string
  endpointType?: number | string
}

const PopupContainer: React.FC<Props> = ({ title, provider, resolve, batchModels }) => {
  const [open, setOpen] = useState(true)
  const [form] = Form.useForm()
  const { createModelsBatch } = useModelMutations()
  const { t } = useTranslation()

  const onOk = () => {
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  const onAddModel = async (values: FieldType) => {
    const dtos: CreateModelDto[] = batchModels.map((model) => {
      const modelId = model.apiModelId ?? parseUniqueModelId(model.id).modelId
      return {
        providerId: provider.id,
        modelId,
        name: model.name,
        group: model.group,
        endpointTypes: values.endpointType ? [values.endpointType as EndpointType] : undefined
      }
    })
    await createModelsBatch(dtos)
    return true
  }

  const onFinish: FormProps<FieldType>['onFinish'] = async (values) => {
    if (await onAddModel(values)) {
      resolve({})
    }
  }

  return (
    <Modal
      title={title}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      maskClosable={false}
      afterClose={onClose}
      footer={null}
      transitionName="animation-move-down"
      centered>
      <Form
        form={form}
        labelCol={{ style: { width: useDynamicLabelWidth([t('settings.models.add.endpoint_type.label')]) } }}
        labelAlign="left"
        colon={false}
        className="mt-[25px]"
        onFinish={onFinish}
        initialValues={{
          endpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
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
        <Form.Item className="mb-2 text-center">
          <Flex className="relative items-center justify-end">
            <Button type="submit">{t('settings.models.add.add_model')}</Button>
          </Flex>
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default class NewApiBatchAddModelPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('NewApiBatchAddModelPopup')
  }
  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
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
