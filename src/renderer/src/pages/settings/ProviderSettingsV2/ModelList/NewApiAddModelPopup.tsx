import { Flex } from '@cherrystudio/ui'
import { Button } from '@cherrystudio/ui'
import { TopView } from '@renderer/components/TopView'
import { endpointTypeOptions } from '@renderer/config/endpointTypes'
import { useDynamicLabelWidth } from '@renderer/hooks/useDynamicLabelWidth'
import { useModelMutations, useModels } from '@renderer/hooks/useModels'
import { isNewApiProvider } from '@renderer/pages/settings/ProviderSettingsV2/utils/provider'
import { getDefaultGroupName } from '@renderer/utils'
import { ENDPOINT_TYPE, type EndpointType, type Model, parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { FormProps } from 'antd'
import { Form, Input, Modal, Select } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ShowParams {
  title: string
  provider: Provider
  model?: Model
  endpointType?: number | string
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

type FieldType = {
  provider: string
  id: string
  name?: string
  group?: string
  endpointType?: number | string
}

const PopupContainer: React.FC<Props> = ({ title, provider, resolve, model, endpointType }) => {
  const [open, setOpen] = useState(true)
  const [form] = Form.useForm()
  const { models } = useModels({ providerId: provider.id })
  const { createModel } = useModelMutations()
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
    const modelId = values.id.trim()

    if (models.some((m) => m.id.endsWith(`::${modelId}`))) {
      window.toast.error(t('error.model.exists'))
      return
    }

    await createModel({
      providerId: provider.id,
      modelId,
      name: values.name ? values.name : modelId.toUpperCase(),
      group: values.group ?? getDefaultGroupName(modelId),
      endpointTypes:
        isNewApiProvider(provider) && values.endpointType ? [values.endpointType as EndpointType] : undefined
    })

    return true
  }

  const onFinish: FormProps<FieldType>['onFinish'] = async (values) => {
    const id = values.id.trim().replaceAll('，', ',')

    if (id.includes(',')) {
      const ids = id.split(',')
      for (const singleId of ids) {
        await onAddModel({ id: singleId, name: singleId } as FieldType)
      }
      resolve({})
      return
    }

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
        initialValues={
          model
            ? {
                id: model.apiModelId ?? parseUniqueModelId(model.id).modelId,
                name: model.name,
                group: model.group,
                endpointType: endpointType ?? ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
              }
            : {
                endpointType: endpointType ?? ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
              }
        }>
        <Form.Item
          name="id"
          label={t('settings.models.add.model_id.label')}
          tooltip={t('settings.models.add.model_id.tooltip')}
          rules={[{ required: true }]}>
          <Input
            placeholder={t('settings.models.add.model_id.placeholder')}
            spellCheck={false}
            maxLength={200}
            onChange={(e) => {
              form.setFieldValue('name', e.target.value)
              form.setFieldValue('group', getDefaultGroupName(e.target.value, provider.id))
            }}
          />
        </Form.Item>
        <Form.Item
          name="name"
          label={t('settings.models.add.model_name.label')}
          tooltip={t('settings.models.add.model_name.placeholder')}>
          <Input placeholder={t('settings.models.add.model_name.placeholder')} spellCheck={false} />
        </Form.Item>
        <Form.Item
          name="group"
          label={t('settings.models.add.group_name.label')}
          tooltip={t('settings.models.add.group_name.tooltip')}>
          <Input placeholder={t('settings.models.add.group_name.placeholder')} spellCheck={false} />
        </Form.Item>
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

export default class NewApiAddModelPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('NewApiAddModelPopup')
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
        'NewApiAddModelPopup'
      )
    })
  }
}
