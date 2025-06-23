import { InfoCircleOutlined, SettingOutlined, WarningOutlined } from '@ant-design/icons'
import AiProvider from '@renderer/aiCore'
import { TopView } from '@renderer/components/TopView'
import { DEFAULT_KNOWLEDGE_DOCUMENT_COUNT, isMac } from '@renderer/config/constant'
import { getEmbeddingMaxContext } from '@renderer/config/embedings'
import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { NOT_SUPPORTED_REANK_PROVIDERS } from '@renderer/config/providers'
// import { SUPPORTED_REANK_PROVIDERS } from '@renderer/config/providers'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledge'
import { useOcrProviders } from '@renderer/hooks/useOcr'
import { usePreprocessProviders } from '@renderer/hooks/usePreprocess'
import { useProviders } from '@renderer/hooks/useProvider'
import { getKnowledgeBaseParams } from '@renderer/services/KnowledgeService'
import { getModelUniqId } from '@renderer/services/ModelService'
import { KnowledgeBase, Model, OcrProvider, PreprocessProvider } from '@renderer/types'
import { getErrorMessage } from '@renderer/utils/error'
import { Alert, Input, InputNumber, Modal, Select, Slider, Switch, Tabs, TabsProps, Tooltip } from 'antd'
import { find, sortBy } from 'lodash'
import { nanoid } from 'nanoid'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface ShowParams {
  title: string
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ title, resolve }) => {
  const [open, setOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const [autoDims, setAutoDims] = useState(true)
  const { t } = useTranslation()
  const { providers } = useProviders()
  const { addKnowledgeBase } = useKnowledgeBases()
  const [newBase, setNewBase] = useState<KnowledgeBase>({} as KnowledgeBase)
  const [dimensions, setDimensions] = useState<number | undefined>(undefined)

  const { preprocessProviders } = usePreprocessProviders()
  const { ocrProviders } = useOcrProviders()
  const [selectedProvider, setSelectedProvider] = useState<PreprocessProvider | OcrProvider | undefined>(undefined)

  const embeddingModels = useMemo(() => {
    return providers
      .map((p) => p.models)
      .flat()
      .filter((model) => isEmbeddingModel(model))
  }, [providers])

  const rerankModels = useMemo(() => {
    return providers
      .map((p) => p.models)
      .flat()
      .filter((model) => isRerankModel(model))
  }, [providers])

  const nameInputRef = useRef<any>(null)

  const embeddingSelectOptions = useMemo(() => {
    return providers
      .filter((p) => p.models.length > 0)
      .map((p) => ({
        label: p.isSystem ? t(`provider.${p.id}`) : p.name,
        title: p.name,
        options: sortBy(p.models, 'name')
          .filter((model) => isEmbeddingModel(model))
          .map((m) => ({
            label: m.name,
            value: getModelUniqId(m),
            providerId: p.id,
            modelId: m.id
          }))
      }))
      .filter((group) => group.options.length > 0)
  }, [providers, t])

  const rerankSelectOptions = useMemo(() => {
    return providers
      .filter((p) => p.models.length > 0)
      .filter((p) => !NOT_SUPPORTED_REANK_PROVIDERS.includes(p.id))
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
  }, [providers, t])

  const preprocessOrOcrSelectOptions = useMemo(() => {
    const preprocessOptions = {
      label: t('settings.tool.preprocess.provider'),
      title: t('settings.tool.preprocess.provider'),
      options: preprocessProviders
        // todo: 免费期结束后删除
        .filter((p) => p.apiKey !== '' || p.id === 'mineru')
        .map((p) => ({ value: p.id, label: p.name }))
    }
    const ocrOptions = {
      label: t('settings.tool.ocr.provider'),
      title: t('settings.tool.ocr.provider'),
      options: ocrProviders.filter((p) => p.apiKey !== '').map((p) => ({ value: p.id, label: p.name }))
    }

    return isMac ? [preprocessOptions, ocrOptions] : [preprocessOptions]
  }, [ocrProviders, preprocessProviders])

  const onOk = async () => {
    try {
      // const values = await form.validateFields()
      const selectedEmbeddingModel = find(embeddingModels, newBase.model) as Model

      const selectedRerankModel = newBase.rerankModel ? (find(rerankModels, newBase.rerankModel) as Model) : undefined

      if (selectedEmbeddingModel) {
        setLoading(true)
        const provider = providers.find((p) => p.id === selectedEmbeddingModel.provider)

        if (!provider) {
          return
        }
        let finalDimensions: number // 用于存储最终确定的维度值

        if (autoDims || dimensions === undefined) {
          try {
            const aiProvider = new AiProvider(provider)
            finalDimensions = await aiProvider.getEmbeddingDimensions(selectedEmbeddingModel)

            setDimensions(finalDimensions)
          } catch (error) {
            window.message.error(t('message.error.get_embedding_dimensions') + '\n' + getErrorMessage(error))
            setLoading(false)
            return
          }
        } else {
          finalDimensions = dimensions
        }

        const _newBase = {
          ...newBase,
          id: nanoid(),
          name: newBase.name,
          model: selectedEmbeddingModel,
          rerankModel: selectedRerankModel,
          dimensions: finalDimensions,
          documentCount: newBase.documentCount || DEFAULT_KNOWLEDGE_DOCUMENT_COUNT,
          items: [],
          created_at: Date.now(),
          updated_at: Date.now(),
          version: 1
        }

        await window.api.knowledgeBase.create(getKnowledgeBaseParams(_newBase))

        addKnowledgeBase(_newBase as any)
        setOpen(false)
        resolve(_newBase)
      }
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

  const settingItems: TabsProps['items'] = [
    {
      key: '1',
      label: t('settings.general'),
      children: (
        <SettingsPanel>
          <SettingsItem>
            <div className="settings-label">{t('common.name')}</div>
            <Input
              placeholder={t('common.name')}
              onChange={(e) => {
                if (e.target.value) {
                  setNewBase({ ...newBase, name: e.target.value })
                }
              }}
            />
          </SettingsItem>

          <SettingsItem>
            <div className="settings-label">
              {t('settings.tool.preprocess.title')} / {t('settings.tool.ocr.title')}
              <Tooltip title={t('settings.tool.preprocessOrOcr.tooltip')} placement="right">
                <InfoCircleOutlined style={{ marginLeft: 8 }} />
              </Tooltip>
            </div>
            <Select
              value={selectedProvider?.id}
              style={{ width: '100%' }}
              onChange={(value: string) => {
                const type = preprocessProviders.find((p) => p.id === value) ? 'preprocess' : 'ocr'
                const provider = (type === 'preprocess' ? preprocessProviders : ocrProviders).find(
                  (p) => p.id === value
                )
                if (!provider) {
                  setSelectedProvider(undefined)
                  setNewBase({
                    ...newBase,
                    preprocessOrOcrProvider: undefined
                  })
                  return
                }
                setSelectedProvider(provider)
                setNewBase({
                  ...newBase,
                  preprocessOrOcrProvider: {
                    type: type,
                    provider: provider
                  }
                })
              }}
              placeholder={t('settings.tool.preprocess.provider_placeholder')}
              options={preprocessOrOcrSelectOptions}
              allowClear
            />
          </SettingsItem>

          <SettingsItem>
            <div className="settings-label">
              {t('models.embedding_model')}
              <Tooltip title={t('models.embedding_model_tooltip')} placement="right">
                <InfoCircleOutlined style={{ marginLeft: 8 }} />
              </Tooltip>
            </div>
            <Select
              style={{ width: '100%' }}
              options={embeddingSelectOptions}
              placeholder={t('settings.models.empty')}
              onChange={(value) => {
                const model = value
                  ? providers.flatMap((p) => p.models).find((m) => getModelUniqId(m) === value)
                  : undefined
                if (!model) return
                setNewBase({ ...newBase, model })
              }}
            />
          </SettingsItem>

          <SettingsItem>
            <div className="settings-label">
              {t('models.rerank_model')}
              <Tooltip title={t('models.rerank_model_tooltip')} placement="right">
                <InfoCircleOutlined style={{ marginLeft: 8 }} />
              </Tooltip>
            </div>
            <Select
              style={{ width: '100%' }}
              options={rerankSelectOptions}
              placeholder={t('settings.models.empty')}
              onChange={(value) => {
                const rerankModel = value
                  ? providers.flatMap((p) => p.models).find((m) => getModelUniqId(m) === value)
                  : undefined
                setNewBase({ ...newBase, rerankModel })
              }}
              allowClear
            />
          </SettingsItem>

          <SettingsItem>
            <div className="settings-label">
              {t('knowledge.document_count')}
              <Tooltip title={t('knowledge.document_count_help')}>
                <InfoCircleOutlined style={{ marginLeft: 8 }} />
              </Tooltip>
            </div>
            <Slider
              style={{ width: '100%' }}
              min={1}
              max={30}
              step={1}
              defaultValue={DEFAULT_KNOWLEDGE_DOCUMENT_COUNT}
              marks={{ 1: '1', 6: t('knowledge.document_count_default'), 30: '30' }}
              onChange={(value) => setNewBase({ ...newBase, documentCount: value })}
            />
          </SettingsItem>

          {/* dimensions */}
          <SettingsItem>
            <div
              className="settings-label"
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <span>
                {t('knowledge.dimensions_auto_set')}
                <Tooltip title={t('knowledge.dimensions_default')} placement="right">
                  <InfoCircleOutlined style={{ marginLeft: 8 }} />
                </Tooltip>
              </span>
              <Switch
                checked={autoDims}
                onChange={(checked) => {
                  setAutoDims(checked)
                  if (checked) {
                    setDimensions(undefined)
                  }
                }}
              />
            </div>
          </SettingsItem>

          {!autoDims && (
            <SettingsItem>
              <div className="settings-label">
                {t('knowledge.dimensions')}
                <Tooltip title={t('knowledge.dimensions_size_tooltip')} placement="right">
                  <InfoCircleOutlined style={{ marginLeft: 8 }} />
                </Tooltip>
              </div>
              <InputNumber
                min={1}
                style={{ width: '100%' }}
                placeholder={t('knowledge.dimensions_size_placeholder')}
                value={newBase.dimensions}
                onChange={(value) => {
                  setDimensions(value === null ? undefined : value)
                }}
              />
            </SettingsItem>
          )}
        </SettingsPanel>
      ),
      icon: <SettingOutlined />
    },
    {
      key: '2',
      label: t('settings.advanced.title'),
      children: (
        <SettingsPanel>
          <SettingsItem>
            <div className="settings-label">
              {t('knowledge.chunk_size')}
              <Tooltip title={t('knowledge.chunk_size_tooltip')} placement="right">
                <InfoCircleOutlined style={{ marginLeft: 8 }} />
              </Tooltip>
            </div>
            <InputNumber
              style={{ width: '100%' }}
              min={100}
              value={newBase.chunkSize}
              placeholder={t('knowledge.chunk_size_placeholder')}
              onChange={(value) => {
                const maxContext = getEmbeddingMaxContext(newBase.model.id)
                if (!value || !maxContext || value <= maxContext) {
                  setNewBase({ ...newBase, chunkSize: value || undefined })
                }
              }}
            />
          </SettingsItem>

          <SettingsItem>
            <div className="settings-label">
              {t('knowledge.chunk_overlap')}
              <Tooltip title={t('knowledge.chunk_overlap_tooltip')} placement="right">
                <InfoCircleOutlined style={{ marginLeft: 8 }} />
              </Tooltip>
            </div>
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              value={newBase.chunkOverlap}
              placeholder={t('knowledge.chunk_overlap_placeholder')}
              onChange={async (value) => {
                if (!value || (newBase.chunkSize && newBase.chunkSize > value)) {
                  setNewBase({ ...newBase, chunkOverlap: value || undefined })
                }
                await window.message.error(t('message.error.chunk_overlap_too_large'))
              }}
            />
          </SettingsItem>

          <SettingsItem>
            <div className="settings-label">
              {t('knowledge.threshold')}
              <Tooltip title={t('knowledge.threshold_tooltip')} placement="right">
                <InfoCircleOutlined style={{ marginLeft: 8 }} />
              </Tooltip>
            </div>
            <InputNumber
              style={{ width: '100%' }}
              step={0.1}
              min={0}
              max={1}
              value={newBase.threshold}
              placeholder={t('knowledge.threshold_placeholder')}
              onChange={(value) => setNewBase({ ...newBase, threshold: value || undefined })}
            />
          </SettingsItem>

          <Alert
            message={t('knowledge.chunk_size_change_warning')}
            type="warning"
            showIcon
            icon={<WarningOutlined />}
          />
        </SettingsPanel>
      ),
      icon: <SettingOutlined />
    }
  ]

  return (
    <SettingsModal
      title={title}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      afterOpenChange={(visible) => visible && nameInputRef.current?.focus()}
      destroyOnClose
      centered
      okButtonProps={{ loading }}>
      <div>
        <Tabs style={{ minHeight: '50vh' }} defaultActiveKey="1" tabPosition={'left'} items={settingItems} />
      </div>
    </SettingsModal>
  )
}

const SettingsPanel = styled.div`
  padding: 0 16px;
`

const SettingsItem = styled.div`
  margin-bottom: 24px;

  .settings-label {
    font-size: 14px;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
  }
`

const SettingsModal = styled(Modal)`
  .ant-modal {
    width: auto !important;
    height: auto !important;
  }
  .ant-modal-content {
    min-height: 60vh;
    width: 50vw;
    display: flex;
    flex-direction: column;

    .ant-modal-body {
      flex: 1;
      max-height: auto;
    }
  }
  .ant-tabs-tab {
    padding-inline-start: 0px !important;
  }
`

export default class AddKnowledgePopup {
  static hide() {
    TopView.hide('AddKnowledgePopup')
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
        'AddKnowledgePopup'
      )
    })
  }
}
