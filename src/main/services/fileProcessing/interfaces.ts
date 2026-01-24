/**
 * File Processing Interfaces
 *
 * This module defines all interfaces for the File Processing service.
 * Follows SOLID principles with clear separation of concerns.
 */

import type {
  FeatureCapability,
  FileProcessorFeature,
  FileProcessorInput,
  FileProcessorMerged,
  FileProcessorTemplate
} from '@shared/data/presets/fileProcessing'
import type { ProcessingResult } from '@shared/data/types/fileProcessing'
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
   * Check if this processor supports the given feature and input type
   * @param feature - The feature to check
   * @param inputType - The input type to check
   * @returns True if supported
   */
  supports(feature: FileProcessorFeature, inputType: FileProcessorInput): boolean

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
  toMarkdown(input: FileMetadata, config: FileProcessorMerged, context: ProcessingContext): Promise<ProcessingResult>
}

/**
 * Interface for disposable resources
 *
 * Processors that hold resources (workers, connections) should implement this.
 */
export interface IDisposable {
  /**
   * Release any held resources
   * @returns Promise resolving when disposal is complete
   */
  dispose(): Promise<void>
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
  return 'toMarkdown' in processor && typeof (processor as IMarkdownConverter).toMarkdown === 'function'
}

/**
 * Check if a processor implements IDisposable
 */
export function isDisposable(processor: IFileProcessor): processor is IFileProcessor & IDisposable {
  return 'dispose' in processor && typeof (processor as IDisposable).dispose === 'function'
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Find a capability in a template that matches the given feature and input type
 */
export function findCapability(
  template: FileProcessorTemplate,
  feature: FileProcessorFeature,
  inputType: FileProcessorInput
): FeatureCapability | undefined {
  return template.capabilities.find((cap) => cap.feature === feature && cap.input === inputType)
}

/**
 * Check if a template supports a given feature and input type
 */
export function templateSupports(
  template: FileProcessorTemplate,
  feature: FileProcessorFeature,
  inputType: FileProcessorInput
): boolean {
  return findCapability(template, feature, inputType) !== undefined
}
