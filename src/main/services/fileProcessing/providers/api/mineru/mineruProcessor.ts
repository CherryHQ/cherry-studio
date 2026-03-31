import fs from 'node:fs/promises'

import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type {
  FileProcessingMarkdownTaskResult,
  FileProcessingMarkdownTaskStartResult
} from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import { net } from 'electron'

import { fileProcessingTaskStore } from '../../../runtime/FileProcessingTaskStore'
import { persistZipResult, readPersistedMarkdownPath } from '../../../utils/zip'
import { BaseMarkdownConversionProcessor } from '../../base/BaseFileProcessor'
import type {
  MineruExtractFileResult,
  MineruTaskContext,
  PreparedMineruQueryContext,
  PreparedMineruStartContext
} from './types'
import { createUploadTask, getBatchResult, mapProgress, uploadFile } from './utils'

export class MineruProcessor extends BaseMarkdownConversionProcessor {
  constructor() {
    super('mineru')
  }

  async startMarkdownConversionTask(
    file: FileMetadata,
    config: FileProcessorMerged,
    signal?: AbortSignal
  ): Promise<FileProcessingMarkdownTaskStartResult> {
    const context = this.prepareStartContext(config, signal, file)
    const uploadTask = await createUploadTask(context)

    await uploadFile(file, uploadTask.uploadUrl, uploadTask.uploadHeaders, context.signal)
    fileProcessingTaskStore.create<MineruTaskContext>('mineru', uploadTask.batchId, {
      apiHost: context.apiHost,
      apiKey: context.apiKey
    })

    return {
      providerTaskId: uploadTask.batchId,
      status: 'processing',
      progress: 0,
      processorId: 'mineru'
    }
  }

  async getMarkdownConversionTaskResult(
    providerTaskId: string,
    signal?: AbortSignal
  ): Promise<FileProcessingMarkdownTaskResult> {
    const markdownPath = await readPersistedMarkdownPath(this.getFileProcessingResultsDir(providerTaskId)).catch(
      () => undefined
    )

    if (markdownPath) {
      return {
        status: 'completed',
        progress: 100,
        processorId: 'mineru',
        markdownPath
      }
    }

    const taskContext = fileProcessingTaskStore.get<MineruTaskContext>('mineru', providerTaskId)

    if (!taskContext) {
      throw new Error(`Mineru task context not found for task ${providerTaskId}`)
    }

    const context: PreparedMineruQueryContext = {
      apiHost: taskContext.apiHost,
      apiKey: taskContext.apiKey,
      signal
    }
    const batchResult = await getBatchResult(providerTaskId, context)

    return this.buildMarkdownTaskResult(providerTaskId, batchResult.extract_result[0], signal)
  }

  private async persistMarkdownConversionResult(
    providerTaskId: string,
    downloadUrl: string,
    signal?: AbortSignal
  ): Promise<string> {
    if (!downloadUrl) {
      throw new Error('Markdown conversion result download URL is empty')
    }

    const fileProcessingResultsDir = this.getFileProcessingResultsDir(providerTaskId)
    signal?.throwIfAborted()

    const response = await net.fetch(downloadUrl, {
      method: 'GET',
      signal
    })

    if (!response.ok) {
      const message = await response.text()
      throw new Error(`Mineru result download failed: ${response.status} ${response.statusText} ${message}`)
    }

    const zipBuffer = Buffer.from(await response.arrayBuffer())
    signal?.throwIfAborted()

    try {
      return await persistZipResult({
        zipBuffer,
        resultsDir: fileProcessingResultsDir,
        isMarkdownEntry: (entryName) => entryName.endsWith('full.md')
      })
    } catch (error) {
      await fs.rm(fileProcessingResultsDir, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  private prepareStartContext(
    config: FileProcessorMerged,
    signal: AbortSignal | undefined,
    file: FileMetadata
  ): PreparedMineruStartContext {
    const capability = this.getRequiredCapability(config, 'markdown_conversion')

    if (!file.path) {
      throw new Error('File path is required')
    }

    const apiHost = capability.apiHost?.trim()
    if (!apiHost) {
      throw new Error('API host is required')
    }

    const apiKey = this.getApiKey(config)
    if (!apiKey) {
      throw new Error('API key is required')
    }

    return {
      apiHost,
      apiKey,
      signal,
      file,
      modelVersion: capability.modelId
    }
  }

  private async buildMarkdownTaskResult(
    providerTaskId: string,
    fileResult: MineruExtractFileResult | undefined,
    signal?: AbortSignal
  ): Promise<FileProcessingMarkdownTaskResult> {
    if (!fileResult) {
      return {
        status: 'processing',
        progress: 0,
        processorId: 'mineru'
      }
    }

    if (fileResult.state === 'failed') {
      fileProcessingTaskStore.delete('mineru', providerTaskId)
      return {
        status: 'failed',
        progress: 0,
        processorId: 'mineru',
        error: fileResult.err_msg || 'Mineru markdown conversion failed'
      }
    }

    if (fileResult.state !== 'done') {
      return {
        status: 'processing',
        progress: mapProgress(fileResult),
        processorId: 'mineru'
      }
    }

    if (!fileResult.full_zip_url) {
      throw new Error('Mineru task completed without full_zip_url')
    }

    // TODO: Persist additional extracted assets from Mineru results when the provider
    // result contract is expanded beyond a markdown string.
    const markdownPath = await this.persistMarkdownConversionResult(providerTaskId, fileResult.full_zip_url, signal)
    fileProcessingTaskStore.delete('mineru', providerTaskId)

    return {
      status: 'completed',
      progress: 100,
      processorId: 'mineru',
      markdownPath
    }
  }
}

export const mineruProcessor = new MineruProcessor()
