import { useMutation } from '@data/hooks/useDataApi'
import { usePreference } from '@data/hooks/usePreference'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { getFileProcessorLabelKey } from '@renderer/i18n/label'
import { PRESETS_FILE_PROCESSORS } from '@shared/data/presets/fileProcessing'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

import type { KnowledgeRagConfigFormValues } from '../types'
import { normalizeKnowledgeError } from '../utils/error'
import { buildKnowledgeRagConfigPatch, createKnowledgeRagConfigFormValues } from '../utils/rag'

const logger = loggerService.withContext('useKnowledgeRagConfig')

const KNOWLEDGE_V2_FILE_PROCESSORS = PRESETS_FILE_PROCESSORS.filter((preset) =>
  preset.capabilities.some(
    (capability) => capability.feature === 'document_to_markdown' && capability.inputs.includes('document')
  )
)

const canSelectFileProcessor = (processor: (typeof PRESETS_FILE_PROCESSORS)[number], apiKeys?: readonly string[]) =>
  processor.id === 'open-mineru' || processor.type !== 'api' || apiKeys?.some((key) => key.trim().length > 0) === true

export const useKnowledgeRagConfig = (base: KnowledgeBase) => {
  const { t } = useTranslation()
  const [fileProcessorOverrides] = usePreference('feature.file_processing.overrides')
  const { trigger, isLoading, error } = useMutation('PATCH', '/knowledge-bases/:id', {
    refresh: ['/knowledge-bases']
  })

  const initialValues = useMemo(() => createKnowledgeRagConfigFormValues(base), [base])

  const fileProcessorOptions = useMemo(
    () =>
      KNOWLEDGE_V2_FILE_PROCESSORS.map((processor) => ({
        value: processor.id,
        label: t(getFileProcessorLabelKey(processor.id)),
        disabled: !canSelectFileProcessor(processor, fileProcessorOverrides[processor.id]?.apiKeys)
      })),
    [fileProcessorOverrides, t]
  )

  const save = async (
    values: KnowledgeRagConfigFormValues,
    embeddingModelOverride?: { embeddingModelId: string | null; dimensions: number | null }
  ) => {
    const patch = buildKnowledgeRagConfigPatch(initialValues, values)

    if (embeddingModelOverride) {
      patch.embeddingModelId = embeddingModelOverride.embeddingModelId
      patch.dimensions = embeddingModelOverride.dimensions
    }

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
    save,
    isLoading,
    error
  }
}
