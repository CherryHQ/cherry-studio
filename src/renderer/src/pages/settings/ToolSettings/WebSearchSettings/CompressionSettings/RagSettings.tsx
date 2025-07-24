import { loggerService } from '@logger'
import AiProvider from '@renderer/aiCore'
import ModelSelector from '@renderer/components/ModelSelector'
import { DEFAULT_WEBSEARCH_RAG_DOCUMENT_COUNT } from '@renderer/config/constant'
import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { NOT_SUPPORTED_REANK_PROVIDERS } from '@renderer/config/providers'
import { useProviders } from '@renderer/hooks/useProvider'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearchProviders'
import { SettingDivider, SettingRow, SettingRowTitle } from '@renderer/pages/settings'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Model } from '@renderer/types'
import { Button, InputNumber, Slider, Tooltip } from 'antd'
import { find } from 'lodash'
import { Info, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('RagSettings')

const INPUT_BOX_WIDTH = 'min(350px, 60%)'

const RagSettings = () => {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const { compressionConfig, updateCompressionConfig } = useWebSearchSettings()
  const [loadingDimensions, setLoadingDimensions] = useState(false)

  const embeddingModels = useMemo(() => {
    return providers.flatMap((p) => p.models).filter((model) => isEmbeddingModel(model))
  }, [providers])

  const rerankModels = useMemo(() => {
    return providers.flatMap((p) => p.models).filter((model) => isRerankModel(model))
  }, [providers])

  const rerankProviders = useMemo(() => {
    return providers.filter((p) => !NOT_SUPPORTED_REANK_PROVIDERS.includes(p.id))
  }, [providers])

  const handleEmbeddingModelChange = (modelValue: string) => {
    const selectedModel = find(embeddingModels, JSON.parse(modelValue)) as Model
    updateCompressionConfig({ embeddingModel: selectedModel })
  }

  const handleRerankModelChange = (modelValue?: string) => {
    const selectedModel = modelValue ? (find(rerankModels, JSON.parse(modelValue)) as Model) : undefined
    updateCompressionConfig({ rerankModel: selectedModel })
  }

  const handleEmbeddingDimensionsChange = (value: number | null) => {
    updateCompressionConfig({ embeddingDimensions: value || undefined })
  }

  const handleDocumentCountChange = (value: number) => {
    updateCompressionConfig({ documentCount: value })
  }

  const handleAutoGetDimensions = async () => {
    if (!compressionConfig?.embeddingModel) {
      logger.info('handleAutoGetDimensions: no embedding model')
      window.message.error(t('settings.tool.websearch.compression.error.embedding_model_required'))
      return
    }

    const provider = providers.find((p) => p.id === compressionConfig.embeddingModel?.provider)
    if (!provider) {
      logger.info('handleAutoGetDimensions: provider not found')
      window.message.error(t('settings.tool.websearch.compression.error.provider_not_found'))
      return
    }

    setLoadingDimensions(true)
    try {
      const aiProvider = new AiProvider(provider)
      const dimensions = await aiProvider.getEmbeddingDimensions(compressionConfig.embeddingModel)

      updateCompressionConfig({ embeddingDimensions: dimensions })

      window.message.success(t('settings.tool.websearch.compression.info.dimensions_auto_success', { dimensions }))
    } catch (error) {
      logger.error('handleAutoGetDimensions: failed to get embedding dimensions', error as Error)
      window.message.error(t('settings.tool.websearch.compression.error.dimensions_auto_failed'))
    } finally {
      setLoadingDimensions(false)
    }
  }

  return (
    <>
      <SettingRow>
        <SettingRowTitle>{t('models.embedding_model')}</SettingRowTitle>
        <ModelSelector
          providers={providers}
          predicate={isEmbeddingModel}
          value={compressionConfig?.embeddingModel ? getModelUniqId(compressionConfig.embeddingModel) : undefined}
          style={{ width: INPUT_BOX_WIDTH }}
          placeholder={t('settings.models.empty')}
          onChange={handleEmbeddingModelChange}
          allowClear={false}
        />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>
          {t('models.embedding_dimensions')}
          <Tooltip title={t('settings.tool.websearch.compression.rag.embedding_dimensions.tooltip')}>
            <Info size={16} color="var(--color-icon)" style={{ marginLeft: 5, cursor: 'pointer' }} />
          </Tooltip>
        </SettingRowTitle>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', width: INPUT_BOX_WIDTH }}>
          <InputNumber
            value={compressionConfig?.embeddingDimensions}
            style={{ flex: 1 }}
            placeholder={t('settings.tool.websearch.compression.rag.embedding_dimensions.placeholder')}
            min={0}
            onChange={handleEmbeddingDimensionsChange}
          />
          <Tooltip title={t('settings.tool.websearch.compression.rag.embedding_dimensions.auto_get')}>
            <Button
              icon={<RefreshCw size={16} />}
              loading={loadingDimensions}
              disabled={!compressionConfig?.embeddingModel}
              onClick={handleAutoGetDimensions}
            />
          </Tooltip>
        </div>
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('models.rerank_model')}</SettingRowTitle>
        <ModelSelector
          providers={rerankProviders}
          predicate={isRerankModel}
          value={compressionConfig?.rerankModel ? getModelUniqId(compressionConfig.rerankModel) : undefined}
          style={{ width: INPUT_BOX_WIDTH }}
          placeholder={t('settings.models.empty')}
          onChange={handleRerankModelChange}
          allowClear
        />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>
          {t('settings.tool.websearch.compression.rag.document_count.label')}
          <Tooltip title={t('settings.tool.websearch.compression.rag.document_count.tooltip')} placement="top">
            <Info size={16} color="var(--color-icon)" style={{ marginLeft: 5, cursor: 'pointer' }} />
          </Tooltip>
        </SettingRowTitle>
        <div style={{ width: INPUT_BOX_WIDTH }}>
          <Slider
            value={compressionConfig?.documentCount || DEFAULT_WEBSEARCH_RAG_DOCUMENT_COUNT}
            min={1}
            max={10}
            step={1}
            onChange={handleDocumentCountChange}
            marks={{
              1: t('common.default'),
              3: '3',
              10: '10'
            }}
          />
        </div>
      </SettingRow>
    </>
  )
}

export default RagSettings
