import { WarningOutlined } from '@ant-design/icons'
import { TopView } from '@renderer/components/TopView'
import { DEFAULT_KNOWLEDGE_DOCUMENT_COUNT } from '@renderer/config/constant'
import { getEmbeddingMaxContext } from '@renderer/config/embedings'
import { isEmbeddingModel } from '@renderer/config/models'
import { useKnowledge } from '@renderer/hooks/useKnowledge'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import { KnowledgeBase, Model } from '@renderer/types'
import { Alert, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Slider, Space } from 'antd'
import { sortBy } from 'lodash'
import { useCallback, useEffect, useState } from 'react'
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
  threshold?: number
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
  const [showPopConfirm, setShowPopConfirm] = useState(false)

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

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const handleSubmit = useCallback(
    async (values: FormData) => {
      const currentModel = JSON.parse(values.model) as Model
      const isEmeddingModelChange = base.model.id !== currentModel.id || base.model.provider !== currentModel.provider
      const newBase = {
        ...base,
        name: values.name,
        model: currentModel,
        documentCount: values.documentCount || DEFAULT_KNOWLEDGE_DOCUMENT_COUNT,
        chunkSize: values.chunkSize,
        chunkOverlap: values.chunkOverlap,
        threshold: values.threshold ?? undefined,
        isEmeddingModelChange
      }
      updateKnowledgeBase(newBase)
      setOpen(false)
      resolve(newBase)
    },
    [base, updateKnowledgeBase, resolve]
  )
  const onCheckFormAndSubmit = async () => {
    try {
      const values = await form.validateFields()
      const currentModel = JSON.parse(values.model) as Model
      if (base.model.id !== currentModel.id || base.model.provider !== currentModel.provider) {
        setShowPopConfirm(true)
      } else {
        handleSubmit(values)
      }
    } catch (error) {
      console.error('Validation failed:', error)
    }
  }
  const onConfirm = async () => {
    try {
      const values = await form.validateFields()
      handleSubmit(values)
    } catch (error) {
      console.error('Validation failed:', error)
    } finally {
      setShowPopConfirm(false)
    }
  }

  const onCancelPopConfirm = () => {
    setShowPopConfirm(false)
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
      onCancel={onCancel}
      afterClose={onClose}
      destroyOnClose
      maskClosable={false}
      footer={
        <Space>
          <Button onClick={onCancel}>{t('common.cancel')}</Button>
          <Popconfirm
            title={t('knowledge.embedding_model_change_tooltip')}
            open={showPopConfirm}
            onConfirm={onConfirm}
            onCancel={onCancelPopConfirm}
            okText={t('common.confirm')}
            cancelText={t('common.cancel')}>
            <Button type="primary" onClick={onCheckFormAndSubmit}>
              {t('common.save')}
            </Button>
          </Popconfirm>
        </Space>
      }
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
          <Select style={{ width: '100%' }} options={selectOptions} placeholder={t('settings.models.empty')} />
        </Form.Item>

        <Form.Item
          name="documentCount"
          label={t('knowledge.document_count')}
          tooltip={{ title: t('knowledge.document_count_help') }}>
          <Slider
            style={{ width: '100%' }}
            min={1}
            max={30}
            step={1}
            marks={{ 1: '1', 6: t('knowledge.document_count_default'), 30: '30' }}
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
        <Form.Item
          name="threshold"
          label={t('knowledge.threshold')}
          tooltip={{ title: t('knowledge.threshold_tooltip') }}
          initialValue={base.threshold}
          rules={[
            {
              validator(_, value) {
                if (value && (value > 1 || value < 0)) {
                  return Promise.reject(new Error(t('knowledge.threshold_too_large_or_small')))
                }
                return Promise.resolve()
              }
            }
          ]}>
          <InputNumber placeholder={t('knowledge.threshold_placeholder')} step={0.1} style={{ width: '100%' }} />
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
