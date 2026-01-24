/**
 * File Processing Service
 *
 * Main orchestration service for file processing operations.
 * Coordinates between ProcessorRegistry, ConfigurationService, and individual processors.
 */

import { loggerService } from '@logger'
import type { FileProcessorFeature, FileProcessorInput, FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import type {
  CancelResponse,
  ProcessFileRequest,
  ProcessingResult,
  ProcessResponse
} from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import { FileTypes } from '@types'
import { v4 as uuidv4 } from 'uuid'

import { configurationService } from './config/ConfigurationService'
import { isMarkdownConverter, isTextExtractor } from './interfaces'
import { processorRegistry } from './registry/ProcessorRegistry'
import type { ProcessingContext } from './types'

const logger = loggerService.withContext('FileProcessingService')

/**
 * Active processing request tracker
 */
interface ActiveRequest {
  requestId: string
  abortController: AbortController
  processorId: string
  startTime: number
}

export class FileProcessingService {
  private static instance: FileProcessingService | null = null
  private activeRequests: Map<string, ActiveRequest> = new Map()

  private constructor() {}

  /**
   * Get the singleton instance
   */
  static getInstance(): FileProcessingService {
    if (!FileProcessingService.instance) {
      FileProcessingService.instance = new FileProcessingService()
    }
    return FileProcessingService.instance
  }

  /**
   * Process a file using the specified or default processor
   *
   * @param file - File metadata
   * @param request - Processing request options
   * @returns Process response with requestId and result
   * @throws Error if processor not found, not available, or processing fails
   */
  async process(file: FileMetadata, request: ProcessFileRequest = {}): Promise<ProcessResponse> {
    const requestId = uuidv4()
    const inputType = this.getInputType(file)
    const feature = request.feature ?? this.getDefaultFeature(inputType)

    // Resolve processor
    const processorId = request.processorId ?? this.resolveDefaultProcessor(inputType)
    if (!processorId) {
      throw new Error(`No default processor configured for input type: ${inputType}`)
    }

    const processor = processorRegistry.get(processorId)
    if (!processor) {
      throw new Error(`Processor not found: ${processorId}`)
    }

    // Check availability
    const available = await processor.isAvailable()
    if (!available) {
      throw new Error(`Processor not available: ${processorId}`)
    }

    // Validate capability
    if (!processor.supports(feature, inputType)) {
      throw new Error(`Processor ${processorId} does not support ${feature} for ${inputType}`)
    }

    // Get merged configuration
    const config = configurationService.getConfiguration(processorId)
    if (!config) {
      throw new Error(`Configuration not found for processor: ${processorId}`)
    }

    // Create abort controller and track request
    const abortController = new AbortController()
    this.activeRequests.set(requestId, {
      requestId,
      abortController,
      processorId,
      startTime: Date.now()
    })

    // Build processing context
    const context: ProcessingContext = {
      requestId,
      signal: abortController.signal
    }

    try {
      logger.info('Processing started', { requestId, processorId, feature, inputType, file: file.origin_name })

      let result: ProcessingResult

      if (feature === 'text_extraction' && isTextExtractor(processor)) {
        result = await processor.extractText(file, config, context)
      } else if (feature === 'to_markdown' && isMarkdownConverter(processor)) {
        result = await processor.toMarkdown(file, config, context)
      } else {
        throw new Error(`Processor ${processorId} does not implement ${feature}`)
      }

      const activeRequest = this.activeRequests.get(requestId)
      const duration = activeRequest ? Date.now() - activeRequest.startTime : 0

      logger.info('Processing completed', { requestId, processorId, duration })

      return { requestId, result }
    } catch (error) {
      logger.error('Processing failed', { requestId, processorId, error })
      throw error
    } finally {
      this.activeRequests.delete(requestId)
    }
  }

  /**
   * Cancel an active processing request
   *
   * @param requestId - The request ID to cancel
   * @returns Cancel response with success status and message
   */
  cancel(requestId: string): CancelResponse {
    const request = this.activeRequests.get(requestId)
    if (!request) {
      logger.warn('Cancel requested for unknown request', { requestId })
      return {
        success: false,
        message: `Processing request ${requestId} not found or already completed`
      }
    }

    request.abortController.abort()
    this.activeRequests.delete(requestId)
    logger.info('Processing cancelled', { requestId, processorId: request.processorId })
    return {
      success: true,
      message: `Processing request ${requestId} cancelled`
    }
  }

  /**
   * List available processors with optional feature filter
   *
   * @param feature - Optional feature filter
   * @returns Array of merged processor configs (only available processors)
   */
  async listAvailableProcessors(feature?: FileProcessorFeature): Promise<FileProcessorMerged[]> {
    const processors = processorRegistry
      .getAll()
      .filter((p) => !feature || p.template.capabilities.some((cap) => cap.feature === feature))

    const results = await Promise.all(
      processors.map(async (processor) => {
        const available = await processor.isAvailable()
        if (!available) return null

        return configurationService.getConfiguration(processor.id)
      })
    )

    return results.filter((config): config is FileProcessorMerged => config !== null)
  }

  /**
   * Determine the input type based on file metadata
   *
   * @param file - File metadata
   * @returns 'image' or 'document' based on file type
   */
  getInputType(file: FileMetadata): FileProcessorInput {
    return file.type === FileTypes.IMAGE ? 'image' : 'document'
  }

  /**
   * Get the default feature for an input type
   */
  private getDefaultFeature(inputType: FileProcessorInput): FileProcessorFeature {
    return inputType === 'image' ? 'text_extraction' : 'to_markdown'
  }

  /**
   * Resolve the default processor for an input type
   */
  private resolveDefaultProcessor(inputType: FileProcessorInput): string | null {
    return configurationService.getDefaultProcessor(inputType)
  }

  /**
   * Get the count of active processing requests
   */
  get activeRequestCount(): number {
    return this.activeRequests.size
  }

  /**
   * @internal Testing only - reset the singleton instance
   */
  static _resetForTesting(): void {
    FileProcessingService.instance = null
  }
}

export const fileProcessingService = FileProcessingService.getInstance()
