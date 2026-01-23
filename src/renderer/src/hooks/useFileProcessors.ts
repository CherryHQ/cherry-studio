import { usePreference } from '@data/hooks/usePreference'
import type { FeatureCapability, FileProcessorTemplate } from '@renderer/config/fileProcessing'
import {
  FILE_PROCESSOR_TEMPLATES,
  getDocumentProcessorTemplates,
  getFileProcessorTemplate,
  getImageProcessorTemplates,
  supportsInput
} from '@renderer/config/fileProcessing'
import type {
  FeatureUserConfig,
  FileProcessorMerged,
  FileProcessorOptions,
  FileProcessorOverride,
  FileProcessorOverrides
} from '@shared/data/presets/fileProcessing'
import { useCallback, useMemo } from 'react'
import useSWRImmutable from 'swr/immutable'

function normalizeApiHost(value?: string): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
}

function normalizeOptionalString(value?: string): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function normalizeOptions(options?: FileProcessorOptions): FileProcessorOptions | undefined {
  if (!options) return undefined
  return Object.keys(options).length > 0 ? options : undefined
}

function getFeatureDefaults(
  template: FileProcessorTemplate | undefined,
  feature: FeatureUserConfig['feature']
): FeatureUserConfig {
  const capability = template?.capabilities.find((item) => item.feature === feature)
  return {
    feature,
    apiHost: normalizeApiHost(capability?.defaultApiHost),
    modelId: normalizeOptionalString(capability?.defaultModelId)
  }
}

function normalizeFeatureConfigs(
  template: FileProcessorTemplate | undefined,
  featureConfigs?: FeatureUserConfig[]
): FeatureUserConfig[] | undefined {
  if (!featureConfigs || featureConfigs.length === 0) return undefined

  const normalized = featureConfigs.reduce<FeatureUserConfig[]>((acc, config) => {
    const defaults = getFeatureDefaults(template, config.feature)
    const apiHost = normalizeApiHost(config.apiHost)
    const modelId = normalizeOptionalString(config.modelId)

    const nextConfig: FeatureUserConfig = { feature: config.feature }

    if (apiHost && apiHost !== defaults.apiHost) {
      nextConfig.apiHost = apiHost
    }
    if (modelId && modelId !== defaults.modelId) {
      nextConfig.modelId = modelId
    }

    if (nextConfig.apiHost || nextConfig.modelId) {
      acc.push(nextConfig)
    }

    return acc
  }, [])

  return normalized.length > 0 ? normalized : undefined
}

function normalizeOverride(processorId: string, override: FileProcessorOverride): FileProcessorOverride | undefined {
  const template = getFileProcessorTemplate(processorId)
  const apiKey = normalizeOptionalString(override.apiKey)
  const featureConfigs = normalizeFeatureConfigs(template, override.featureConfigs)
  const options = normalizeOptions(override.options)

  if (!apiKey && !featureConfigs && !options) {
    return undefined
  }

  return {
    ...(apiKey ? { apiKey } : {}),
    ...(featureConfigs ? { featureConfigs } : {}),
    ...(options ? { options } : {})
  }
}

/**
 * Merge processor templates with user overrides
 */
function mergeProcessorConfigs(
  templates: FileProcessorTemplate[],
  overrides: FileProcessorOverrides
): FileProcessorMerged[] {
  return templates.map((template) => ({
    ...template,
    ...overrides[template.id]
  }))
}

function useFileProcessorOverrides() {
  const [overrides, setOverrides] = usePreference('feature.file_processing.overrides')

  return {
    overrides,
    setOverrides
  }
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
  const { overrides, setOverrides } = useFileProcessorOverrides()

  const processors = useMemo(() => mergeProcessorConfigs(FILE_PROCESSOR_TEMPLATES, overrides), [overrides])

  const updateProcessorConfig = useCallback(
    async (processorId: string, update: FileProcessorOverride) => {
      const existingOverride = overrides[processorId] ?? {}
      const nextOverride = normalizeOverride(processorId, { ...existingOverride, ...update })
      const nextOverrides = { ...overrides }

      if (nextOverride) {
        nextOverrides[processorId] = nextOverride
      } else {
        delete nextOverrides[processorId]
      }

      await setOverrides(nextOverrides)
    },
    [overrides, setOverrides]
  )

  /**
   * Reset a processor to default values (remove all overrides)
   */
  const resetProcessorConfig = useCallback(
    async (processorId: string) => {
      const nextOverrides = { ...overrides }
      delete nextOverrides[processorId]
      await setOverrides(nextOverrides)
    },
    [overrides, setOverrides]
  )

  /**
   * Check if a processor has been customized (has any overrides)
   */
  const isProcessorCustomized = useCallback((processorId: string) => processorId in overrides, [overrides])

  return {
    processors,
    overrides,
    updateProcessorConfig,
    resetProcessorConfig,
    isProcessorCustomized
  }
}

/**
 * Hook for accessing image processors (support IMAGE input)
 */
export function useImageProcessors() {
  const { overrides } = useFileProcessorOverrides()

  const processors = useMemo(() => mergeProcessorConfigs(getImageProcessorTemplates(), overrides), [overrides])

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
  const { overrides } = useFileProcessorOverrides()

  const processors = useMemo(() => mergeProcessorConfigs(getDocumentProcessorTemplates(), overrides), [overrides])

  return processors
}

/**
 * Hook for accessing a single processor by ID
 */
export function useFileProcessor(processorId: string) {
  const { processors, updateProcessorConfig } = useFileProcessors()

  const processor = useMemo(() => processors.find((p) => p.id === processorId), [processors, processorId])

  const updateConfig = useCallback(
    (update: FileProcessorOverride) => {
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
