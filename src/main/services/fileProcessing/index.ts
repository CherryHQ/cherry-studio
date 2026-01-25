/**
 * File Processing Service - Public API
 *
 * This module provides the main entry point for file processing functionality.
 * It handles processor registration and exports the public API.
 */

// Core services
export { ConfigurationService, configurationService } from './config/ConfigurationService'
export { ProcessorRegistry, processorRegistry } from './registry/ProcessorRegistry'

// Main service
export { FileProcessingService, fileProcessingService } from './FileProcessingService'

// Interfaces and types
export {
  findCapability,
  type IDisposable,
  type IFileProcessor,
  type IMarkdownConverter,
  isDisposable,
  isMarkdownConverter,
  isTextExtractor,
  type ITextExtractor,
  templateSupports
} from './interfaces'
export type { ProcessingContext, ProcessOptions } from './types'

// Base classes (for extension)
export { BaseFileProcessor } from './base/BaseFileProcessor'
export { BaseMarkdownConverter } from './base/BaseMarkdownConverter'
export { BaseTextExtractor } from './base/BaseTextExtractor'
