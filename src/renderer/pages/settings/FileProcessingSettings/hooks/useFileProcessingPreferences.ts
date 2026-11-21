import { useCallback, useMemo } from 'react'

import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import type {
  FileProcessorFeature,
  FileProcessorId,
  FileProcessorOverride
} from '@shared/data/preference/preferenceTypes'
import { type FileProcessorMerged, PRESETS_FILE_PROCESSORS } from '@shared/data/presets/fileProcessing'

const FILE_PROCESSING_KEYS = {
  defaultDocumentProcessor: 'feature.file_processing.default_document_to_markdown',
  defaultImageProcessor: 'feature.file_processing.default_image_to_text'
} as const

const DEFAULT_KEY_BY_FEATURE = {
  document_to_markdown: 'defaultDocumentProcessor',
  image_to_text: 'defaultImageProcessor'
} as const satisfies Record<FileProcessorFeature, keyof typeof FILE_PROCESSING_KEYS>

export function useFileProcessingPreferences() {
  const [preferences, setPreferences] = useMultiplePreferences(FILE_PROCESSING_KEYS)
  const [overrides, setOverrides] = usePreference('feature.file_processing.overrides')

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
      field: 'apiHost' | 'modelId' | 'formulaLevel' | 'mergeCrossPageForms',
      value: string | number | boolean
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

  /** Whether the processor carries user-set recognition options (capability fields or language options). */
  const hasProcessorOptions = useCallback(
    (processorId: FileProcessorId) => {
      const override = overrides[processorId]
      return Boolean(
        (override?.capabilities && Object.keys(override.capabilities).length > 0) ||
        (override?.options?.langs && override.options.langs.length > 0)
      )
    },
    [overrides]
  )

  /**
   * Reset a processor's recognition options (capability fields and language
   * options) to the preset defaults. API keys are credentials, not options,
   * and are kept.
   */
  const resetProcessorOptions = useCallback(
    async (processorId: FileProcessorId) => {
      const override = overrides[processorId]
      if (!override) {
        return
      }

      const next = { ...overrides }
      const kept: FileProcessorOverride = {}
      if (override.apiKeys && override.apiKeys.length > 0) {
        kept.apiKeys = override.apiKeys
      }
      if (Object.keys(kept).length > 0) {
        next[processorId] = kept
      } else {
        delete next[processorId]
      }
      await setOverrides(next)
    },
    [overrides, setOverrides]
  )

  return {
    defaultDocumentProcessor: preferences.defaultDocumentProcessor,
    defaultImageProcessor: preferences.defaultImageProcessor,
    overrides,
    processors,
    hasProcessorOptions,
    resetProcessorOptions,
    setApiKeys,
    setCapabilityField,
    setDefaultProcessor,
    setLanguageOptions
  }
}
