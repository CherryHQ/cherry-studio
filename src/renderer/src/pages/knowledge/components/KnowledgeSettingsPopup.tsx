import { WarningOutlined } from '@ant-design/icons'
import { TopView } from '@renderer/components/TopView'
import { DEFAULT_KNOWLEDGE_DOCUMENT_COUNT } from '@renderer/config/constant'
import { getEmbeddingMaxContext } from '@renderer/config/embedings'
import { isEmbeddingModel } from '@renderer/config/models'
import { useKnowledge } from '@renderer/hooks/useKnowledge'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import { ExternalImportConfig, KnowledgeBase } from '@renderer/types'
import { Alert, Divider, Form, Input, InputNumber, Modal, Select, Slider, Tabs, Typography } from 'antd'
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
  const [activeTab, setActiveTab] = useState('general')
  const [externalImportConfig, setExternalImportConfig] = useState<ExternalImportConfig | null>(null)
  const [externalImportType, setExternalImportType] = useState<string | null>(null)

  useEffect(() => {
    form.setFieldsValue({
      documentCount: base?.documentCount || 6
    })
  }, [base, form])

  useEffect(() => {
    if (!base) return

    if (base.externalImports) {
      if (Array.isArray(base.externalImports)) {
        const config = base.externalImports[0]
        setExternalImportConfig(config)
        setExternalImportType(config.type)
      } else {
        setExternalImportConfig(base.externalImports)
        setExternalImportType(base.externalImports.type)
      }
    } else {
      setExternalImportConfig(null)
      setExternalImportType(null)
    }
  }, [base])

  const handleExternalImportTypeChange = (type: string | null) => {
    setExternalImportType(type)

    if (!type || type === 'none') {
      setExternalImportConfig(null)
      return
    }

    if (type === 'notion') {
      if (externalImportConfig?.type === 'notion') {
        setExternalImportConfig({
          ...externalImportConfig,
          type: 'notion',
          enabled: true
        })
      } else {
        setExternalImportConfig({
          type: 'notion',
          enabled: true,
          notionConfig: { apiKey: '', databaseId: '' }
        })
      }
    }
  }

  const handleExternalImportFieldChange = (field: string, value: any) => {
    if (!externalImportConfig) return

    if (field.startsWith('notion') && externalImportConfig.notionConfig) {
      const notionField = field.replace('notion.', '')
      setExternalImportConfig({
        ...externalImportConfig,
        notionConfig: {
          ...externalImportConfig.notionConfig,
          [notionField]: value
        }
      })
    }
  }

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
        chunkOverlap: values.chunkOverlap,
        threshold: values.threshold ?? undefined,
        externalImports: externalImportConfig
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

  const tabItems = [
    {
      key: 'general',
      label: t('knowledge.general_settings'),
      children: (
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
            <Select
              style={{ width: '100%' }}
              options={selectOptions}
              placeholder={t('settings.models.empty')}
              disabled
            />
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
          <Alert
            message={t('knowledge.chunk_size_change_warning')}
            type="warning"
            showIcon
            icon={<WarningOutlined />}
          />

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
      )
    },
    {
      key: 'externalImports',
      label: t('knowledge.external_imports'),
      children: (
        <Form layout="vertical">
          <Form.Item label={t('knowledge.external_import_type')}>
            <Select
              value={externalImportType || 'none'}
              onChange={handleExternalImportTypeChange}
              options={[
                { label: t('knowledge.external_import_none'), value: 'none' },
                { label: t('knowledge.notion_integration'), value: 'notion' },
                { label: t('knowledge.obsidian_integration'), value: 'obsidian', disabled: true }
              ]}
            />
          </Form.Item>

          {externalImportType === 'notion' && (
            <>
              <Divider orientation="left">{t('knowledge.notion_integration')}</Divider>

              <Form.Item label={t('knowledge.notion_api_key')}>
                <Input.Password
                  placeholder="Notion API Key"
                  value={externalImportConfig?.notionConfig?.apiKey || ''}
                  onChange={(e) => handleExternalImportFieldChange('notion.apiKey', e.target.value)}
                />
              </Form.Item>

              <Form.Item label={t('knowledge.notion_database_id')}>
                <Input
                  placeholder="Notion Database ID"
                  value={externalImportConfig?.notionConfig?.databaseId || ''}
                  onChange={(e) => handleExternalImportFieldChange('notion.databaseId', e.target.value)}
                />
              </Form.Item>

              <Typography.Paragraph type="secondary">{t('knowledge.notion_api_key_description')}</Typography.Paragraph>
            </>
          )}

          {externalImportType === 'obsidian' && (
            <>
              <Divider orientation="left">{t('knowledge.obsidian_integration')}</Divider>
              <Typography.Paragraph type="secondary">{t('knowledge.coming_soon')}</Typography.Paragraph>
            </>
          )}
        </Form>
      )
    }
  ]

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
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
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
