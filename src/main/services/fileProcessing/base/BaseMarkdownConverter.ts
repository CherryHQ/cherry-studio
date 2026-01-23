/**
 * Base Markdown Converter
 *
 * Abstract base class for markdown conversion processors.
 * Uses the Template Method pattern to define a consistent processing pipeline.
 */

import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import type { FileMetadata } from '@types'

import type { IMarkdownConverter } from '../interfaces'
import type { ProcessingContext, ProcessingResult } from '../types'
import { BaseFileProcessor } from './BaseFileProcessor'

/**
 * Abstract base class for markdown conversion processors
 *
 * Template method pattern:
 * 1. Check cancellation
 * 2. Validate document
 * 3. Execute conversion (doConvert - subclass implements)
 * 4. Check cancellation after processing
 * 5. Return result
 */
export abstract class BaseMarkdownConverter extends BaseFileProcessor implements IMarkdownConverter {
  /**
   * Convert the input document to markdown
   *
   * This is a template method that handles:
   * - Cancellation checking
   * - Document validation
   * - Delegating to subclass implementation
   */
  async toMarkdown(
    input: FileMetadata,
    config: FileProcessorMerged,
    context: ProcessingContext
  ): Promise<ProcessingResult> {
    // Check cancellation before starting
    this.checkCancellation(context)

    // Validate document
    this.validateDocument(input)

    // Execute conversion (subclass implementation)
    return this.doConvert(input, config, context)
  }

  /**
   * Validate the input document
   *
   * @throws Error if validation fails
   */
  protected validateDocument(input: FileMetadata): void {
    if (!input.path) {
      throw new Error('Document file path is required')
    }
  }

  /**
   * Perform the actual markdown conversion
   *
   * Subclasses must implement this method with their specific conversion logic.
   */
  protected abstract doConvert(
    input: FileMetadata,
    config: FileProcessorMerged,
    context: ProcessingContext
  ): Promise<ProcessingResult>
}
