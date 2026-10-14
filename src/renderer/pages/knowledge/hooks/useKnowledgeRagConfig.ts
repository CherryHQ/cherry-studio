import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useMutation } from '@data/hooks/useDataApi'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useAvailableFileProcessors } from '@renderer/hooks/useAvailableFileProcessors'
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

/**
 * Answers only "has the user supplied the credential this processor needs".
 * Self-hosted processors need none, so they pass here unconditionally — whether
 * their server is actually up is a separate probe, applied in FileProcessingSection.
 */
const canSelectFileProcessor = (processor: (typeof PRESETS_FILE_PROCESSORS)[number], apiKeys?: readonly string[]) =>
  processor.id === 'open-mineru' || processor.type !== 'api' || apiKeys?.some((key) => key.trim().length > 0) === true

export const useKnowledgeRagConfig = (base: KnowledgeBase) => {
  const { t } = useTranslation()
  const [fileProcessorOverrides] = usePreference('feature.file_processing.overrides')
  const availableProcessors = useAvailableFileProcessors()
  const { trigger, isLoading, error } = useMutation('PATCH', '/knowledge-bases/:id', {
    refresh: ['/knowledge-bases']
  })

  const initialValues = useMemo(() => createKnowledgeRagConfigFormValues(base), [base])

  const fileProcessorOptions = useMemo(
    () =>
      KNOWLEDGE_V2_FILE_PROCESSORS.flatMap((processor) => {
        const isInitialProcessor = processor.id === initialValues.fileProcessorId
        const isSupported = availableProcessors.status === 'ready' && availableProcessors.processorIds.has(processor.id)
        const shouldKeepInitialWhileUnavailable = availableProcessors.status !== 'ready' && isInitialProcessor
        if (!isSupported && !shouldKeepInitialWhileUnavailable) {
          return []
        }

        const isConfigured = canSelectFileProcessor(processor, fileProcessorOverrides[processor.id]?.apiKeys)
        const disabled = !isSupported || !isConfigured

        return [
          {
            value: processor.id,
            label: t(getFileProcessorLabelKey(processor.id)),
            disabled,
            statusLabel: isSupported && !isConfigured ? t('knowledge.rag.processor_not_configured') : undefined
          }
        ]
      }),
    [
      availableProcessors.processorIds,
      availableProcessors.status,
      fileProcessorOverrides,
      initialValues.fileProcessorId,
      t
    ]
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
