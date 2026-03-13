import { InfoTooltip, Slider } from '@cherrystudio/ui'
import InputEmbeddingDimension from '@renderer/components/InputEmbeddingDimension'
import ModelSelector from '@renderer/components/ModelSelector'
import { DEFAULT_WEBSEARCH_RAG_DOCUMENT_COUNT } from '@renderer/config/constant'
import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { NOT_SUPPORTED_RERANK_PROVIDERS } from '@renderer/config/providers'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { Model } from '@renderer/types'
import { find } from 'lodash'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useWebSearchSettings } from '../../hooks/useWebSearchSettings'
import { WebSearchSettingsBadge, WebSearchSettingsField } from '../WebSearchSettingsLayout'

const CONTROL_WIDTH = { width: '100%', maxWidth: 360 }

const RagSettings = () => {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const { compressionConfig, updateCompressionConfig } = useWebSearchSettings()

  const embeddingModels = useMemo(() => {
    return providers.flatMap((provider) => provider.models).filter((model) => isEmbeddingModel(model))
  }, [providers])

  const rerankModels = useMemo(() => {
    return providers.flatMap((provider) => provider.models).filter((model) => isRerankModel(model))
  }, [providers])

  const rerankProviders = useMemo(() => {
    return providers.filter(
      (provider) => !NOT_SUPPORTED_RERANK_PROVIDERS.some((providerId) => provider.id === providerId)
    )
  }, [providers])

  const handleEmbeddingModelChange = (modelValue: string) => {
    const selectedModel = find(embeddingModels, JSON.parse(modelValue)) as Model
    void updateCompressionConfig({ embeddingModel: selectedModel })
  }

  const handleRerankModelChange = (modelValue?: string) => {
    const selectedModel = modelValue ? (find(rerankModels, JSON.parse(modelValue)) as Model) : undefined
    void updateCompressionConfig({ rerankModel: selectedModel })
  }

  const handleEmbeddingDimensionsChange = (value: number | null) => {
    void updateCompressionConfig({ embeddingDimensions: value || undefined })
  }

  const handleDocumentCountChange = (value: number) => {
    void updateCompressionConfig({ documentCount: value })
  }

  return (
    <>
      <WebSearchSettingsField title={t('models.embedding_model')}>
        <ModelSelector
          providers={providers}
          predicate={isEmbeddingModel}
          value={compressionConfig?.embeddingModel ? getModelUniqId(compressionConfig.embeddingModel) : undefined}
          style={CONTROL_WIDTH}
          placeholder={t('settings.models.empty')}
          onChange={handleEmbeddingModelChange}
          allowClear={false}
        />
      </WebSearchSettingsField>

      <WebSearchSettingsField
        title={
          <>
            {t('models.embedding_dimensions')}
            <InfoTooltip
              content={t('knowledge.dimensions_size_tooltip')}
              iconProps={{
                size: 16,
                color: 'var(--color-icon)',
                className: 'cursor-pointer'
              }}
            />
          </>
        }>
        <InputEmbeddingDimension
          value={compressionConfig?.embeddingDimensions}
          onChange={handleEmbeddingDimensionsChange}
          model={compressionConfig?.embeddingModel}
          disabled={!compressionConfig?.embeddingModel}
          style={CONTROL_WIDTH}
        />
      </WebSearchSettingsField>

      <WebSearchSettingsField title={t('models.rerank_model')}>
        <ModelSelector
          providers={rerankProviders}
          predicate={isRerankModel}
          value={compressionConfig?.rerankModel ? getModelUniqId(compressionConfig.rerankModel) : undefined}
          style={CONTROL_WIDTH}
          placeholder={t('settings.models.empty')}
          onChange={handleRerankModelChange}
          allowClear
        />
      </WebSearchSettingsField>

      <WebSearchSettingsField
        meta={
          <WebSearchSettingsBadge>
            {compressionConfig?.documentCount || DEFAULT_WEBSEARCH_RAG_DOCUMENT_COUNT}
          </WebSearchSettingsBadge>
        }
        title={
          <>
            {t('settings.tool.websearch.compression.rag.document_count.label')}
            <InfoTooltip
              content={t('settings.tool.websearch.compression.rag.document_count.tooltip')}
              iconProps={{
                size: 16,
                color: 'var(--color-icon)',
                className: 'cursor-pointer'
              }}
            />
          </>
        }>
        <div className="flex items-center gap-2.5">
          <span className="w-3 shrink-0 text-right text-[9px] text-foreground">1</span>
          <div className="flex-1">
            <Slider
              size="sm"
              min={1}
              max={10}
              step={1}
              value={[compressionConfig?.documentCount || DEFAULT_WEBSEARCH_RAG_DOCUMENT_COUNT]}
              onValueChange={([value]) => handleDocumentCountChange(value)}
            />
          </div>
          <span className="w-6 shrink-0 text-[9px] text-foreground">10</span>
        </div>
      </WebSearchSettingsField>
    </>
  )
}

export default RagSettings
