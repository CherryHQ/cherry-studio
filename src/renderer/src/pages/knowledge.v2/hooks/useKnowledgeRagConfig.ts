import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { useModels } from '@renderer/hooks/useModels'
import { getFileProcessorLabel } from '@renderer/i18n/label'
import { PRESETS_FILE_PROCESSORS } from '@shared/data/presets/file-processing'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { isUniqueModelId, MODEL_CAPABILITY, parseUniqueModelId } from '@shared/data/types/model'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { KnowledgeRagConfigFormValues, KnowledgeSelectOption } from '../types'
import { buildKnowledgeRagConfigPatch, createKnowledgeRagConfigFormValues } from '../utils'

const logger = loggerService.withContext('useKnowledgeRagConfig')

const KNOWLEDGE_V2_FILE_PROCESSORS = PRESETS_FILE_PROCESSORS.filter((preset) =>
  preset.capabilities.some(
    (capability) => capability.feature === 'document_to_markdown' && capability.inputs.includes('document')
  )
)

const formatModelOptionLabel = (uniqueModelId: string) => {
  if (!isUniqueModelId(uniqueModelId)) {
    return uniqueModelId
  }

  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  return `${modelId} · ${providerId}`
}

export const useKnowledgeRagConfig = (base: KnowledgeBase) => {
  const { t } = useTranslation()
  const { models: embeddingModels } = useModels({
    capability: MODEL_CAPABILITY.EMBEDDING,
    enabled: true
  })
  const { models: rerankModels } = useModels({
    capability: MODEL_CAPABILITY.RERANK,
    enabled: true
  })
  const { trigger, isLoading, error } = useMutation('PATCH', '/knowledge-bases/:id', {
    refresh: ['/knowledge-bases']
  })

  const initialValues = useMemo(() => createKnowledgeRagConfigFormValues(base), [base])

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

  const searchModeOptions = useMemo<KnowledgeSelectOption[]>(
    () => [
      { value: 'hybrid', label: t('knowledge_v2.rag.search_mode.hybrid') },
      { value: 'default', label: t('knowledge_v2.rag.search_mode.default') },
      { value: 'bm25', label: t('knowledge_v2.rag.search_mode.bm25') }
    ],
    [t]
  )

  const save = async (values: KnowledgeRagConfigFormValues) => {
    const patch = buildKnowledgeRagConfigPatch(initialValues, values)

    try {
      return await trigger({
        params: { id: base.id },
        body: patch
      })
    } catch (saveError) {
      logger.error('Failed to update knowledge RAG config', {
        baseId: base.id,
        updates: patch,
        error: saveError
      })
      throw saveError
    }
  }

  return {
    initialValues,
    fileProcessorOptions,
    embeddingModelOptions,
    rerankModelOptions,
    searchModeOptions,
    save,
    isLoading,
    error
  }
}
