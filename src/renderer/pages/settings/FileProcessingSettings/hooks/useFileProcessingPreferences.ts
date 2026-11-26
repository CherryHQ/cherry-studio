import { useCallback, useMemo } from 'react'

import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { preferenceService } from '@data/PreferenceService'
import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
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
  const [overrides] = usePreference('feature.file_processing.overrides')

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

  // Single-field edits are applied in the main process against its current value, so a save
  // never writes back a stale whole-map snapshot (for example after a reset).
  const setApiKeys = useCallback(async (processorId: FileProcessorId, apiKeys: string[]) => {
    await preferenceService.editFileProcessorOption(processorId, { type: 'apiKeys', apiKeys })
  }, [])

  const setCapabilityField = useCallback(
    async (
      processorId: FileProcessorId,
      feature: FileProcessorFeature,
      field: 'apiHost' | 'modelId' | 'formulaLevel' | 'mergeCrossPageForms',
      value: string | number | boolean
    ) => {
      await preferenceService.editFileProcessorOption(processorId, { type: 'capability', feature, field, value })
    },
    []
  )

  const setLanguageOptions = useCallback(
    async (processorId: Extract<FileProcessorId, 'system' | 'tesseract'>, langs: string[]) => {
      await preferenceService.editFileProcessorOption(processorId, { type: 'langs', langs })
    },
    []
  )

  /** Whether the processor carries user-set recognition options (capability fields or language options). */
  const hasProcessorOptions = useCallback(
    (processorId: FileProcessorId) => {
      const override = overrides[processorId]
      return Boolean(
        (override?.capabilities &&
          Object.values(override.capabilities).some((capability) =>
            Object.keys(capability ?? {}).some((field) => field !== 'apiHost' || !override.apiKeys?.length)
          )) ||
        (override?.options?.langs && override.options.langs.length > 0)
      )
    },
    [overrides]
  )

  /**
   * Reset a processor's recognition options (capability fields and language
   * options) to the preset defaults. Saved credentials and their configured
   * API destinations stay together until the user explicitly edits them.
   */
  const resetProcessorOptions = useCallback(async (processorId: FileProcessorId) => {
    await preferenceService.resetFileProcessorOptions(processorId)
  }, [])

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
