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
import type {
  FileProcessorFeature,
  FileProcessorMerged,
  FileProcessorOverride
} from '@shared/data/presets/fileProcessing'
import type {
  CancelResponse,
  ProcessFileDto,
  ProcessingResult,
  ProcessResultResponse,
  ProcessStartResponse
} from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import { v4 as uuidv4 } from 'uuid'

import { configurationService } from './config/ConfigurationService'
import type { IFileProcessor } from './interfaces'
import { isMarkdownConverter, isProcessStatusProvider, isTextExtractor } from './interfaces'
import { Doc2xProcessor } from './providers/api/Doc2xProcessor'
import { MineruProcessor } from './providers/api/MineruProcessor'
import { MistralProcessor } from './providers/api/MistralProcessor'
import { OpenMineruProcessor } from './providers/api/OpenMineruProcessor'
import { PaddleProcessor } from './providers/api/PaddleProcessor'
import { OvOcrProcessor } from './providers/builtin/OvOcrProcessor'
import { SystemOcrProcessor } from './providers/builtin/SystemOcrProcessor'
import { TesseractProcessor } from './providers/builtin/TesseractProcessor'
import { processorRegistry } from './registry/ProcessorRegistry'
import type { ProcessingContext, TaskState } from './types'

const logger = loggerService.withContext('FileProcessingService')

/** TTL for completed/failed tasks before cleanup (1 minute) */
const TASK_TTL_MS = 5 * 60 * 1000
/** Interval for cleanup timer (30 seconds) */
const CLEANUP_INTERVAL_MS = 60 * 1000

export class FileProcessingService {
  private static instance: FileProcessingService | null = null
  private static processorsRegistered = false
  private taskStates: Map<string, TaskState> = new Map()
  private cleanupTimer: NodeJS.Timeout | null = null

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
   * @param dto - Process file DTO containing file, feature, and optional processorId
   * @returns Process start response with requestId and pending status
   * @throws Error if processor not found or not available
   */
  async startProcess(dto: ProcessFileDto): Promise<ProcessStartResponse> {
    this.ensureProcessorsRegistered()
    const requestId = uuidv4()
    const { file, feature, processorId: requestedProcessorId } = dto

    // Resolve processor
    const processorId = requestedProcessorId ?? configurationService.getDefaultProcessor(feature)
    if (!processorId) {
      throw new Error(`No default processor configured for feature: ${feature}`)
    }

    const processor = processorRegistry.get(processorId)
    if (!processor) {
      throw new Error(`Processor not found: ${processorId}`)
    }

    // Get merged configuration
    const config = configurationService.getConfiguration(processorId) ?? {
      ...processor.template,
      apiKey: undefined,
      options: undefined
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
      } else if (feature === 'markdown_conversion' && isMarkdownConverter(processor)) {
        result = await processor.convertToMarkdown(file, config, context)
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
          // Task is still initializing, providerTaskId not yet available from async executeProcessing()
          // Return current status and let client retry later
          logger.debug('Provider task id not yet available, task still initializing', {
            requestId,
            processorId: task.processorId
          })
          // Skip processor status query, fall through to return current task state
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

    // Mark completion time for TTL cleanup (don't delete immediately)
    if ((task.status === 'completed' || task.status === 'failed') && !task.completedAt) {
      task.completedAt = Date.now()
      this.startCleanupTimer()
    }

    return response
  }

  /**
   * Start cleanup timer if not already running
   */
  private startCleanupTimer(): void {
    if (this.cleanupTimer) return
    this.cleanupTimer = setInterval(() => this.cleanupExpiredTasks(), CLEANUP_INTERVAL_MS)
  }

  /**
   * Remove tasks that have exceeded TTL
   */
  private cleanupExpiredTasks(): void {
    const now = Date.now()
    let cleanedCount = 0
    let hasCompletedTasks = false

    for (const [requestId, task] of this.taskStates) {
      if (task.completedAt) {
        if (now - task.completedAt > TASK_TTL_MS) {
          this.taskStates.delete(requestId)
          cleanedCount++
        } else {
          hasCompletedTasks = true
        }
      }
    }

    if (cleanedCount > 0) {
      logger.debug(`Cleaned up ${cleanedCount} expired task(s)`)
    }

    // Stop timer if no completed tasks remaining
    if (!hasCompletedTasks && this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
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
   * Get a single processor configuration by ID
   *
   * @param processorId - Processor ID to get
   * @returns Merged processor config if found, null otherwise
   */
  getProcessor(processorId: string): FileProcessorMerged | null {
    this.ensureProcessorsRegistered()
    const processor = processorRegistry.get(processorId)
    if (!processor) return null

    return configurationService.getConfiguration(processorId) ?? { ...processor.template }
  }

  /**
   * List available processors with optional feature filter
   *
   * @param feature - Optional feature filter
   * @returns Array of merged processor configs (only available processors)
   */
  async listAvailableProcessors(feature?: FileProcessorFeature): Promise<FileProcessorMerged[]> {
    this.ensureProcessorsRegistered()
    const processors = (await processorRegistry.getAll()).filter(
      (p) => !feature || p.template.capabilities.some((cap) => cap.feature === feature)
    )

    return Promise.all(
      processors.map(
        async (processor) => configurationService.getConfiguration(processor.id) ?? { ...processor.template }
      )
    )
  }

  /**
   * Update processor configuration
   *
   * @param processorId - Processor ID to update
   * @param update - Partial override to merge
   * @returns Updated merged configuration
   * @throws Error if processor not found
   */
  updateProcessorConfig(processorId: string, update: FileProcessorOverride): FileProcessorMerged {
    const result = configurationService.updateConfiguration(processorId, update)
    if (!result) {
      throw new Error(`Processor not found: ${processorId}`)
    }
    return result
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private ensureProcessorsRegistered(): void {
    if (FileProcessingService.processorsRegistered) {
      return
    }

    logger.info('Registering file processors...')

    const builtinProcessors = [new TesseractProcessor(), new SystemOcrProcessor(), new OvOcrProcessor()]
    const apiProcessors = [
      new MineruProcessor(),
      new Doc2xProcessor(),
      new MistralProcessor(),
      new OpenMineruProcessor(),
      new PaddleProcessor()
    ]

    for (const processor of [...builtinProcessors, ...apiProcessors]) {
      try {
        processorRegistry.register(processor)
        logger.debug(`Registered processor: ${processor.id}`)
      } catch (error) {
        logger.warn(`Failed to register processor: ${processor.id}`, { error })
      }
    }

    FileProcessingService.processorsRegistered = true
  }
}

export const fileProcessingService = FileProcessingService.getInstance()
