import { InfoTooltip, Slider } from '@cherrystudio/ui'
import InputEmbeddingDimension from '@renderer/components/InputEmbeddingDimension'
import ModelSelector from '@renderer/components/ModelSelector'
import { DEFAULT_WEBSEARCH_RAG_DOCUMENT_COUNT } from '@renderer/config/constant'
import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { NOT_SUPPORTED_RERANK_PROVIDERS } from '@renderer/config/providers'
import { useModel } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import { useRagCompression } from '@renderer/hooks/useWebSearch'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { Model } from '@renderer/types'
import { find } from 'lodash'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

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
  } = useRagCompression()

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
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-row justify-between">
        <div>{t('models.embedding_model')}</div>
        <ModelSelector
          className="w-1/3"
          providers={providers}
          predicate={isEmbeddingModel}
          value={embeddingModel ? getModelUniqId(embeddingModel) : undefined}
          placeholder={t('settings.models.empty')}
          onChange={handleEmbeddingModelChange}
          allowClear={false}
        />
      </div>
      <div className="border-border border-b" />

      <div className="flex flex-row justify-between">
        <div className="flex flex-row items-center gap-1">
          {t('models.embedding_dimensions')}
          <InfoTooltip
            content={t('knowledge.dimensions_size_tooltip')}
            iconProps={{
              size: 16,
              color: 'var(--color-icon)',
              className: 'ml-1 cursor-pointer'
            }}
          />
        </div>
        <InputEmbeddingDimension
          style={{ width: '33%' }}
          value={ragEmbeddingDimensions ?? undefined}
          onChange={handleEmbeddingDimensionsChange}
          model={embeddingModel}
          disabled={!embeddingModel}
        />
      </div>
      <div className="border-border border-b" />

      <div className="flex flex-row justify-between">
        <div>{t('models.rerank_model')}</div>
        <ModelSelector
          className="w-1/3"
          providers={rerankProviders}
          predicate={isRerankModel}
          value={rerankModel ? getModelUniqId(rerankModel) : undefined}
          placeholder={t('settings.models.empty')}
          onChange={handleRerankModelChange}
          allowClear
        />
      </div>
      <div className="border-border border-b" />

      <div className="flex flex-row justify-between">
        <div className="flex flex-row items-center gap-1">
          {t('settings.tool.websearch.compression.rag.document_count.label')}
          <InfoTooltip
            content={t('settings.tool.websearch.compression.rag.document_count.tooltip')}
            iconProps={{
              size: 16,
              color: 'var(--color-icon)',
              className: 'ml-1 cursor-pointer'
            }}
          />
        </div>
        <Slider
          className="w-1/3"
          value={[ragDocumentCount || DEFAULT_WEBSEARCH_RAG_DOCUMENT_COUNT]}
          min={1}
          max={10}
          step={1}
          onValueChange={(values) => handleDocumentCountChange(values[0])}
          marks={[
            { value: 1, label: t('common.default') },
            { value: 3, label: '3' },
            { value: 10, label: '10' }
          ]}
        />
      </div>
    </div>
  )
}

export default RagSettings
