/**
 * File Processing Service
 *
 * Main orchestration service for file processing operations.
 * Coordinates between ProcessorRegistry, ConfigurationService, and individual processors.
 *
 * Supports async task model:
 * - startProcess(): Launch task, return immediately with pending status
 * - getResult(): Query task status/progress/result (clears task on completion)
 * - cancel(): Cancel an active task
 */

import { loggerService } from '@logger'
import type { FileProcessorFeature, FileProcessorInput, FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import type {
  CancelResponse,
  ProcessFileRequest,
  ProcessingResult,
  ProcessResultResponse,
  ProcessStartResponse
} from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import { FileTypes } from '@types'
import { v4 as uuidv4 } from 'uuid'

import { configurationService } from './config/ConfigurationService'
import type { IFileProcessor } from './interfaces'
import { isMarkdownConverter, isProcessStatusProvider, isTextExtractor } from './interfaces'
import { processorRegistry } from './registry/ProcessorRegistry'
import type { ProcessingContext, TaskState } from './types'

const logger = loggerService.withContext('FileProcessingService')

export class FileProcessingService {
  private static instance: FileProcessingService | null = null
  private taskStates: Map<string, TaskState> = new Map()

  private constructor() {}

  static getInstance(): FileProcessingService {
    if (!FileProcessingService.instance) {
      FileProcessingService.instance = new FileProcessingService()
    }
    return FileProcessingService.instance
  }

  /**
   * Start processing a file asynchronously
   *
   * Returns immediately with a request ID. Use getResult() to poll for completion.
   *
   * @param file - File metadata
   * @param request - Processing request options
   * @returns Process start response with requestId and pending status
   * @throws Error if processor not found or not available
   */
  async startProcess(file: FileMetadata, request: ProcessFileRequest = {}): Promise<ProcessStartResponse> {
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

    // Create abort controller
    const abortController = new AbortController()

    // Initialize task state
    const taskState: TaskState = {
      requestId,
      status: 'pending',
      progress: 0,
      processorId,
      providerTaskId: null,
      config,
      abortController
    }
    this.taskStates.set(requestId, taskState)

    logger.info('Processing started', {
      requestId,
      processorId,
      feature,
      inputType,
      file: file.origin_name
    })

    // Start async processing (don't await)
    this.executeProcessing(requestId, processor, file, config, feature)

    return { requestId, status: 'pending' }
  }

  /**
   * Execute processing in background
   *
   * Updates task state as processing progresses.
   */
  private async executeProcessing(
    requestId: string,
    processor: IFileProcessor,
    file: FileMetadata,
    config: FileProcessorMerged,
    feature: FileProcessorFeature
  ): Promise<void> {
    const task = this.taskStates.get(requestId)
    if (!task) return

    // Update to processing
    task.status = 'processing'

    const context: ProcessingContext = {
      requestId,
      signal: task.abortController.signal
    }

    try {
      let result: ProcessingResult

      if (feature === 'text_extraction' && isTextExtractor(processor)) {
        result = await processor.extractText(file, config, context)
      } else if (feature === 'to_markdown' && isMarkdownConverter(processor)) {
        result = await processor.toMarkdown(file, config, context)
      } else {
        throw new Error(`Processor ${processor.id} does not implement ${feature}`)
      }

      if (isProcessStatusProvider(processor)) {
        const providerTaskId = this.extractProviderTaskId(result)
        if (!providerTaskId) {
          throw new Error('Provider task id not found in processing metadata')
        }

        task.providerTaskId = providerTaskId
        task.status = 'processing'
        task.progress = 0
        return
      }

      task.status = 'completed'
      task.progress = 100
      task.result = result
    } catch (error) {
      task.status = 'failed'
      task.error = {
        code: task.abortController.signal.aborted ? 'cancelled' : 'error',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  /**
   * Get the result/status of a processing request
   *
   * @param requestId - The request ID to query
   * @returns Current status, progress, and result/error
   */
  async getResult(requestId: string): Promise<ProcessResultResponse> {
    const task = this.taskStates.get(requestId)

    if (!task) {
      return {
        requestId,
        status: 'failed',
        progress: 0,
        error: { code: 'not_found', message: 'Request not found' }
      }
    }

    // For async processors that implement IProcessStatusProvider,
    // query the processor for real-time status
    if (task.status === 'pending' || task.status === 'processing') {
      const processor = processorRegistry.get(task.processorId)
      if (processor && isProcessStatusProvider(processor)) {
        if (!task.providerTaskId) {
          logger.warn('Missing provider task id for status query', {
            requestId,
            processorId: task.processorId
          })
          task.status = 'failed'
          task.error = { code: 'missing_provider_task_id', message: 'Provider task id not found' }
        } else {
          try {
            const providerStatus = await processor.getStatus(task.providerTaskId, task.config)
            task.status = providerStatus.status
            task.progress = providerStatus.progress
            if (providerStatus.result) task.result = providerStatus.result
            if (providerStatus.error) task.error = providerStatus.error
          } catch {
            // If provider query fails, return current local state
          }
        }
      }
    }

    const response: ProcessResultResponse = {
      requestId,
      status: task.status,
      progress: task.progress,
      result: task.result,
      error: task.error
    }

    // Clear task after returning completed/failed status
    if (task.status === 'completed' || task.status === 'failed') {
      this.taskStates.delete(requestId)
    }

    return response
  }

  private extractProviderTaskId(result: ProcessingResult): string | null {
    if (!result.metadata || typeof result.metadata !== 'object') {
      return null
    }

    const metadata = result.metadata as Record<string, unknown>
    const providerTaskId = metadata['providerTaskId']

    return typeof providerTaskId === 'string' && providerTaskId.trim().length > 0 ? providerTaskId : null
  }

  /**
   * Cancel an active processing request
   *
   * @param requestId - The request ID to cancel
   * @returns Cancel response with success status and message
   */
  cancel(requestId: string): CancelResponse {
    const task = this.taskStates.get(requestId)

    if (!task || task.status === 'completed' || task.status === 'failed') {
      return { success: false, message: 'Cannot cancel' }
    }

    task.abortController.abort()
    task.status = 'failed'
    task.error = { code: 'cancelled', message: 'Cancelled' }

    return { success: true, message: 'Cancelled' }
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

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Determine the input type based on file metadata
   * Will be replaced by FileTypes when file system is integrated
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

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Dispose the service and release resources
   *
   * Cancels all active tasks and stops the cleanup timer.
   */
  dispose(): void {
    for (const task of this.taskStates.values()) {
      if (task.status === 'pending' || task.status === 'processing') {
        task.abortController.abort()
      }
    }
    this.taskStates.clear()
  }

  /**
   * @internal Testing only - reset the singleton instance
   */
  static _resetForTesting(): void {
    if (FileProcessingService.instance) {
      FileProcessingService.instance.dispose()
    }
    FileProcessingService.instance = null
  }
}

export const fileProcessingService = FileProcessingService.getInstance()
