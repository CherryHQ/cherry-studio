import { isEmbeddingModel, isRerankModel } from '@renderer/config/models/embedding'
import { usePreprocessProviders } from '@renderer/hooks/usePreprocess'
import { useProviders } from '@renderer/hooks/useProvider'
import { getFancyProviderName } from '@renderer/utils/naming'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { createUniqueModelId } from '@shared/data/types/model'
import { useMemo } from 'react'

import type { KnowledgeV2SelectOption } from '../types'
import { createKnowledgeV2RagConfigFormValues } from '../utils/ragConfig'

const appendCurrentOption = (
  options: KnowledgeV2SelectOption[],
  currentValue: string | null,
  createLabel: (value: string) => string = (value) => value
) => {
  if (!currentValue || options.some((option) => option.value === currentValue)) {
    return options
  }

  return [...options, { value: currentValue, label: createLabel(currentValue) }]
}

export const useKnowledgeV2RagConfig = (base: KnowledgeBase) => {
  const { providers } = useProviders()
  const { preprocessProviders } = usePreprocessProviders()

  const initialValues = useMemo(() => createKnowledgeV2RagConfigFormValues(base), [base])

  const fileProcessorOptions = useMemo(() => {
    const options = preprocessProviders.map((provider) => ({
      value: provider.id,
      label: provider.name
    }))

    return appendCurrentOption(options, base.fileProcessorId ?? null)
  }, [base.fileProcessorId, preprocessProviders])

  const embeddingModelOptions = useMemo(() => {
    const options = providers.flatMap((provider) =>
      provider.models.filter(isEmbeddingModel).map((model) => ({
        value: createUniqueModelId(provider.id, model.id),
        label: `${model.name} · ${getFancyProviderName(provider)}`
      }))
    )

    return appendCurrentOption(options, base.embeddingModelId)
  }, [base.embeddingModelId, providers])

  const rerankModelOptions = useMemo(() => {
    const options = providers.flatMap((provider) =>
      provider.models.filter(isRerankModel).map((model) => ({
        value: createUniqueModelId(provider.id, model.id),
        label: `${model.name} · ${getFancyProviderName(provider)}`
      }))
    )

    return appendCurrentOption(options, base.rerankModelId ?? null)
  }, [base.rerankModelId, providers])

  return {
    initialValues,
    fileProcessorOptions,
    embeddingModelOptions,
    rerankModelOptions
  }
}
