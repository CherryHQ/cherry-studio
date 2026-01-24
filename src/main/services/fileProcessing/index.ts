/**
 * File Processing Service - Public API
 *
 * This module provides the main entry point for file processing functionality.
 * It handles processor registration and exports the public API.
 */

import { loggerService } from '@logger'

// Core services
export { ConfigurationService, configurationService } from './config/ConfigurationService'
export { ProcessorRegistry, processorRegistry } from './registry/ProcessorRegistry'

// Main service
export { FileProcessingService, fileProcessingService, type ProcessRuntimeOptions } from './FileProcessingService'

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

// Builtin processors
// API processors
import { Doc2xProcessor } from './providers/api/Doc2xProcessor'
import { MineruProcessor } from './providers/api/MineruProcessor'
import { MistralProcessor } from './providers/api/MistralProcessor'
import { OpenMineruProcessor } from './providers/api/OpenMineruProcessor'
import { PaddleProcessor } from './providers/api/PaddleProcessor'
import { OvOcrProcessor } from './providers/builtin/OvOcrProcessor'
import { SystemOcrProcessor } from './providers/builtin/SystemOcrProcessor'
import { TesseractProcessor } from './providers/builtin/TesseractProcessor'
import { processorRegistry } from './registry/ProcessorRegistry'

const logger = loggerService.withContext('FileProcessing')

/**
 * Register all built-in and API processors
 *
 * This function is called during application initialization
 * to register all available file processors.
 */
export function registerProcessors(): void {
  logger.info('Registering file processors...')

  // Builtin processors (OCR)
  const builtinProcessors = [new TesseractProcessor(), new SystemOcrProcessor(), new OvOcrProcessor()]

  // API processors (OCR + document conversion)
  const apiProcessors = [
    new MineruProcessor(),
    new Doc2xProcessor(),
    new MistralProcessor(),
    new OpenMineruProcessor(),
    new PaddleProcessor()
  ]

  const allProcessors = [...builtinProcessors, ...apiProcessors]

  for (const processor of allProcessors) {
    try {
      processorRegistry.register(processor)
      logger.debug(`Registered processor: ${processor.id}`)
    } catch (error) {
      logger.warn(`Failed to register processor: ${processor.id}`, { error })
    }
  }

  logger.info(`File processors registered: ${processorRegistry.size} processors`)
}

/**
 * Initialize the file processing service
 *
 * Call this during application startup to set up
 * all file processing capabilities.
 */
export function initializeFileProcessing(): void {
  registerProcessors()
  logger.info('File processing service initialized')
}
