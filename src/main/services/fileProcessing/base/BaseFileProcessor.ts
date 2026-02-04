/**
 * Base File Processor
 *
 * Abstract base class providing common functionality for all file processors.
 * Implements the core IFileProcessor interface and provides utility methods.
 */

import type {
  FeatureCapability,
  FileProcessorFeature,
  FileProcessorMerged,
  FileProcessorTemplate
} from '@shared/data/presets/file-processing'
import type { FileMetadata } from '@types'

import type { IFileProcessor } from '../interfaces'
import type { ProcessingContext } from '../types'

/**
 * Abstract base class for all file processors
 *
 * Provides:
 * - Common property management (id, template)
 * - Default availability check
 * - Cancellation checking utility
 * - Capability lookup utility
 * - Round-robin API key selection
 */
export abstract class BaseFileProcessor implements IFileProcessor {
  readonly id: string
  readonly template: FileProcessorTemplate

  /** Track current API key index for each processor (round-robin) */
  private static apiKeyIndexMap: Map<string, number> = new Map()

  constructor(template: FileProcessorTemplate) {
    this.id = template.id
    this.template = template
  }

  /**
   * Check if this processor is currently available
   *
   * Default implementation returns true.
   * Subclasses should override to perform actual availability checks
   * (e.g., external service reachability, required binaries present).
   */
  async isAvailable(): Promise<boolean> {
    return true
  }

  /**
   * Check if the processing has been cancelled
   *
   * @throws Error if the signal has been aborted
   */
  protected checkCancellation(context: ProcessingContext): void {
    if (context.signal?.aborted) {
      throw new Error('Processing cancelled')
    }
  }

  /**
   * Validate the input file has a path
   *
   * @throws Error if validation fails
   */
  protected validateFile(file: FileMetadata): void {
    if (!file.path) {
      throw new Error('File path is required')
    }
  }

  /**
   * Get the API key from configuration using round-robin selection
   *
   * Cycles through available API keys for load balancing across multiple keys.
   */
  protected getApiKey(config: FileProcessorMerged): string | undefined {
    const keys = config.apiKeys
    if (!keys || keys.length === 0) return undefined
    if (keys.length === 1) return keys[0]

    // Round-robin: get current index and advance
    const currentIndex = BaseFileProcessor.apiKeyIndexMap.get(this.id) ?? 0
    const nextIndex = (currentIndex + 1) % keys.length
    BaseFileProcessor.apiKeyIndexMap.set(this.id, nextIndex)

    return keys[currentIndex]
  }

  /**
   * Get the API key from configuration, throwing if not configured
   *
   * Use this for processors that require an API key to function.
   * Provides a clear error message directing users to configure the key.
   *
   * @throws Error if API key is not configured
   */
  protected requireApiKey(config: FileProcessorMerged): string {
    const apiKey = this.getApiKey(config)
    if (!apiKey) {
      throw new Error(
        `API key is required for ${this.id} processor. Please configure it in Settings > File Processing.`
      )
    }
    return apiKey
  }

  /**
   * Get a capability configuration for the given feature
   */
  protected getCapability(feature: FileProcessorFeature): FeatureCapability | undefined {
    return this.template.capabilities.find((cap) => cap.feature === feature)
  }
}
