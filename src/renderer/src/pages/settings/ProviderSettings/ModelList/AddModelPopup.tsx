import { Flex } from '@cherrystudio/ui'
import { Button } from '@cherrystudio/ui'
import { useModelMutations, useModels } from '@data/hooks/useModels'
import { TopView } from '@renderer/components/TopView'
import { getDefaultGroupName } from '@renderer/utils'
import type { Provider } from '@shared/data/types/provider'
import type { FormProps } from 'antd'
import { Form, Input, Modal } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ShowParams {
  title: string
  provider: Provider
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

type FieldType = {
  provider: string
  id: string
  name?: string
  group?: string
}

const PopupContainer: React.FC<Props> = ({ title, provider, resolve }) => {
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
      group: values.group ?? getDefaultGroupName(modelId)
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
        labelCol={{ flex: '110px' }}
        labelAlign="left"
        colon={false}
        className="mt-[25px]"
        onFinish={onFinish}>
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
        <Form.Item className="mb-2 text-center">
          <Flex className="relative items-center justify-end">
            <Button type="submit">{t('settings.models.add.add_model')}</Button>
          </Flex>
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default class AddModelPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('AddModelPopup')
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
        'AddModelPopup'
      )
    })
  }
}
