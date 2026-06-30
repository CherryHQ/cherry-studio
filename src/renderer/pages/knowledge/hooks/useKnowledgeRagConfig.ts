import { useMutation } from '@data/hooks/useDataApi'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { getFileProcessorLabelKey } from '@renderer/i18n/label'
import { PRESETS_FILE_PROCESSORS } from '@shared/data/presets/fileProcessing'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
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

type FileProcessorApiKeyState = {
  type: (typeof PRESETS_FILE_PROCESSORS)[number]['type']
  apiKeys?: readonly string[]
}

const hasConfiguredApiKey = (processor: FileProcessorApiKeyState) =>
  processor.type !== 'api' || processor.apiKeys?.some((key) => key.trim().length > 0) === true

export const useKnowledgeRagConfig = (base: KnowledgeBase) => {
  const { t } = useTranslation()
  const [fileProcessorOverrides] = usePreference('feature.file_processing.overrides')
  const { trigger, isLoading, error } = useMutation('PATCH', '/knowledge-bases/:id', {
    refresh: ['/knowledge-bases']
  })

  const initialValues = useMemo(() => createKnowledgeRagConfigFormValues(base), [base])

  const fileProcessorOptions = useMemo(() => {
    return KNOWLEDGE_V2_FILE_PROCESSORS.map((processor) => {
      const override = fileProcessorOverrides[processor.id]

      return {
        ...processor,
        apiKeys: override?.apiKeys
      }
    })
      .filter(hasConfiguredApiKey)
      .map((processor) => ({
        value: processor.id,
        label: t(getFileProcessorLabelKey(processor.id))
      }))
  }, [fileProcessorOverrides, t])

  const searchModeOptions = useMemo<KnowledgeSelectOption[]>(() => {
    const bm25Option = { value: 'bm25', label: t('knowledge.rag.search_mode.bm25') }
    // Vector/hybrid retrieval needs an embedding model; a BM25-only base searches lexically only.
    if (base.embeddingModelId === null) {
      return [bm25Option]
    }

    return [
      { value: 'hybrid', label: t('knowledge.rag.search_mode.hybrid') },
      { value: 'vector', label: t('knowledge.rag.search_mode.vector') },
      bm25Option
    ]
  }, [t, base.embeddingModelId])

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
    fileProcessorOptions,
    searchModeOptions,
    save,
    isLoading,
    error
  }
}
