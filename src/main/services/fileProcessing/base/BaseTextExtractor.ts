/**
 * Base Text Extractor
 *
 * Abstract base class for text extraction processors (OCR).
 * Uses the Template Method pattern to define a consistent processing pipeline.
 */

import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import type { FileMetadata } from '@types'

import type { ITextExtractor } from '../interfaces'
import type { ProcessingContext, ProcessingResult } from '../types'
import { BaseFileProcessor } from './BaseFileProcessor'

/**
 * Abstract base class for text extraction processors
 *
 * Template method pattern:
 * 1. Check cancellation
 * 2. Validate input
 * 3. Execute extraction (doExtractText - subclass implements)
 * 4. Check cancellation after processing
 * 5. Return result
 */
export abstract class BaseTextExtractor extends BaseFileProcessor implements ITextExtractor {
  /**
   * Extract text from the input file
   *
   * This is a template method that handles:
   * - Cancellation checking
   * - Input validation
   * - Delegating to subclass implementation
   */
  async extractText(
    input: FileMetadata,
    config: FileProcessorMerged,
    context: ProcessingContext
  ): Promise<ProcessingResult> {
    // Check cancellation before starting
    this.checkCancellation(context)

    // Validate input
    this.validateInput(input)

    // Execute extraction (subclass implementation)
    return this.doExtractText(input, config, context)
  }

  /**
   * Validate the input file
   *
   * @throws Error if validation fails
   */
  protected validateInput(input: FileMetadata): void {
    if (!input.path) {
      throw new Error('Input file path is required')
    }
  }

  /**
   * Perform the actual text extraction
   *
   * Subclasses must implement this method with their specific extraction logic.
   */
  protected abstract doExtractText(
    input: FileMetadata,
    config: FileProcessorMerged,
    context: ProcessingContext
  ): Promise<ProcessingResult>
}
