import { loggerService } from '@logger'
import { application } from '@main/core/application'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type {
  FileProcessingMarkdownTaskResult,
  FileProcessingMarkdownTaskStartResult
} from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import { v4 as uuidv4 } from 'uuid'

import { persistResponseZipResult } from '../../../persistence/resultPersistence'
import type { FileProcessingRuntimeService } from '../../../runtime/services/FileProcessingRuntimeService'
import { BaseMarkdownConversionProcessor, getFileProcessingResultsDir } from '../../base/BaseFileProcessor'
import type { OpenMineruTaskState, PreparedOpenMineruContext } from './types'
import { executeTask } from './utils'

const logger = loggerService.withContext('FileProcessing:OpenMineruProcessor')

export class OpenMineruProcessor extends BaseMarkdownConversionProcessor {
  constructor() {
    super('open-mineru')
  }

  async startMarkdownConversionTask(
    file: FileMetadata,
    config: FileProcessorMerged,
    signal?: AbortSignal
  ): Promise<FileProcessingMarkdownTaskStartResult> {
    const context = this.prepareContext(file, config, signal)
    const providerTaskId = uuidv4()
    const runtimeService = application.get('FileProcessingRuntimeService')
    const openMineruRuntimeService = application.get('OpenMineruRuntimeService')

    runtimeService.createTask<OpenMineruTaskState>('open-mineru', providerTaskId, {
      status: 'processing',
      progress: 0
    })

    try {
      openMineruRuntimeService.startTask(providerTaskId, (runtimeSignal) =>
        this.runTask(providerTaskId, {
          ...context,
          signal: runtimeSignal
        })
      )
    } catch (error) {
      runtimeService.deleteTask('open-mineru', providerTaskId)
      throw error
    }

    return {
      providerTaskId,
      status: 'processing',
      progress: 0,
      processorId: 'open-mineru'
    }
  }

  async getMarkdownConversionTaskResult(
    providerTaskId: string,
    signal?: AbortSignal
  ): Promise<FileProcessingMarkdownTaskResult> {
    signal?.throwIfAborted()
    const runtimeService = application.get('FileProcessingRuntimeService')

    const taskState = runtimeService.getTask<OpenMineruTaskState>('open-mineru', providerTaskId)

    if (!taskState) {
      throw new Error(`Open MinerU task state not found for task ${providerTaskId}`)
    }

    if (taskState.status === 'completed') {
      runtimeService.deleteTask('open-mineru', providerTaskId)
      return {
        status: 'completed',
        progress: 100,
        processorId: 'open-mineru',
        markdownPath: taskState.markdownPath
      }
    }

    if (taskState.status === 'failed') {
      runtimeService.deleteTask('open-mineru', providerTaskId)
      return {
        status: 'failed',
        progress: 0,
        processorId: 'open-mineru',
        error: taskState.error || 'Open MinerU markdown conversion failed'
      }
    }

    return {
      status: 'processing',
      progress: taskState.progress,
      processorId: 'open-mineru'
    }
  }

  private prepareContext(
    file: FileMetadata,
    config: FileProcessorMerged,
    signal?: AbortSignal
  ): PreparedOpenMineruContext {
    signal?.throwIfAborted()

    const capability = this.getRequiredCapability(config, 'markdown_conversion')

    if (!file.path) {
      throw new Error('File path is required')
    }

    const apiHost = capability.apiHost?.trim()
    if (!apiHost) {
      throw new Error('API host is required')
    }

    return {
      apiHost,
      apiKey: this.getApiKey(config),
      file
    }
  }

  private async runTask(providerTaskId: string, context: PreparedOpenMineruContext): Promise<void> {
    const runtimeService = application.get('FileProcessingRuntimeService')

    try {
      runtimeService.updateTask<OpenMineruTaskState>('open-mineru', providerTaskId, () => ({
        status: 'processing',
        progress: 10
      }))

      const response = await executeTask(context)

      runtimeService.updateTask<OpenMineruTaskState>('open-mineru', providerTaskId, () => ({
        status: 'processing',
        progress: 80
      }))

      const markdownPath = await this.persistMarkdownConversionResult(context.file.id, response, context.signal)
      runtimeService.updateTask<OpenMineruTaskState>('open-mineru', providerTaskId, () => ({
        status: 'completed',
        progress: 100,
        markdownPath
      }))
    } catch (error) {
      logger.warn('Open MinerU markdown conversion task failed', error as Error)
      this.tryMarkTaskFailed(runtimeService, providerTaskId, error)
    }
  }

  private tryMarkTaskFailed(
    runtimeService: FileProcessingRuntimeService,
    providerTaskId: string,
    error: unknown
  ): void {
    try {
      runtimeService.updateTask<OpenMineruTaskState>('open-mineru', providerTaskId, () => ({
        status: 'failed',
        progress: 0,
        error: error instanceof Error ? error.message : String(error)
      }))
    } catch (updateError) {
      logger.warn(
        'Skipping Open MinerU failure state update because task context is unavailable',
        updateError as Error,
        {
          providerTaskId
        }
      )
    }
  }

  private async persistMarkdownConversionResult(
    fileId: string,
    response: Response,
    signal?: AbortSignal
  ): Promise<string> {
    const fileProcessingResultsDir = getFileProcessingResultsDir(fileId)

    return await persistResponseZipResult({
      response,
      resultsDir: fileProcessingResultsDir,
      signal
    })
  }
}

export const openMineruProcessor = new OpenMineruProcessor()
