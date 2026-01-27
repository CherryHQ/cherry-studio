/**
 * Configuration Service
 *
 * Service for merging template configurations with user overrides.
 * Provides access to merged processor configurations following the
 * Layered Preset Pattern (Template + UserOverride → Merged).
 */

import { preferenceService } from '@main/data/PreferenceService'
import {
  type CapabilityOverride,
  type FileProcessorFeature,
  type FileProcessorMerged,
  type FileProcessorOptions,
  type FileProcessorOverride,
  type FileProcessorTemplate,
  PRESETS_FILE_PROCESSORS
} from '@shared/data/presets/fileProcessing'

/**
 * Service for managing file processor configurations
 *
 * Provides:
 * - Template lookup
 * - Merged configuration (template + user override)
 * - Default processor settings
 */
export class ConfigurationService {
  private static instance: ConfigurationService | null = null
  private templateMap: Map<string, FileProcessorTemplate>

  private constructor() {
    this.templateMap = new Map(PRESETS_FILE_PROCESSORS.map((t) => [t.id, t]))
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): ConfigurationService {
    if (!ConfigurationService.instance) {
      ConfigurationService.instance = new ConfigurationService()
    }
    return ConfigurationService.instance
  }

  /**
   * Get merged configuration for a processor (template + user override)
   *
   * @returns The merged configuration if template exists, undefined otherwise
   */
  getConfiguration(processorId: string): FileProcessorMerged | undefined {
    const template = this.templateMap.get(processorId)
    if (!template) return undefined

    const overrides = preferenceService.get('feature.file_processing.overrides')
    const override: FileProcessorOverride = overrides[processorId] ?? {}

    return this.mergeConfiguration(template, override)
  }

  /**
   * Update processor configuration (merge with existing override)
   *
   * @param processorId - Processor ID to update
   * @param update - Partial override to merge
   * @returns Updated merged configuration, or undefined if processor not found
   */
  updateConfiguration(processorId: string, update: FileProcessorOverride): FileProcessorMerged | undefined {
    const template = this.templateMap.get(processorId)
    if (!template) return undefined

    const overrides = preferenceService.get('feature.file_processing.overrides')
    const existingOverride = overrides[processorId] ?? {}

    // Merge existing override with update
    const mergedOverride = this.mergeOverrides(existingOverride, update)
    const normalizedOverride = this.normalizeOverride(mergedOverride)

    // Update overrides in preference
    const newOverrides = { ...overrides }
    if (normalizedOverride) {
      newOverrides[processorId] = normalizedOverride
    } else {
      delete newOverrides[processorId]
    }
    preferenceService.set('feature.file_processing.overrides', newOverrides)

    return this.mergeConfiguration(template, normalizedOverride ?? {})
  }

  /**
   * Merge two overrides, with update taking precedence
   */
  private mergeOverrides(existing: FileProcessorOverride, update: FileProcessorOverride): FileProcessorOverride {
    const mergedCapabilities = this.mergeCapabilities(existing.capabilities, update.capabilities)
    const mergedOptions = this.mergeOptions(existing.options, update.options)

    const result: FileProcessorOverride = {}

    const apiKeys = update.apiKeys !== undefined ? update.apiKeys : existing.apiKeys
    if (apiKeys !== undefined) {
      result.apiKeys = apiKeys
    }

    if (mergedCapabilities) {
      result.capabilities = mergedCapabilities
    }

    if (mergedOptions) {
      result.options = mergedOptions
    }

    return result
  }

