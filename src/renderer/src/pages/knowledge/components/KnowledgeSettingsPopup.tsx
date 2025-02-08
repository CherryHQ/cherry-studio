import { TopView } from '@renderer/components/TopView'
import { isEmbeddingModel } from '@renderer/config/models'
import { useKnowledge } from '@renderer/hooks/useKnowledge'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import { KnowledgeBase } from '@renderer/types'
import { Form, Input, InputNumber, Modal, Select } from 'antd'
import { sortBy } from 'lodash'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ShowParams {
  base: KnowledgeBase
}

interface FormData {
  name: string
  model: string
  chunkSize?: number
  chunkOverlap?: number
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ base: _base, resolve }) => {
  const [open, setOpen] = useState(true)
  const [form] = Form.useForm<FormData>()
  const { t } = useTranslation()
  const { providers } = useProviders()
  const { base, updateKnowledgeBase } = useKnowledge(_base.id)

  if (!base) {
    resolve(null)
    return null
  }

  const selectOptions = providers
    .filter((p) => p.models.length > 0)
    .map((p) => ({
      label: p.isSystem ? t(`provider.${p.id}`) : p.name,
      title: p.name,
      options: sortBy(p.models, 'name')
        .filter((model) => isEmbeddingModel(model))
        .map((m) => ({
          label: m.name,
          value: getModelUniqId(m)
        }))
    }))
    .filter((group) => group.options.length > 0)

  const onOk = async () => {
    try {
      const values = await form.validateFields()
      const newBase = {
        ...base,
        name: values.name,
        chunkSize: values.chunkSize,
        chunkOverlap: values.chunkOverlap
      }
      updateKnowledgeBase(newBase)
      setOpen(false)
      resolve(newBase)
    } catch (error) {
      console.error('Validation failed:', error)
    }
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve(null)
  }

  KnowledgeSettingsPopup.hide = onCancel

  return (
    <Modal
      title={t('knowledge.settings')}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      destroyOnClose
      centered>
      <Form form={form} layout="vertical">
        <Form.Item
          name="name"
          label={t('common.name')}
          initialValue={base.name}
          rules={[{ required: true, message: t('message.error.enter.name') }]}>
          <Input placeholder={t('common.name')} />
        </Form.Item>

        <Form.Item
          name="model"
          label={t('models.embedding_model')}
          initialValue={getModelUniqId(base.model)}
          tooltip={{ title: t('models.embedding_model_tooltip'), placement: 'right' }}
          rules={[{ required: true, message: t('message.error.enter.model') }]}>
          <Select style={{ width: '100%' }} options={selectOptions} placeholder={t('settings.models.empty')} disabled />
        </Form.Item>

        <Form.Item name="chunkSize" label={t('knowledge.chunk_size')}>
          <InputNumber style={{ width: '100%' }} min={1} defaultValue={base.chunkSize} />
        </Form.Item>

        <Form.Item
          name="chunkOverlap"
          label={t('knowledge.chunk_overlap')}
          initialValue={base.chunkOverlap}
          rules={[
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('chunkSize') > value) {
                  return Promise.resolve()
                }
                return Promise.reject(new Error(t('message.error.chunk_overlap_too_large')))
              }
            })
          ]}
          dependencies={['chunkSize']}>
          <InputNumber style={{ width: '100%' }} min={0} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

const TopViewKey = 'KnowledgeSettingsPopup'

export default class KnowledgeSettingsPopup {
  static hide() {
    TopView.hide(TopViewKey)
  }

  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
