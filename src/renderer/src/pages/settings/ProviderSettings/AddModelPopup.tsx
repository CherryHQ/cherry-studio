import { TopView } from '@renderer/components/TopView'
import { EMBEDDING_REGEX, REASONING_REGEX, VISION_REGEX } from '@renderer/config/models'
import { useProvider } from '@renderer/hooks/useProvider'
import { Model, ModelType, Provider } from '@renderer/types'
import { getDefaultGroupName } from '@renderer/utils'
import { Button, Checkbox, Form, FormProps, Input, Modal } from 'antd'
import { find } from 'lodash'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ShowParams {
  title: string
  provider: Provider
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

type ModelFormType = {
  provider: string
  id: string
  name?: string
  group?: string
  types?: ModelType[]
}

const PopupContainer: React.FC<Props> = ({ title, provider, resolve }) => {
  const [open, setOpen] = useState(true)
  const [form] = Form.useForm<ModelFormType>()
  const { addModel, models } = useProvider(provider.id)
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

  const onAddModel = (values: ModelFormType) => {
    const id = values.id.trim()

    if (find(models, { id })) {
      window.message.error(t('error.model.exists'))
      return
    }

    const model: Model = {
      id,
      provider: provider.id,
      name: values.name ? values.name : id.toUpperCase(),
      group: getDefaultGroupName(values.group || id),
      type: (values.types as ModelType[]) || []
    }

    addModel(model)

    return true
  }

  const onFinish: FormProps<ModelFormType>['onFinish'] = (values) => {
    const id = values.id.trim().replaceAll('，', ',')

    if (id.includes(',')) {
      const ids = id.split(',')
      ids.forEach((id) => onAddModel({ id, name: id } as ModelFormType))
      resolve({})
      return
    }

    if (onAddModel(values)) {
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
      centered>
      <Form
        form={form}
        labelCol={{ flex: '110px' }}
        labelAlign="left"
        colon={false}
        style={{ marginTop: 25 }}
        onFinish={onFinish}>
        <Form.Item
          name="id"
          label={t('settings.models.add.model_id')}
          tooltip={t('settings.models.add.model_id.tooltip')}
          rules={[{ required: true }]}>
          <Input
            placeholder={t('settings.models.add.model_id.placeholder')}
            spellCheck={false}
            maxLength={200}
            onChange={(e) => {
              if (e.target.value.length === 0) {
                form.setFieldsValue({ name: '', group: '', types: [] })
              } else {
                const name = e.target.value
                const group = getDefaultGroupName(name)
                const guessTypes = [
                  ...(VISION_REGEX.test(name) ? ['vision'] : []),
                  ...(EMBEDDING_REGEX.test(name) ? ['embedding'] : []),
                  ...(REASONING_REGEX.test(name) ? ['reasoning'] : []),
                  ...(form.getFieldValue('types') ?? [])
                ] as ModelType[]
                form.setFieldsValue({ name: name, group, types: guessTypes })
              }
            }}
          />
        </Form.Item>
        <Form.Item
          name="name"
          label={t('settings.models.add.model_name')}
          tooltip={t('settings.models.add.model_name.placeholder')}>
          <Input placeholder={t('settings.models.add.model_name.placeholder')} spellCheck={false} />
        </Form.Item>
        <Form.Item
          name="group"
          label={t('settings.models.add.group_name')}
          tooltip={t('settings.models.add.group_name.tooltip')}>
          <Input placeholder={t('settings.models.add.group_name.placeholder')} spellCheck={false} />
        </Form.Item>
        <Form.Item
          name="types"
          label={t('settings.models.add.model_type')}
          tooltip={t('settings.models.add.model_type.tooltip')}>
          <Checkbox.Group
            value={form.getFieldValue('types') ?? []}
            onChange={(types) => {
              form.setFieldValue('types', types)
            }}
            options={[
              {
                label: t('models.type.vision'),
                value: 'vision' as ModelType
              },
              {
                label: t('models.type.embedding'),
                value: 'embedding' as ModelType
              },
              {
                label: t('models.type.reasoning'),
                value: 'reasoning' as ModelType
              }
            ]}
          />
        </Form.Item>
        <Form.Item label=" ">
          <Button type="primary" htmlType="submit">
            {t('settings.models.add.add_model')}
          </Button>
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
