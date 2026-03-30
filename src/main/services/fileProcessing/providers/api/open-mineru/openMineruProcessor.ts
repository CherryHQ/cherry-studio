import fs from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type {
  FileProcessingMarkdownTaskResult,
  FileProcessingMarkdownTaskStartResult
} from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import AdmZip from 'adm-zip'
import { v4 as uuidv4 } from 'uuid'

import { fileProcessingTaskStore } from '../../../runtime/FileProcessingTaskStore'
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

    const markdownPath = path.join(this.getFileProcessingResultsDir(providerTaskId), 'output.md')
    const hasPersistedMarkdown = await fs
      .access(markdownPath)
      .then(() => true)
      .catch(() => false)

    if (hasPersistedMarkdown) {
      return {
        status: 'completed',
        progress: 100,
        processorId: 'open-mineru',
        markdownPath
      }
    }

    const taskState = fileProcessingTaskStore.get<OpenMineruTaskState>('open-mineru', providerTaskId)

    if (!taskState) {
      throw new Error(`Open MinerU task state not found for task ${providerTaskId}`)
    }

    if (taskState.status === 'completed') {
      if (!taskState.markdownPath) {
        throw new Error(`Open MinerU task ${providerTaskId} completed without markdownPath`)
      }

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

      const markdownPath = await this.persistMarkdownConversionResult(providerTaskId, zipBuffer)

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

  private async persistMarkdownConversionResult(providerTaskId: string, zipBuffer: Buffer): Promise<string> {
    const fileProcessingResultsDir = this.getFileProcessingResultsDir(providerTaskId)
    const zipPath = path.join(fileProcessingResultsDir, 'result.zip')

    await fs.mkdir(fileProcessingResultsDir, { recursive: true })
    await fs.writeFile(zipPath, zipBuffer)

    try {
      const zip = new AdmZip(zipBuffer)
      const entry = zip.getEntries().find((item) => !item.isDirectory && item.entryName.toLowerCase().endsWith('.md'))

      if (!entry) {
        throw new Error('Open MinerU result zip does not contain a markdown file')
      }

      zip.extractAllTo(fileProcessingResultsDir, true)

      const extractedMarkdownPath = path.join(fileProcessingResultsDir, entry.entryName)
      const markdownPath = path.join(fileProcessingResultsDir, 'output.md')

      if (extractedMarkdownPath !== markdownPath) {
        await fs.rename(extractedMarkdownPath, markdownPath)
      }

      await fs.unlink(zipPath)

      return markdownPath
    } catch (error) {
      await fs.unlink(zipPath).catch(() => undefined)
      throw error
    }
  }
}

export const openMineruProcessor = new OpenMineruProcessor()
