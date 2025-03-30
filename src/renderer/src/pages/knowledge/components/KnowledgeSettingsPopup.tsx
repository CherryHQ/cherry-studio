import { DownOutlined, WarningOutlined } from '@ant-design/icons'
import { TopView } from '@renderer/components/TopView'
import { DEFAULT_KNOWLEDGE_DOCUMENT_COUNT } from '@renderer/config/constant'
import { getEmbeddingMaxContext } from '@renderer/config/embedings'
import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { SUPPORTED_REANK_PROVIDERS } from '@renderer/config/providers'
import { useKnowledge } from '@renderer/hooks/useKnowledge'
import { useProviders } from '@renderer/hooks/useProvider'
import { SettingHelpText } from '@renderer/pages/settings'
import { getModelUniqId } from '@renderer/services/ModelService'
import { KnowledgeBase } from '@renderer/types'
import { Alert, Form, Input, InputNumber, Modal, Select, Slider } from 'antd'
import { sortBy } from 'lodash'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

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
  rerankModel?: string
  topN?: number
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ base: _base, resolve }) => {
  const [open, setOpen] = useState(true)
  const [showAdvanced, setShowAdvanced] = useState(false)
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
        .filter((model) => isEmbeddingModel(model) && !isRerankModel(model))
        .map((m) => ({
          label: m.name,
          value: getModelUniqId(m)
        }))
    }))
    .filter((group) => group.options.length > 0)

  const rerankSelectOptions = providers
    .filter((p) => p.models.length > 0)
    .filter((p) => SUPPORTED_REANK_PROVIDERS.includes(p.id))
    .map((p) => ({
      label: p.isSystem ? t(`provider.${p.id}`) : p.name,
      title: p.name,
      options: sortBy(p.models, 'name')
        .filter((model) => isRerankModel(model))
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
        chunkOverlap: values.chunkOverlap,
        threshold: values.threshold ?? undefined,
        rerankModel: values.rerankModel
          ? providers.flatMap((p) => p.models).find((m) => getModelUniqId(m) === values.rerankModel)
          : undefined,
        topN: values.topN
      }
      updateKnowledgeBase(newBase)
      setOpen(false)
      setTimeout(() => resolve(newBase), 350)
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
      title={t('knowledge.settings.title')}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      destroyOnClose
      maskClosable={false}
      centered>
      <Form form={form} layout="vertical" className="compact-form">
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
          name="rerankModel"
          label={t('models.rerank_model')}
          tooltip={{ title: t('models.rerank_model_tooltip'), placement: 'right' }}
          initialValue={getModelUniqId(base.rerankModel) || undefined}
          rules={[{ required: false, message: t('message.error.enter.model') }]}>
          <Select
            style={{ width: '100%' }}
            options={rerankSelectOptions}
            placeholder={t('settings.models.empty')}
            allowClear
          />
        </Form.Item>
        <SettingHelpText style={{ marginTop: -15, marginBottom: 20 }}>
          {t('models.rerank_model_support_provider', {
            provider: SUPPORTED_REANK_PROVIDERS.map((id) => t(`provider.${id}`))
          })}
        </SettingHelpText>

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

        <AdvancedSettingsButton onClick={() => setShowAdvanced(!showAdvanced)}>
          <DownOutlined
            style={{
              transform: showAdvanced ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.3s',
              marginRight: 8
            }}
          />
          {t('common.advanced_settings')}
        </AdvancedSettingsButton>

        <div style={{ display: showAdvanced ? 'block' : 'none' }}>
          <Form.Item
            name="chunkSize"
            label={t('knowledge.chunk_size')}
            layout="horizontal"
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
            layout="horizontal"
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
            layout="horizontal"
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

          <Form.Item
            name="topN"
            label={t('knowledge.topN')}
            layout="horizontal"
            initialValue={base.topN}
            rules={[
              {
                validator(_, value) {
                  if (value && (value < 0 || value > 10)) {
                    return Promise.reject(new Error(t('knowledge.topN_too_large_or_small')))
                  }
                  return Promise.resolve()
                }
              }
            ]}>
            <InputNumber placeholder={t('knowledge.topN_placeholder')} style={{ width: '100%' }} />
          </Form.Item>
          <Alert
            message={t('knowledge.chunk_size_change_warning')}
            type="warning"
            showIcon
            icon={<WarningOutlined />}
          />
        </div>
      </Form>
    </Modal>
  )
}

const TopViewKey = 'KnowledgeSettingsPopup'

const AdvancedSettingsButton = styled.div`
  cursor: pointer;
  margin-bottom: 16px;
  margin-top: -10px;
  color: var(--color-primary);
  display: flex;
  align-items: center;
`

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
