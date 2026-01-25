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
  type FileProcessorInput,
  type FileProcessorMerged,
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
 * - Configuration change notifications
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
   * Get a processor template by ID
   *
   * @returns The template if found, undefined otherwise
   */
  getTemplate(processorId: string): FileProcessorTemplate | undefined {
    return this.templateMap.get(processorId)
  }

  /**
   * Get all processor templates
   */
  getAllTemplates(): FileProcessorTemplate[] {
    return Array.from(this.templateMap.values())
  }

  /**
   * Get merged configuration for a processor (template + user override)
   *
   * @returns The merged configuration if template exists, undefined otherwise
   */
  getConfiguration(processorId: string): FileProcessorMerged | undefined {
    const template = this.getTemplate(processorId)
    if (!template) return undefined

    const overrides = preferenceService.get('feature.file_processing.overrides')
    const override: FileProcessorOverride = overrides[processorId] ?? {}

    return this.mergeConfiguration(template, override)
  }

  /**
   * Get merged configurations for all processors
   */
  getAllConfigurations(): FileProcessorMerged[] {
    return this.getAllTemplates().map((template) => {
      const overrides = preferenceService.get('feature.file_processing.overrides')
      const override: FileProcessorOverride = overrides[template.id] ?? {}
      return this.mergeConfiguration(template, override)
    })
  }

  /**
   * Update processor configuration (merge with existing override)
   *
   * @param processorId - Processor ID to update
   * @param update - Partial override to merge
   * @returns Updated merged configuration, or undefined if processor not found
   */
  updateConfiguration(processorId: string, update: FileProcessorOverride): FileProcessorMerged | undefined {
    const template = this.getTemplate(processorId)
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
    const mergedCapabilities: Partial<Record<FileProcessorFeature, CapabilityOverride>> = {}

    // Merge capabilities
    const allFeatures = new Set([
      ...Object.keys(existing.capabilities ?? {}),
      ...Object.keys(update.capabilities ?? {})
    ]) as Set<FileProcessorFeature>

    for (const feature of allFeatures) {
      const existingCap = existing.capabilities?.[feature]
      const updateCap = update.capabilities?.[feature]
      if (existingCap || updateCap) {
        mergedCapabilities[feature] = { ...existingCap, ...updateCap }
      }
    }

    return {
      apiKey: update.apiKey !== undefined ? update.apiKey : existing.apiKey,
      ...(Object.keys(mergedCapabilities).length > 0 ? { capabilities: mergedCapabilities } : {}),
      ...(update.options || existing.options ? { options: { ...existing.options, ...update.options } } : {})
    }
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
    const apiKey = this.normalizeString(override.apiKey)

    // Normalize capabilities Record
    let capabilities: Partial<Record<FileProcessorFeature, CapabilityOverride>> | undefined
    if (override.capabilities) {
      const normalizedCaps: Partial<Record<FileProcessorFeature, CapabilityOverride>> = {}
      for (const [feature, cap] of Object.entries(override.capabilities)) {
        if (!cap) continue
        const apiHost = this.normalizeString(cap.apiHost)
        const modelId = this.normalizeString(cap.modelId)
        if (apiHost || modelId) {
          normalizedCaps[feature as FileProcessorFeature] = {
            ...(apiHost ? { apiHost } : {}),
            ...(modelId ? { modelId } : {})
          }
        }
      }
      if (Object.keys(normalizedCaps).length > 0) {
        capabilities = normalizedCaps
      }
    }

    const options = override.options && Object.keys(override.options).length > 0 ? override.options : undefined

    if (!apiKey && !capabilities && !options) {
      return undefined
    }

    return {
      ...(apiKey ? { apiKey } : {}),
      ...(capabilities ? { capabilities } : {}),
      ...(options ? { options } : {})
    }
  }

  private normalizeString(value?: string): string | undefined {
    if (!value) return undefined
    const trimmed = value.trim()
    return trimmed ? trimmed : undefined
  }

  /**
   * Get the user's default processor for a given input type
   *
   * @returns The processor ID if set, null otherwise
   */
  getDefaultProcessor(inputType: FileProcessorInput): string | null {
    const key =
      inputType === 'image'
        ? 'feature.file_processing.default_image_processor'
        : 'feature.file_processing.default_document_processor'
    return preferenceService.get(key)
  }

  /**
   * Subscribe to configuration changes
   *
   * @returns Unsubscribe function
   */
  onConfigurationChange(callback: () => void): () => void {
    return preferenceService.subscribeChange('feature.file_processing.overrides', callback)
  }

  /**
   * @internal Testing only - reset the singleton instance
   */
  static _resetForTesting(): void {
    ConfigurationService.instance = null
  }
}

/**
 * Default configuration service instance
 */
export const configurationService = ConfigurationService.getInstance()
