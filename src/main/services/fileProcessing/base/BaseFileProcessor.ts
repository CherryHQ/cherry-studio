/**
 * Base File Processor
 *
 * Abstract base class providing common functionality for all file processors.
 * Implements the core IFileProcessor interface and provides utility methods.
 */

import type {
  FeatureCapability,
  FileProcessorFeature,
  FileProcessorInput,
  FileProcessorTemplate
} from '@shared/data/presets/fileProcessing'

import { findCapability, type IFileProcessor } from '../interfaces'
import type { ProcessingContext } from '../types'

/**
 * Abstract base class for all file processors
 *
 * Provides:
 * - Common property management (id, template)
 * - Capability checking via `supports()`
 * - Default availability check
 * - Cancellation checking utility
 * - Capability lookup utility
 */
export abstract class BaseFileProcessor implements IFileProcessor {
  readonly id: string
  readonly template: FileProcessorTemplate

  constructor(template: FileProcessorTemplate) {
    this.id = template.id
    this.template = template
  }

  /**
   * Check if this processor supports the given feature and input type
   */
  supports(feature: FileProcessorFeature, inputType: FileProcessorInput): boolean {
    return findCapability(this.template, feature, inputType) !== undefined
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
   * Get a capability configuration for the given feature
   */
  protected getCapability(feature: FileProcessorFeature): FeatureCapability | undefined {
    return this.template.capabilities.find((cap) => cap.feature === feature)
  }
}
