import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import type {
  FileProcessorFeature,
  FileProcessorId,
  FileProcessorOverride
} from '@shared/data/preference/preferenceTypes'
import { type FileProcessorMerged, PRESETS_FILE_PROCESSORS } from '@shared/data/presets/file-processing'
import { useCallback, useMemo } from 'react'

const FILE_PROCESSING_KEYS = {
  defaultDocumentProcessor: 'feature.file_processing.default_document_to_markdown',
  defaultImageProcessor: 'feature.file_processing.default_image_to_text'
} as const

const DEFAULT_KEY_BY_FEATURE = {
  document_to_markdown: 'defaultDocumentProcessor',
  image_to_text: 'defaultImageProcessor'
} as const satisfies Record<FileProcessorFeature, keyof typeof FILE_PROCESSING_KEYS>

export function useFileProcessingPreferences() {
  const [preferences, setPreferences] = useMultiplePreferences(FILE_PROCESSING_KEYS, { optimistic: false })
  const [overrides, setOverrides] = usePreference('feature.file_processing.overrides', { optimistic: false })

  const processors = useMemo<FileProcessorMerged[]>(() => {
    return PRESETS_FILE_PROCESSORS.map((preset) => {
      const override = overrides[preset.id]

      return {
        ...preset,
        ...override,
        capabilities: preset.capabilities.map((capability) => ({
          ...capability,
          ...override?.capabilities?.[capability.feature]
        }))
      }
    })
  }, [overrides])

  const setDefaultProcessor = useCallback(
    async (feature: FileProcessorFeature, processorId: FileProcessorId) => {
      await setPreferences({
        [DEFAULT_KEY_BY_FEATURE[feature]]: processorId
      })
    },
    [setPreferences]
  )

  const updateProcessor = useCallback(
    async (processorId: FileProcessorId, patch: FileProcessorOverride) => {
      await setOverrides({
        ...overrides,
        [processorId]: { ...overrides[processorId], ...patch }
      })
    },
    [overrides, setOverrides]
  )

  const setApiKeys = useCallback(
    async (processorId: FileProcessorId, apiKeys: string[]) => {
      await updateProcessor(processorId, { apiKeys })
    },
    [updateProcessor]
  )

  const setCapabilityField = useCallback(
    async (
      processorId: FileProcessorId,
      feature: FileProcessorFeature,
      field: 'apiHost' | 'modelId',
      value: string
    ) => {
      await updateProcessor(processorId, {
        capabilities: {
          ...overrides[processorId]?.capabilities,
          [feature]: {
            ...overrides[processorId]?.capabilities?.[feature],
            [field]: value
          }
        }
      })
    },
    [overrides, updateProcessor]
  )

  const setLanguageOptions = useCallback(
    async (processorId: Extract<FileProcessorId, 'system' | 'tesseract'>, langs: string[]) => {
      await updateProcessor(processorId, {
        options: { ...overrides[processorId]?.options, langs }
      })
    },
    [overrides, updateProcessor]
  )

  return {
    defaultDocumentProcessor: preferences.defaultDocumentProcessor,
    defaultImageProcessor: preferences.defaultImageProcessor,
    overrides,
    processors,
    setApiKeys,
    setCapabilityField,
    setDefaultProcessor,
    setLanguageOptions
  }
}
