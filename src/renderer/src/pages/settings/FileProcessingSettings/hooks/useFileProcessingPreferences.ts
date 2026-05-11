import { useMultiplePreferences } from '@data/hooks/usePreference'
import type {
  FileProcessorFeature,
  FileProcessorId,
  FileProcessorOverrides
} from '@shared/data/preference/preferenceTypes'
import {
  mergeFileProcessorPresets,
  updateProcessorApiKeys,
  updateProcessorCapabilityOverride,
  updateProcessorLanguageOptions
} from '@shared/data/utils/fileProcessorMerger'
import { useCallback, useEffect, useMemo, useRef } from 'react'

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
  const overridesRef = useRef(overrides)
  const overridesUpdateQueueRef = useRef(Promise.resolve())

  useEffect(() => {
    overridesRef.current = overrides
  }, [overrides])

  const processors = useMemo(() => mergeFileProcessorPresets(overrides), [overrides])

  const setDefaultProcessor = useCallback(
    async (feature: FileProcessorFeature, processorId: FileProcessorId) => {
      await setPreferences({
        [DEFAULT_KEY_BY_FEATURE[feature]]: processorId
      })
    },
    [setPreferences]
  )

  const updateOverrides = useCallback(
    (updater: (currentOverrides: FileProcessorOverrides) => FileProcessorOverrides) => {
      const update = overridesUpdateQueueRef.current.then(async () => {
        const nextOverrides = updater(overridesRef.current)
        await setPreferences({
          overrides: nextOverrides
        })
        overridesRef.current = nextOverrides
      })

      overridesUpdateQueueRef.current = update.catch(() => undefined)
      return update
    },
    [setPreferences]
  )

  const setApiKeys = useCallback(
    async (processorId: FileProcessorId, apiKeys: string[]) => {
      await updateOverrides((currentOverrides) => updateProcessorApiKeys(currentOverrides, processorId, apiKeys))
    },
    [updateOverrides]
  )

  const setCapabilityField = useCallback(
    async (
      processorId: FileProcessorId,
      feature: FileProcessorFeature,
      field: 'apiHost' | 'modelId',
      value: string
    ) => {
      await updateOverrides((currentOverrides) =>
        updateProcessorCapabilityOverride(currentOverrides, processorId, feature, field, value)
      )
    },
    [updateOverrides]
  )

  const setLanguageOptions = useCallback(
    async (processorId: Extract<FileProcessorId, 'system' | 'tesseract'>, langs: string[]) => {
      await updateOverrides((currentOverrides) => updateProcessorLanguageOptions(currentOverrides, processorId, langs))
    },
    [updateOverrides]
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
