import InputEmbeddingDimension from '@renderer/components/InputEmbeddingDimension'
import ModelSelector from '@renderer/components/ModelSelector'
import { DEFAULT_WEBSEARCH_RAG_DOCUMENT_COUNT } from '@renderer/config/constant'
import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { NOT_SUPPORTED_REANK_PROVIDERS } from '@renderer/config/providers'
import { useProviders } from '@renderer/hooks/useProvider'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearchProviders'
import { SettingDivider, SettingRow, SettingRowTitle } from '@renderer/pages/settings'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Model } from '@renderer/types'
import { Slider, Tooltip } from 'antd'
import { find } from 'lodash'
import { Info } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const INPUT_BOX_WIDTH = 'min(350px, 60%)'

const RagSettings = () => {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const { compressionConfig, updateCompressionConfig } = useWebSearchSettings()

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
          <Tooltip title={t('knowledge.dimensions_size_tooltip')}>
            <Info size={16} color="var(--color-icon)" style={{ marginLeft: 5, cursor: 'pointer' }} />
          </Tooltip>
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
