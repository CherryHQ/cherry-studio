import { LoadingOutlined } from '@ant-design/icons'
import { TopView } from '@renderer/components/TopView'
import { useProvider } from '@renderer/hooks/useProvider'
import { fetchModels } from '@renderer/services/ApiService'
import { Model, Provider } from '@renderer/types'
import { getDefaultGroupName, runAsyncFunction } from '@renderer/utils'
import { Button, Flex, Form, FormProps, Input, Modal, Select, Spin } from 'antd'
import { find } from 'lodash'
import { useEffect, useState } from 'react'
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
  const { addModel, models } = useProvider(provider.id)
  const { t } = useTranslation()
  const [modelOptions, setModelOptions] = useState<{ label: string; value: string }[]>([])
  const [loading, setLoading] = useState(false)

  const onOk = () => {
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  const onAddModel = (values: FieldType) => {
    const id = values.id.trim()

    if (find(models, { id })) {
      window.message.error(t('error.model.exists'))
      return
    }

    let name = values.name
    if (!name) {
      const model = find(modelOptions, { value: id })
      name = model?.label || id.toUpperCase()
    }

    const model: Model = {
      id,
      provider: provider.id,
      name,
      group: getDefaultGroupName(values.group || id)
    }

    addModel(model)

    return true
  }

  const onFinish: FormProps<FieldType>['onFinish'] = (values) => {
    const id = values.id.trim().replaceAll('，', ',')

    if (id.includes(',')) {
      const ids = id.split(',')
      ids.forEach((id) => onAddModel({ id, name: id } as FieldType))
      resolve({})
      return
    }

    if (onAddModel(values)) {
      resolve({})
    }
  }

  useEffect(() => {
    runAsyncFunction(async () => {
      try {
        setLoading(true)
        const models = await fetchModels(provider)
        setModelOptions(
          models.map((model) => ({
            label: model.id,
            value: model.id
          }))
        )
        setLoading(false)
      } catch (error) {
        setLoading(false)
      }
    })
  }, [provider])

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
        {loading ? (
          <Flex justify="center" align="center" style={{ width: '100%', height: 100 }}>
            <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
          </Flex>
        ) : (
          <>
            {modelOptions.length > 0 ? (
              <Form.Item
                name="id"
                label={t('settings.models.add.model_id')}
                tooltip={t('settings.models.add.model_id.tooltip')}
                rules={[{ required: true }]}>
                <Select
                  options={modelOptions}
                  showSearch
                  placeholder={t('settings.models.add.model_id.select.placeholder')}
                  onChange={(value) => {
                    form.setFieldValue('group', getDefaultGroupName(value))
                  }}
                />
              </Form.Item>
            ) : (
              <>
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
                      form.setFieldValue('name', e.target.value)
                      form.setFieldValue('group', getDefaultGroupName(e.target.value))
                    }}
                  />
                </Form.Item>
                <Form.Item
                  name="name"
                  label={t('settings.models.add.model_name')}
                  tooltip={t('settings.models.add.model_name.placeholder')}>
                  <Input placeholder={t('settings.models.add.model_name.placeholder')} spellCheck={false} />
                </Form.Item>
              </>
            )}
            <Form.Item
              name="group"
              label={t('settings.models.add.group_name')}
              tooltip={t('settings.models.add.group_name.tooltip')}>
              <Input placeholder={t('settings.models.add.group_name.placeholder')} spellCheck={false} />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0, textAlign: 'center' }}>
              <Flex justify="end" align="center" style={{ position: 'relative' }}>
                <Button type="primary" htmlType="submit" size="middle">
                  {t('settings.models.add.add_model')}
                </Button>
              </Flex>
            </Form.Item>
          </>
        )}
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
