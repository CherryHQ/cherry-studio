import { InfoTooltip } from '@cherrystudio/ui'
import InputEmbeddingDimension from '@renderer/components/InputEmbeddingDimension'
import ModelSelector from '@renderer/components/ModelSelector'
import { DEFAULT_WEBSEARCH_RAG_DOCUMENT_COUNT } from '@renderer/config/constant'
import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { NOT_SUPPORTED_RERANK_PROVIDERS } from '@renderer/config/providers'
import { useProviders } from '@renderer/hooks/useProvider'
import { SettingDivider, SettingRow, SettingRowTitle } from '@renderer/pages/settings'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { Model } from '@renderer/types'
import { Slider } from 'antd'
import { find } from 'lodash'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useWebSearchSettings } from '../../hooks/useWebSearchSettings'

const INPUT_BOX_WIDTH = 'min(350px, 60%)'

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
          <InfoTooltip
            content={t('knowledge.dimensions_size_tooltip')}
            iconProps={{
              size: 16,
              color: 'var(--color-icon)',
              className: 'ml-1 cursor-pointer'
            }}
          />
        </SettingRowTitle>
        <InputEmbeddingDimension
          value={compressionConfig?.embeddingDimensions}
          onChange={handleEmbeddingDimensionsChange}
          model={compressionConfig?.embeddingModel}
          disabled={!compressionConfig?.embeddingModel}
          style={{ width: INPUT_BOX_WIDTH }}
        />
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
          <InfoTooltip
            content={t('settings.tool.websearch.compression.rag.document_count.tooltip')}
            iconProps={{
              size: 16,
              color: 'var(--color-icon)',
              className: 'ml-1 cursor-pointer'
            }}
          />
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
