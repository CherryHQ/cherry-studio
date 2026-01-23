/**
 * Configuration Service
 *
 * Service for merging template configurations with user overrides.
 * Provides access to merged processor configurations following the
 * Layered Preset Pattern (Template + UserOverride → Merged).
 */

import { preferenceService } from '@main/data/PreferenceService'
import {
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

    return { ...template, ...override }
  }

  /**
   * Get merged configurations for all processors
   */
  getAllConfigurations(): FileProcessorMerged[] {
    return this.getAllTemplates().map((template) => {
      const overrides = preferenceService.get('feature.file_processing.overrides')
      const override: FileProcessorOverride = overrides[template.id] ?? {}
      return { ...template, ...override }
    })
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
