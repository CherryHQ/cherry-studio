/**
 * Base Text Extractor
 *
 * Abstract base class for text extraction processors (OCR).
 */

import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import type { ProcessingResult } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'

import type { ITextExtractor } from '../interfaces'
import type { ProcessingContext } from '../types'
import { BaseFileProcessor } from './BaseFileProcessor'

/**
 * Abstract base class for text extraction processors
 *
 * Subclasses must implement extractText() with their specific extraction logic.
 */
export abstract class BaseTextExtractor extends BaseFileProcessor implements ITextExtractor {
  /**
   * Get the API host from configuration
   *
   * After merging, capability.apiHost contains the effective value
   * (template default overridden by user config if present)
   */
  protected getApiHost(config: FileProcessorMerged): string {
    const capability = config.capabilities.find((cap) => cap.feature === 'text_extraction')
    if (capability?.apiHost) {
      return capability.apiHost
    }

    throw new Error(`API host is required for ${this.id} processor`)
  }

  /**
   * Extract text from the input file
   */
  abstract extractText(
    file: FileMetadata,
    config: FileProcessorMerged,
    context: ProcessingContext
  ): Promise<ProcessingResult>
}
