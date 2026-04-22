import { useModels } from '@renderer/hooks/useModels'
import { getFileProcessorLabel } from '@renderer/i18n/label'
import { PRESETS_FILE_PROCESSORS } from '@shared/data/presets/file-processing'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { isUniqueModelId, MODEL_CAPABILITY, parseUniqueModelId } from '@shared/data/types/model'
import { useMemo } from 'react'

import { createKnowledgeV2RagConfigFormValues } from '../utils/ragConfig'

const KNOWLEDGE_V2_FILE_PROCESSORS = PRESETS_FILE_PROCESSORS.filter((preset) =>
  preset.capabilities.some(
    (capability) => capability.feature === 'markdown_conversion' && capability.inputs.includes('document')
  )
)

const formatModelOptionLabel = (uniqueModelId: string) => {
  if (!isUniqueModelId(uniqueModelId)) {
    return uniqueModelId
  }

  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  return `${modelId} · ${providerId}`
}

export const useKnowledgeV2RagConfig = (base: KnowledgeBase) => {
  const { models: embeddingModels } = useModels({
    capability: MODEL_CAPABILITY.EMBEDDING,
    enabled: true
  })
  const { models: rerankModels } = useModels({
    capability: MODEL_CAPABILITY.RERANK,
    enabled: true
  })

  const initialValues = useMemo(() => createKnowledgeV2RagConfigFormValues(base), [base])

  const fileProcessorOptions = useMemo(() => {
    return KNOWLEDGE_V2_FILE_PROCESSORS.map((processor) => ({
      value: processor.id,
      label: getFileProcessorLabel(processor.id)
    }))
  }, [])

  const embeddingModelOptions = useMemo(() => {
    return embeddingModels.map((model) => ({
      value: model.id,
      label: formatModelOptionLabel(model.id)
    }))
  }, [embeddingModels])

  const rerankModelOptions = useMemo(() => {
    return rerankModels.map((model) => ({
      value: model.id,
      label: formatModelOptionLabel(model.id)
    }))
  }, [rerankModels])

  return {
    initialValues,
    fileProcessorOptions,
    embeddingModelOptions,
    rerankModelOptions
  }
}
