import { usePreference } from '@data/hooks/usePreference'
import type { FeatureCapability, FileProcessorTemplate } from '@renderer/config/fileProcessing'
import {
  FILE_PROCESSOR_TEMPLATES,
  getDocumentProcessorTemplates,
  getImageProcessorTemplates,
  supportsInput
} from '@renderer/config/fileProcessing'
import type {
  FeatureUserConfig,
  FileProcessorOptions,
  FileProcessorUserConfig
} from '@shared/data/preference/preferenceTypes'
import { useCallback, useMemo } from 'react'
import useSWRImmutable from 'swr/immutable'

/**
 * Merged processor configuration (template + user config)
 */
export type FileProcessorMerged = FileProcessorTemplate & {
  apiKey?: string
  featureConfigs?: FeatureUserConfig[]
  options?: FileProcessorOptions
}

/**
 * Merge processor templates with user configurations
 */
function mergeProcessorConfigs(
  templates: FileProcessorTemplate[],
  userConfigs: FileProcessorUserConfig[]
): FileProcessorMerged[] {
  return templates.map((template) => {
    const userConfig = userConfigs.find((c) => c.id === template.id)
    return {
      ...template,
      apiKey: userConfig?.apiKey,
      featureConfigs: userConfig?.featureConfigs,
      options: userConfig?.options
    }
  })
}

/**
 * Get the effective API host for a specific capability
 * Priority: user config > template default
 */
export function getEffectiveApiHost(processor: FileProcessorMerged, capability: FeatureCapability): string | undefined {
  // Check user config for this feature
  const featureConfig = processor.featureConfigs?.find((fc) => fc.feature === capability.feature)
  if (featureConfig?.apiHost !== undefined) {
    return featureConfig.apiHost
  }
  // Fall back to template default
  return capability.defaultApiHost
}

/**
 * Get the effective model ID for a specific capability
 * Priority: user config > template default
 */
export function getEffectiveModelId(processor: FileProcessorMerged, capability: FeatureCapability): string | undefined {
  // Check user config for this feature
  const featureConfig = processor.featureConfigs?.find((fc) => fc.feature === capability.feature)
  if (featureConfig?.modelId) {
    return featureConfig.modelId
  }
  // Fall back to template default
  return capability.defaultModelId
}

/**
 * Hook for accessing all file processors with merged configurations
 */
export function useFileProcessors() {
  const [userConfigs, setUserConfigs] = usePreference('feature.file_processing.processors')

  const processors = useMemo(() => mergeProcessorConfigs(FILE_PROCESSOR_TEMPLATES, userConfigs), [userConfigs])

  const updateProcessorConfig = useCallback(
    async (processorId: string, update: Partial<Omit<FileProcessorUserConfig, 'id'>>) => {
      const existingIndex = userConfigs.findIndex((c) => c.id === processorId)
      let newConfigs: FileProcessorUserConfig[]

      if (existingIndex >= 0) {
        // Update existing config
        newConfigs = [...userConfigs]
        newConfigs[existingIndex] = { ...newConfigs[existingIndex], ...update }
      } else {
        // Add new config
        newConfigs = [...userConfigs, { id: processorId, ...update }]
      }

      await setUserConfigs(newConfigs)
    },
    [userConfigs, setUserConfigs]
  )

  return {
    processors,
    userConfigs,
    updateProcessorConfig
  }
}

/**
 * Hook for accessing image processors (support IMAGE input)
 */
export function useImageProcessors() {
  const [userConfigs] = usePreference('feature.file_processing.processors')

  const processors = useMemo(() => mergeProcessorConfigs(getImageProcessorTemplates(), userConfigs), [userConfigs])

  return processors
}

function useOcrProviderAvailability(providerId: string): boolean | undefined {
  const fetcher = useCallback(() => window.api.ocr.isProviderAvailable(providerId), [providerId])
  const { data } = useSWRImmutable(`ocr/provider/${providerId}`, fetcher)

  return data
}

/**
 * Hook for accessing available image processors based on OCR provider availability
 */
export function useAvailableImageProcessors() {
  const processors = useImageProcessors()
  const systemAvailable = useOcrProviderAvailability('system')
  const ovocrAvailable = useOcrProviderAvailability('ovocr')

  return useMemo(
    () =>
      processors.filter((processor) => {
        if (processor.id === 'system') {
          return systemAvailable === true
        }
        if (processor.id === 'ovocr') {
          return ovocrAvailable === true
        }
        return true
      }),
    [ovocrAvailable, processors, systemAvailable]
  )
}

/**
 * Hook for accessing document processors (support DOCUMENT input)
 */
export function useDocumentProcessors() {
  const [userConfigs] = usePreference('feature.file_processing.processors')

  const processors = useMemo(() => mergeProcessorConfigs(getDocumentProcessorTemplates(), userConfigs), [userConfigs])

  return processors
}

/**
 * Hook for accessing a single processor by ID
 */
export function useFileProcessor(processorId: string) {
  const { processors, updateProcessorConfig } = useFileProcessors()

  const processor = useMemo(() => processors.find((p) => p.id === processorId), [processors, processorId])

  const updateConfig = useCallback(
    (update: Partial<Omit<FileProcessorUserConfig, 'id'>>) => {
      updateProcessorConfig(processorId, update)
    },
    [processorId, updateProcessorConfig]
  )

  return {
    processor,
    updateConfig
  }
}

/**
 * Hook for managing default processors
 */
export function useDefaultProcessors() {
  const [defaultDocumentProcessor, setDefaultDocumentProcessor] = usePreference(
    'feature.file_processing.default_document_processor'
  )
  const [defaultImageProcessor, setDefaultImageProcessor] = usePreference(
    'feature.file_processing.default_image_processor'
  )

  return {
    defaultDocumentProcessor,
    setDefaultDocumentProcessor,
    defaultImageProcessor,
    setDefaultImageProcessor
  }
}

/**
 * Hook for getting configured (with apiKey) processors
 */
export function useConfiguredProcessors() {
  const { processors } = useFileProcessors()

  const configuredProcessors = useMemo(() => processors.filter((p) => p.apiKey || p.type === 'builtin'), [processors])

  const configuredImageProcessors = useMemo(
    () => configuredProcessors.filter((p) => supportsInput(p, 'image')),
    [configuredProcessors]
  )

  const configuredDocumentProcessors = useMemo(
    () => configuredProcessors.filter((p) => supportsInput(p, 'document')),
    [configuredProcessors]
  )

  return {
    configuredProcessors,
    configuredImageProcessors,
    configuredDocumentProcessors
  }
}
