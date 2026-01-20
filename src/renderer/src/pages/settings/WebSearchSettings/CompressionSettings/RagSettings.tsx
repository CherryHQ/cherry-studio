import { InfoTooltip } from '@cherrystudio/ui'
import InputEmbeddingDimension from '@renderer/components/InputEmbeddingDimension'
import ModelSelector from '@renderer/components/ModelSelector'
import { DEFAULT_WEBSEARCH_RAG_DOCUMENT_COUNT } from '@renderer/config/constant'
import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { NOT_SUPPORTED_RERANK_PROVIDERS } from '@renderer/config/providers'
import { useModel } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearch'
import { SettingDivider, SettingRow, SettingRowTitle } from '@renderer/pages/settings'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { Model } from '@renderer/types'
import { Slider } from 'antd'
import { find } from 'lodash'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const INPUT_BOX_WIDTH = 'min(350px, 60%)'

const RagSettings = () => {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const {
    ragDocumentCount,
    setRagDocumentCount,
    ragEmbeddingModelId,
    ragEmbeddingProviderId,
    setRagEmbeddingModelId,
    setRagEmbeddingProviderId,
    ragEmbeddingDimensions,
    setRagEmbeddingDimensions,
    ragRerankModelId,
    ragRerankProviderId,
    setRagRerankModelId,
    setRagRerankProviderId
  } = useWebSearchSettings()

  // Get the actual model objects from stored ids
  const embeddingModel = useModel(ragEmbeddingModelId ?? undefined, ragEmbeddingProviderId ?? undefined)
  const rerankModel = useModel(ragRerankModelId ?? undefined, ragRerankProviderId ?? undefined)

  const embeddingModels = useMemo(() => {
    return providers.flatMap((p) => p.models).filter((model) => isEmbeddingModel(model))
  }, [providers])

  const rerankModels = useMemo(() => {
    return providers.flatMap((p) => p.models).filter((model) => isRerankModel(model))
  }, [providers])

  const rerankProviders = useMemo(() => {
    return providers.filter((p) => !NOT_SUPPORTED_RERANK_PROVIDERS.some((pid) => p.id === pid))
  }, [providers])

  const handleEmbeddingModelChange = (modelValue: string) => {
    const selectedModel = find(embeddingModels, JSON.parse(modelValue)) as Model
    if (selectedModel) {
      setRagEmbeddingModelId(selectedModel.id)
      setRagEmbeddingProviderId(selectedModel.provider)
    }
  }

  const handleRerankModelChange = (modelValue?: string) => {
    if (modelValue) {
      const selectedModel = find(rerankModels, JSON.parse(modelValue)) as Model
      if (selectedModel) {
        setRagRerankModelId(selectedModel.id)
        setRagRerankProviderId(selectedModel.provider)
      }
    } else {
      setRagRerankModelId(null)
      setRagRerankProviderId(null)
    }
  }

  const handleEmbeddingDimensionsChange = (value: number | null) => {
    setRagEmbeddingDimensions(value)
  }

  const handleDocumentCountChange = (value: number) => {
    setRagDocumentCount(value)
  }

  return (
    <>
      <SettingRow>
        <SettingRowTitle>{t('models.embedding_model')}</SettingRowTitle>
        <ModelSelector
          providers={providers}
          predicate={isEmbeddingModel}
          value={embeddingModel ? getModelUniqId(embeddingModel) : undefined}
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
          value={ragEmbeddingDimensions ?? undefined}
          onChange={handleEmbeddingDimensionsChange}
          model={embeddingModel}
          disabled={!embeddingModel}
          style={{ width: INPUT_BOX_WIDTH }}
        />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('models.rerank_model')}</SettingRowTitle>
        <ModelSelector
          providers={rerankProviders}
          predicate={isRerankModel}
          value={rerankModel ? getModelUniqId(rerankModel) : undefined}
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
            value={ragDocumentCount || DEFAULT_WEBSEARCH_RAG_DOCUMENT_COUNT}
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
