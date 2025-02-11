import { WarningOutlined } from '@ant-design/icons'
import { TopView } from '@renderer/components/TopView'
import { DEFAULT_KNOWLEDGE_DOCUMENT_COUNT } from '@renderer/config/constant'
import { getEmbeddingMaxContext } from '@renderer/config/embedings'
import { isEmbeddingModel } from '@renderer/config/models'
import { useKnowledge } from '@renderer/hooks/useKnowledge'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import { KnowledgeBase } from '@renderer/types'
import { Alert, Form, Input, InputNumber, Modal, Select, Slider } from 'antd'
import { sortBy } from 'lodash'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ShowParams {
  base: KnowledgeBase
}

interface FormData {
  name: string
  model: string
  documentCount?: number
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

  useEffect(() => {
    form.setFieldsValue({ documentCount: base?.documentCount || 6 })
  }, [base, form])

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
        documentCount: values.documentCount || DEFAULT_KNOWLEDGE_DOCUMENT_COUNT,
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
      maskClosable={false}
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

        <Form.Item
          name="documentCount"
          label={t('knowledge.document_count')}
          tooltip={{ title: t('knowledge.document_count_help') }}>
          <Slider
            style={{ width: '100%' }}
            min={1}
            max={15}
            step={1}
            marks={{ 1: '1', 6: t('knowledge.document_count_default'), 15: '15' }}
          />
        </Form.Item>

        <Form.Item
          name="chunkSize"
          label={t('knowledge.chunk_size')}
          tooltip={{ title: t('knowledge.chunk_size_tooltip') }}
          initialValue={base.chunkSize}
          rules={[
            {
              validator(_, value) {
                const maxContext = getEmbeddingMaxContext(base.model.id)
                if (value && maxContext && value > maxContext) {
                  return Promise.reject(new Error(t('knowledge.chunk_size_too_large', { max_context: maxContext })))
                }
                return Promise.resolve()
              }
            }
          ]}>
          <InputNumber
            style={{ width: '100%' }}
            min={100}
            defaultValue={base.chunkSize}
            placeholder={t('knowledge.chunk_size_placeholder')}
          />
        </Form.Item>

        <Form.Item
          name="chunkOverlap"
          label={t('knowledge.chunk_overlap')}
          initialValue={base.chunkOverlap}
          tooltip={{ title: t('knowledge.chunk_overlap_tooltip') }}
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
          <InputNumber
            style={{ width: '100%' }}
            min={0}
            defaultValue={base.chunkOverlap}
            placeholder={t('knowledge.chunk_overlap_placeholder')}
          />
        </Form.Item>
      </Form>
      <Alert message={t('knowledge.chunk_size_change_warning')} type="warning" showIcon icon={<WarningOutlined />} />
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
