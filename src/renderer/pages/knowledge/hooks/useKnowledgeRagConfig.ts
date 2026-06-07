import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { useModels } from '@renderer/hooks/useModel'
import { getFileProcessorLabel } from '@renderer/i18n/label'
import { PRESETS_FILE_PROCESSORS } from '@shared/data/presets/file-processing'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { KnowledgeRagConfigFormValues, KnowledgeSelectOption } from '../types'
import { buildKnowledgeRagConfigPatch, createKnowledgeRagConfigFormValues, normalizeKnowledgeError } from '../utils'

const logger = loggerService.withContext('useKnowledgeRagConfig')

const KNOWLEDGE_V2_FILE_PROCESSORS = PRESETS_FILE_PROCESSORS.filter((preset) =>
  preset.capabilities.some(
    (capability) => capability.feature === 'document_to_markdown' && capability.inputs.includes('document')
  )
)

export const useKnowledgeRagConfig = (base: KnowledgeBase) => {
  const { t } = useTranslation()
  const { models: embeddingModels } = useModels({
    capability: MODEL_CAPABILITY.EMBEDDING,
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

  const searchModeOptions = useMemo<KnowledgeSelectOption[]>(
    () => [
      { value: 'hybrid', label: t('knowledge.rag.search_mode.hybrid') },
      { value: 'default', label: t('knowledge.rag.search_mode.default') },
      { value: 'bm25', label: t('knowledge.rag.search_mode.bm25') }
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
      const normalizedError = normalizeKnowledgeError(saveError)
      logger.error('Failed to update knowledge RAG config', normalizedError, {
        baseId: base.id,
        updates: patch
      })
      throw normalizedError
    }
  }

  return {
    initialValues,
    embeddingModels,
    fileProcessorOptions,
    searchModeOptions,
    save,
    isLoading,
    error
  }
}
