/**
 * File Processing Interfaces
 *
 * This module defines all interfaces for the File Processing service.
 * Follows SOLID principles with clear separation of concerns.
 */

import type { FileProcessorMerged, FileProcessorTemplate } from '@shared/data/presets/file-processing'
import type { ProcessingResult, ProcessResultResponse } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'

import type { ProcessingContext } from './types'

// ============================================================================
// Core Interfaces
// ============================================================================

/**
 * Base interface for all file processors
 *
 * Defines the minimal contract that all processors must implement.
 */
export interface IFileProcessor {
  /** Unique processor identifier */
  readonly id: string

  /** Processor template (read-only metadata) */
  readonly template: FileProcessorTemplate

  /**
   * Check if this processor is currently available
   * May perform async checks (e.g., external service availability)
   * @returns Promise resolving to availability status
   */
  isAvailable(): Promise<boolean>
}

/**
 * Interface for text extraction processors
 *
 * Processors that can extract plain text from files.
 */
export interface ITextExtractor extends IFileProcessor {
  /**
   * Extract text from the input file
   * @param input - File to process
   * @param config - Processor configuration
   * @param context - Processing context
   * @returns Promise resolving to processing result
   */
  extractText(input: FileMetadata, config: FileProcessorMerged, context: ProcessingContext): Promise<ProcessingResult>
}

/**
 * Interface for markdown conversion processors
 *
 * Processors that can convert files to markdown format.
 */
export interface IMarkdownConverter extends IFileProcessor {
  /**
   * Convert the input file to markdown
   * @param input - File to process
   * @param config - Processor configuration
   * @param context - Processing context
   * @returns Promise resolving to processing result
   */
  convertToMarkdown(
    input: FileMetadata,
    config: FileProcessorMerged,
    context: ProcessingContext
  ): Promise<ProcessingResult>
}

/**
 * Interface for processors that support async status querying
 *
 * Processors implementing this interface can:
 * 1. Start remote processing via extractText()/convertToMarkdown()
 * 2. Report status/progress on demand via getStatus()
 *
 * This is OPTIONAL - synchronous processors work without implementing this.
 * The FileProcessingService will use this interface when available to get
 * real-time progress updates from API processors.
 */
export interface IProcessStatusProvider extends IFileProcessor {
  /**
   * Query current processing status
   * Called by FileProcessingService when /result endpoint is hit
   * @param providerTaskId - The provider task ID to query
   * @param config - Processor configuration
   * @returns Current status, progress, and result/error
   */
  getStatus(providerTaskId: string, config: FileProcessorMerged): Promise<ProcessResultResponse>
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a processor implements ITextExtractor
 */
export function isTextExtractor(processor: IFileProcessor): processor is ITextExtractor {
  return 'extractText' in processor && typeof (processor as ITextExtractor).extractText === 'function'
}

/**
 * Check if a processor implements IMarkdownConverter
 */
export function isMarkdownConverter(processor: IFileProcessor): processor is IMarkdownConverter {
  return 'convertToMarkdown' in processor && typeof (processor as IMarkdownConverter).convertToMarkdown === 'function'
}

/**
 * Check if a processor implements IProcessStatusProvider
 */
export function isProcessStatusProvider(processor: IFileProcessor): processor is IProcessStatusProvider {
  return 'getStatus' in processor && typeof (processor as IProcessStatusProvider).getStatus === 'function'
}
