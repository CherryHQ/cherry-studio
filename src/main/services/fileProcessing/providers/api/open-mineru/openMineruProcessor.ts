import fs from 'node:fs/promises'

import { loggerService } from '@logger'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type {
  FileProcessingMarkdownTaskResult,
  FileProcessingMarkdownTaskStartResult
} from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import { v4 as uuidv4 } from 'uuid'

import { fileProcessingTaskStore } from '../../../runtime/FileProcessingTaskStore'
import { persistZipResult } from '../../../utils/resultPersistence'
import { BaseMarkdownConversionProcessor } from '../../base/BaseFileProcessor'
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

    fileProcessingTaskStore.create<OpenMineruTaskState>('open-mineru', providerTaskId, {
      status: 'processing',
      progress: 0
    })

    void this.runTask(providerTaskId, context)

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

    const taskState = fileProcessingTaskStore.get<OpenMineruTaskState>('open-mineru', providerTaskId)

    if (!taskState) {
      throw new Error(`Open MinerU task state not found for task ${providerTaskId}`)
    }

    if (taskState.status === 'completed') {
      fileProcessingTaskStore.delete('open-mineru', providerTaskId)
      return {
        status: 'completed',
        progress: 100,
        processorId: 'open-mineru',
        markdownPath: taskState.markdownPath
      }
    }

    if (taskState.status === 'failed') {
      fileProcessingTaskStore.delete('open-mineru', providerTaskId)
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
      signal,
      file
    }
  }

  private async runTask(providerTaskId: string, context: PreparedOpenMineruContext): Promise<void> {
    try {
      fileProcessingTaskStore.update<OpenMineruTaskState>('open-mineru', providerTaskId, () => ({
        status: 'processing',
        progress: 10
      }))

      const zipBuffer = await executeTask(context)

      fileProcessingTaskStore.update<OpenMineruTaskState>('open-mineru', providerTaskId, () => ({
        status: 'processing',
        progress: 80
      }))

      const markdownPath = await this.persistMarkdownConversionResult(context.file.id, zipBuffer)
      fileProcessingTaskStore.update<OpenMineruTaskState>('open-mineru', providerTaskId, () => ({
        status: 'completed',
        progress: 100,
        markdownPath
      }))
    } catch (error) {
      logger.error('Open MinerU markdown conversion task failed', error as Error)
      fileProcessingTaskStore.update<OpenMineruTaskState>('open-mineru', providerTaskId, () => ({
        status: 'failed',
        progress: 0,
        error: error instanceof Error ? error.message : String(error)
      }))
    }
  }

  private async persistMarkdownConversionResult(fileId: string, zipBuffer: Buffer): Promise<string> {
    const fileProcessingResultsDir = this.getFileProcessingResultsDir(fileId)

    try {
      return await persistZipResult({
        zipBuffer,
        resultsDir: fileProcessingResultsDir,
        isMarkdownEntry: (entryName) => entryName.toLowerCase().endsWith('.md')
      })
    } catch (error) {
      await fs.rm(fileProcessingResultsDir, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }
}

export const openMineruProcessor = new OpenMineruProcessor()
