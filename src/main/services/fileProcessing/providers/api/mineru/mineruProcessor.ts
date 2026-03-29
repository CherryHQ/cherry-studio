import fs from 'node:fs/promises'
import path from 'node:path'

import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type {
  FileProcessingMarkdownTaskResult,
  FileProcessingMarkdownTaskStartResult
} from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import AdmZip from 'adm-zip'
import { net } from 'electron'

import { BaseMarkdownConversionProcessor } from '../../base/BaseFileProcessor'
import type { MineruExtractFileResult, PreparedMineruQueryContext, PreparedMineruStartContext } from './types'
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

    return {
      providerTaskId: uploadTask.batchId,
      status: 'processing',
      progress: 0,
      processorId: 'mineru'
    }
  }

  async getMarkdownConversionTaskResult(
    providerTaskId: string,
    config: FileProcessorMerged,
    signal?: AbortSignal
  ): Promise<FileProcessingMarkdownTaskResult> {
    const context = this.prepareQueryContext(config, signal)
    const batchResult = await getBatchResult(providerTaskId, context)

    return this.buildMarkdownTaskResult(providerTaskId, batchResult.extract_result[0])
  }

  protected async persistMarkdownConversionResult(providerTaskId: string, downloadUrl: string): Promise<string> {
    if (!downloadUrl) {
      throw new Error('Markdown conversion result download URL is empty')
    }

    const fileProcessingResultsDir = this.getFileProcessingResultsDir(providerTaskId)
    const zipPath = path.join(fileProcessingResultsDir, 'result.zip')

    await fs.mkdir(fileProcessingResultsDir, { recursive: true })

    const response = await net.fetch(downloadUrl, {
      method: 'GET'
    })

    if (!response.ok) {
      const message = await response.text()
      throw new Error(`Mineru result download failed: ${response.status} ${response.statusText} ${message}`)
    }

    const zipBuffer = Buffer.from(await response.arrayBuffer())
    await fs.writeFile(zipPath, zipBuffer)

    try {
      const zip = new AdmZip(zipBuffer)
      const entry = zip.getEntries().find((item) => !item.isDirectory && item.entryName.endsWith('full.md'))

      if (!entry) {
        throw new Error('Mineru result zip does not contain full.md')
      }

      zip.extractAllTo(fileProcessingResultsDir, true)

      const extractedMarkdownPath = path.join(fileProcessingResultsDir, entry.entryName)
      const markdownPath = path.join(path.dirname(extractedMarkdownPath), 'output.md')

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

  private prepareStartContext(
    config: FileProcessorMerged,
    signal: AbortSignal | undefined,
    file: FileMetadata
  ): PreparedMineruStartContext {
    const capability = this.getRequiredCapability(config, 'markdown_conversion')

    if (!file.path) {
      throw new Error('File path is required')
    }

    return {
      apiHost: this.getRequiredApiHost(capability.apiHost),
      apiKey: this.getRequiredApiKey(config),
      signal,
      file,
      modelVersion: capability.modelId
    }
  }

  private prepareQueryContext(config: FileProcessorMerged, signal?: AbortSignal): PreparedMineruQueryContext {
    const capability = this.getRequiredCapability(config, 'markdown_conversion')

    return {
      apiHost: this.getRequiredApiHost(capability.apiHost),
      apiKey: this.getRequiredApiKey(config),
      signal
    }
  }

  private async buildMarkdownTaskResult(
    providerTaskId: string,
    fileResult: MineruExtractFileResult | undefined
  ): Promise<FileProcessingMarkdownTaskResult> {
    if (!fileResult) {
      return {
        status: 'processing',
        progress: 0,
        processorId: 'mineru'
      }
    }

    if (fileResult.state === 'failed') {
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
    const markdownPath = await this.persistMarkdownConversionResult(providerTaskId, fileResult.full_zip_url)

    return {
      status: 'completed',
      progress: 100,
      processorId: 'mineru',
      markdownPath
    }
  }
}

export const mineruProcessor = new MineruProcessor()
