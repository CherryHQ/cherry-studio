import { InfoCircleOutlined, WarningOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import AiProvider from '@renderer/aiCore'
import { HStack } from '@renderer/components/Layout'
import ModelSelector from '@renderer/components/ModelSelector'
import { TopView } from '@renderer/components/TopView'
import { DEFAULT_KNOWLEDGE_DOCUMENT_COUNT, isMac } from '@renderer/config/constant'
import { getEmbeddingMaxContext } from '@renderer/config/embedings'
import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledge'
import { useOcrProviders } from '@renderer/hooks/useOcr'
import { usePreprocessProviders } from '@renderer/hooks/usePreprocess'
import { useProviders } from '@renderer/hooks/useProvider'
import { getKnowledgeBaseParams } from '@renderer/services/KnowledgeService'
import { getModelUniqId } from '@renderer/services/ModelService'
import { KnowledgeBase, Model, OcrProvider, PreprocessProvider } from '@renderer/types'
import { getErrorMessage } from '@renderer/utils/error'
import { Alert, Input, InputNumber, Modal, Select, Slider, Switch, Tooltip } from 'antd'
import { find } from 'lodash'
import { ChevronDown } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface ShowParams {
  title: string
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const logger = loggerService.withContext('AddKnowledgePopup')

const PopupContainer: React.FC<Props> = ({ title, resolve }) => {
  const [open, setOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const [autoDims, setAutoDims] = useState(true)
  const [showAdvanced, setShowAdvanced] = useState(false)
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
  const scrollContainerRef = useRef<HTMLDivElement>(null)

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
  }, [ocrProviders, preprocessProviders, t])

  const onOk = async () => {
    try {
      if (!newBase.name?.trim()) {
        window.message.error(t('knowledge.name_required'))
        return
      }
      if (!newBase.model) {
        window.message.error(t('knowledge.embedding_model_required'))
        return
      }
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
            logger.error('Error getting embedding dimensions:', error as Error)
            window.message.error(t('message.error.get_embedding_dimensions') + '\n' + getErrorMessage(error))
            setLoading(false)
            return
          }
        } else {
          finalDimensions = dimensions
        }

        const _newBase: KnowledgeBase = {
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
          version: 1,
          framework: 'langchain'
        }

        // migrate to langchain framework
        // await window.api.knowledgeBase.create(getKnowledgeBaseParams(_newBase))
        await window.api.newKnowledgeBase.create(getKnowledgeBaseParams(_newBase))

        addKnowledgeBase(_newBase as any)
        setOpen(false)
        resolve(_newBase)
      }
    } catch (error) {
      logger.error('Validation failed:', error as Error)
    }
  }
  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve(null)
  }

  useEffect(() => {
    if (showAdvanced && scrollContainerRef.current) {
      // 延迟滚动，确保DOM更新完成
      setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTo({
            top: scrollContainerRef.current.scrollHeight,
            behavior: 'smooth'
          })
        }
      }, 300)
    }
  }, [showAdvanced])

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
      transitionName="animation-move-down"
      okButtonProps={{ loading }}
      width="min(600px, 60vw)"
      styles={{
        body: { padding: 0 },
        header: {
          padding: '10px 15px',
          borderBottom: '0.5px solid var(--color-border)',
          margin: 0,
          borderRadius: 0
        },
        content: {
          padding: 0,
          paddingBottom: 10,
          overflow: 'hidden'
        }
      }}>
      <HStack>
        <SettingsContentPanel ref={scrollContainerRef}>
          <SettingsPanel>
            <SettingsItem>
              <div className="settings-label">{t('common.name')}</div>
              <Input
                ref={nameInputRef}
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
                  <InfoCircleOutlined style={{ marginLeft: 8, color: 'var(--color-text-3)' }} />
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
                  <InfoCircleOutlined style={{ marginLeft: 8, color: 'var(--color-text-3)' }} />
                </Tooltip>
              </div>
              <ModelSelector
                providers={providers}
                predicate={isEmbeddingModel}
                style={{ width: '100%' }}
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
                  <InfoCircleOutlined style={{ marginLeft: 8, color: 'var(--color-text-3)' }} />
                </Tooltip>
              </div>
              <ModelSelector
                providers={providers}
                predicate={isRerankModel}
                style={{ width: '100%' }}
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
                  <InfoCircleOutlined style={{ marginLeft: 8, color: 'var(--color-text-3)' }} />
                </Tooltip>
              </div>
              <Slider
                min={1}
                max={50}
                step={1}
                defaultValue={DEFAULT_KNOWLEDGE_DOCUMENT_COUNT}
                marks={{ 1: '1', 6: t('knowledge.document_count_default'), 30: '30', 50: '50' }}
                onChange={(value) => setNewBase({ ...newBase, documentCount: value })}
              />
            </SettingsItem>

            {/* dimensions */}
            <SettingsItem style={{ marginTop: 35 }}>
              <div
                className="settings-label"
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <span>
                  {t('knowledge.dimensions_auto_set')}
                  <Tooltip title={t('knowledge.dimensions_default')} placement="right">
                    <InfoCircleOutlined style={{ marginLeft: 8, color: 'var(--color-text-3)' }} />
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
                    <InfoCircleOutlined style={{ marginLeft: 8, color: 'var(--color-text-3)' }} />
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

          <AdvancedSettingsButton onClick={() => setShowAdvanced(!showAdvanced)}>
            <ChevronDown
              size={18}
              style={{
                transform: showAdvanced ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.3s',
                marginRight: 8,
                stroke: 'var(--color-primary)'
              }}
            />
            {t('common.advanced_settings')}
          </AdvancedSettingsButton>

          {showAdvanced && (
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
                    } else {
                      await window.message.error(t('message.error.chunk_overlap_too_large'))
                    }
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
          )}
        </SettingsContentPanel>
      </HStack>
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
  .ant-modal-title {
    font-size: 14px;
  }
  .ant-modal-close {
    top: 4px;
    right: 4px;
  }
  .ant-menu-item {
    height: 36px;
    color: var(--color-text-2);
    display: flex;
    align-items: center;
    border: 0.5px solid transparent;
    border-radius: 6px;
    .ant-menu-title-content {
      line-height: 36px;
    }
  }
  .ant-menu-item-active {
    background-color: var(--color-background-soft) !important;
    transition: none;
  }
  .ant-menu-item-selected {
    background-color: var(--color-background-soft);
    border: 0.5px solid var(--color-border);
    .ant-menu-title-content {
      color: var(--color-text-1);
      font-weight: 500;
    }
  }
`

const SettingsContentPanel = styled.div`
  flex: 1;
  padding: 16px 16px;
  max-height: calc(80vh - 80px);
  overflow-y: auto;
`

const AdvancedSettingsButton = styled.div`
  cursor: pointer;
  margin-bottom: 16px;
  color: var(--color-primary);
  display: flex;
  align-items: center;
  margin: 0 16px;
  padding: 16px 0;
  border-top: 0.5px solid var(--color-border);
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