  /**
   * Merge capability overrides from existing and update
   */
  private mergeCapabilities(
    existing?: Partial<Record<FileProcessorFeature, CapabilityOverride>>,
    update?: Partial<Record<FileProcessorFeature, CapabilityOverride>>
  ): Partial<Record<FileProcessorFeature, CapabilityOverride>> | undefined {
    if (!existing && !update) return undefined

    const allFeatures = new Set([
      ...Object.keys(existing ?? {}),
      ...Object.keys(update ?? {})
    ]) as Set<FileProcessorFeature>

    const merged: Partial<Record<FileProcessorFeature, CapabilityOverride>> = {}

    for (const feature of allFeatures) {
      const existingCap = existing?.[feature]
      const updateCap = update?.[feature]
      if (existingCap || updateCap) {
        merged[feature] = { ...existingCap, ...updateCap }
      }
    }

    return Object.keys(merged).length > 0 ? merged : undefined
  }

  /**
   * Merge options from existing and update
   */
  private mergeOptions(
    existing?: FileProcessorOptions,
    update?: FileProcessorOptions
  ): FileProcessorOptions | undefined {
    if (!existing && !update) return undefined
    const merged = { ...existing, ...update }
    return Object.keys(merged).length > 0 ? merged : undefined
  }

  /**
   * Merge template with override, including capabilities
   */
  private mergeConfiguration(template: FileProcessorTemplate, override: FileProcessorOverride): FileProcessorMerged {
    return {
      ...template,
      ...override,
      capabilities: template.capabilities.map((cap) => ({
        ...cap,
        ...override.capabilities?.[cap.feature]
      }))
    }
  }

  /**
   * Normalize override to remove empty values
   */
  private normalizeOverride(override: FileProcessorOverride): FileProcessorOverride | undefined {
    const apiKeys = this.normalizeApiKeys(override.apiKeys)
    const capabilities = this.normalizeCapabilities(override.capabilities)
    const options = this.normalizeOptions(override.options)

    if (!apiKeys && !capabilities && !options) {
      return undefined
    }

    const result: FileProcessorOverride = {}
    if (apiKeys) result.apiKeys = apiKeys
    if (capabilities) result.capabilities = capabilities
    if (options) result.options = options

    return result
  }

  /**
   * Normalize capabilities record by removing empty values
   */
  private normalizeCapabilities(
    capabilities?: Partial<Record<FileProcessorFeature, CapabilityOverride>>
  ): Partial<Record<FileProcessorFeature, CapabilityOverride>> | undefined {
    if (!capabilities) return undefined

    const normalized: Partial<Record<FileProcessorFeature, CapabilityOverride>> = {}

    for (const [feature, cap] of Object.entries(capabilities)) {
      if (!cap) continue

      const apiHost = this.normalizeString(cap.apiHost)
      const modelId = this.normalizeString(cap.modelId)

      if (apiHost || modelId) {
        const capOverride: CapabilityOverride = {}
        if (apiHost) capOverride.apiHost = apiHost
        if (modelId) capOverride.modelId = modelId
        normalized[feature as FileProcessorFeature] = capOverride
      }
    }

    return Object.keys(normalized).length > 0 ? normalized : undefined
  }

  /**
   * Normalize options by removing empty objects
   */
  private normalizeOptions(options?: FileProcessorOptions): FileProcessorOptions | undefined {
    if (!options || Object.keys(options).length === 0) return undefined
    return options
  }

  private normalizeString(value?: string): string | undefined {
    if (!value) return undefined
    const trimmed = value.trim()
    return trimmed || undefined
  }

  private normalizeApiKeys(keys?: string[]): string[] | undefined {
    if (!keys || keys.length === 0) return undefined
    const normalized = keys.map((k) => k.trim()).filter((k) => k.length > 0)
    return normalized.length > 0 ? normalized : undefined
  }

  /**
   * Get the user's default processor for a given feature
   *
   * @returns The processor ID if set, null otherwise
   */
  getDefaultProcessor(feature: FileProcessorFeature): string | null {
    if (feature === 'text_extraction') {
      return preferenceService.get('feature.file_processing.default_text_extraction_processor')
    }
    return preferenceService.get('feature.file_processing.default_markdown_conversion_processor')
  }
}

/**
 * Default configuration service instance
 */
export const configurationService = ConfigurationService.getInstance()
