import { useMultiplePreferences } from '@data/hooks/usePreference'
import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
import { mergeFileProcessorPresets } from '@shared/data/presets/file-processing'
import { useCallback, useMemo } from 'react'

import {
  updateProcessorApiKeys,
  updateProcessorCapabilityOverride,
  updateProcessorLanguageOptions
} from '../utils/fileProcessingPreferences'

const FILE_PROCESSING_KEYS = {
  defaultDocumentProcessor: 'feature.file_processing.default_document_to_markdown',
  defaultImageProcessor: 'feature.file_processing.default_image_to_text',
  overrides: 'feature.file_processing.overrides'
} as const

const DEFAULT_KEY_BY_FEATURE = {
  document_to_markdown: 'defaultDocumentProcessor',
  image_to_text: 'defaultImageProcessor'
} as const satisfies Record<FileProcessorFeature, keyof typeof FILE_PROCESSING_KEYS>

export function useFileProcessingPreferences() {
  const [preferences, setPreferences] = useMultiplePreferences(FILE_PROCESSING_KEYS, { optimistic: false })
  const overrides = preferences.overrides

  const processors = useMemo(() => mergeFileProcessorPresets(overrides), [overrides])

  const setDefaultProcessor = useCallback(
    async (feature: FileProcessorFeature, processorId: FileProcessorId) => {
      await setPreferences({
        [DEFAULT_KEY_BY_FEATURE[feature]]: processorId
      })
    },
    [setPreferences]
  )

  const setApiKeys = useCallback(
    async (processorId: FileProcessorId, apiKeys: string[]) => {
      await setPreferences({
        overrides: updateProcessorApiKeys(overrides, processorId, apiKeys)
      })
    },
    [overrides, setPreferences]
  )

  const setCapabilityField = useCallback(
    async (
      processorId: FileProcessorId,
      feature: FileProcessorFeature,
      field: 'apiHost' | 'modelId',
      value: string
    ) => {
      await setPreferences({
        overrides: updateProcessorCapabilityOverride(overrides, processorId, feature, field, value)
      })
    },
    [overrides, setPreferences]
  )

  const setLanguageOptions = useCallback(
    async (processorId: Extract<FileProcessorId, 'system' | 'tesseract'>, langs: string[]) => {
      await setPreferences({
        overrides: updateProcessorLanguageOptions(overrides, processorId, langs)
      })
    },
    [overrides, setPreferences]
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
