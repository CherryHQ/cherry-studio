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
import type { Doc2xTaskStage, Doc2xTaskState, PreparedDoc2xQueryContext, PreparedDoc2xStartContext } from './types'
import { createUploadTask, getExportResult, getParseStatus, triggerExportTask, uploadFile } from './utils'

export class Doc2xProcessor extends BaseMarkdownConversionProcessor {
  private readonly taskStateByUid = new Map<string, Doc2xTaskState>()

  constructor() {
    super('doc2x')
  }

  async startMarkdownConversionTask(
    file: FileMetadata,
    config: FileProcessorMerged,
    signal?: AbortSignal
  ): Promise<FileProcessingMarkdownTaskStartResult> {
    const context = this.prepareStartContext(config, signal, file)
    const uploadTask = await createUploadTask(context)

    await uploadFile(file.path, uploadTask.uploadUrl, context.signal)

    this.taskStateByUid.set(uploadTask.uid, {
      stage: 'parsing',
      createdAt: Date.now()
    })

    return {
      providerTaskId: uploadTask.uid,
      status: 'processing',
      progress: 0,
      processorId: 'doc2x'
    }
  }

  async getMarkdownConversionTaskResult(
    providerTaskId: string,
    config: FileProcessorMerged,
    signal?: AbortSignal
  ): Promise<FileProcessingMarkdownTaskResult> {
    const taskState = this.taskStateByUid.get(providerTaskId)

    if (!taskState) {
      throw new Error(`Doc2x task state not found for uid ${providerTaskId}`)
    }

    const context = this.prepareQueryContext(config, signal)

    if (taskState.stage === 'parsing') {
      return this.handleParseStage(providerTaskId, context)
    }

    return this.handleExportStage(providerTaskId, context)
  }

  protected async persistMarkdownConversionResult(providerTaskId: string, downloadUrl: string): Promise<string> {
    if (!downloadUrl) {
      throw new Error('Doc2x result download URL is empty')
    }

    const fileProcessingResultsDir = this.getFileProcessingResultsDir(providerTaskId)
    const zipPath = path.join(fileProcessingResultsDir, 'result.zip')

    await fs.mkdir(fileProcessingResultsDir, { recursive: true })

    const response = await net.fetch(downloadUrl.replace(/\\u0026/g, '&'), {
      method: 'GET'
    })

    if (!response.ok) {
      const message = await response.text()
      throw new Error(`Doc2x result download failed: ${response.status} ${response.statusText} ${message}`)
    }

    const zipBuffer = Buffer.from(await response.arrayBuffer())
    await fs.writeFile(zipPath, zipBuffer)

    try {
      const zip = new AdmZip(zipBuffer)
      const entry = zip.getEntries().find((item) => !item.isDirectory && item.entryName.toLowerCase().endsWith('.md'))

      if (!entry) {
        throw new Error('Doc2x result zip does not contain a markdown file')
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
  ): PreparedDoc2xStartContext {
    const capability = this.getRequiredCapability(config, 'markdown_conversion')

    if (!file.path) {
      throw new Error('File path is required')
    }

    return {
      apiHost: this.getRequiredApiHost(capability.apiHost),
      apiKey: this.getRequiredApiKey(config),
      signal,
      file,
      modelVersion: this.getRequiredModelId(capability, 'markdown_conversion')
    }
  }

  private prepareQueryContext(config: FileProcessorMerged, signal?: AbortSignal): PreparedDoc2xQueryContext {
    const capability = this.getRequiredCapability(config, 'markdown_conversion')

    return {
      apiHost: this.getRequiredApiHost(capability.apiHost),
      apiKey: this.getRequiredApiKey(config),
      signal
    }
  }

  private async handleParseStage(
    providerTaskId: string,
    context: PreparedDoc2xQueryContext
  ): Promise<FileProcessingMarkdownTaskResult> {
    const payload = await getParseStatus(providerTaskId, context)

    if (payload.code !== 'success') {
      this.clearTaskState(providerTaskId)
      return {
        status: 'failed',
        progress: 0,
        processorId: 'doc2x',
        error: payload.msg || payload.message || payload.code
      }
    }

    const parseStatus = payload.data

    if (!parseStatus) {
      throw new Error(`Doc2x parse status response is missing data for uid ${providerTaskId}`)
    }

    if (parseStatus.status === 'failed') {
      this.clearTaskState(providerTaskId)
      return {
        status: 'failed',
        progress: 0,
        processorId: 'doc2x',
        error: parseStatus.detail || 'Doc2x markdown conversion failed'
      }
    }

    if (parseStatus.status !== 'success') {
      return {
        status: 'processing',
        progress: Math.min(98, parseStatus.progress ?? 0),
        processorId: 'doc2x'
      }
    }

    const exportPayload = await triggerExportTask(providerTaskId, context)

    if (exportPayload.code !== 'success') {
      this.clearTaskState(providerTaskId)
      return {
        status: 'failed',
        progress: 0,
        processorId: 'doc2x',
        error: exportPayload.msg || exportPayload.message || exportPayload.code
      }
    }

    const exportStatus = exportPayload.data

    if (exportStatus?.status === 'failed') {
      this.clearTaskState(providerTaskId)
      return {
        status: 'failed',
        progress: 0,
        processorId: 'doc2x',
        error: 'Doc2x markdown export failed'
      }
    }

    this.setTaskStage(providerTaskId, 'exporting')

    return {
      status: 'processing',
      progress: 99,
      processorId: 'doc2x'
    }
  }

  private async handleExportStage(
    providerTaskId: string,
    context: PreparedDoc2xQueryContext
  ): Promise<FileProcessingMarkdownTaskResult> {
    const payload = await getExportResult(providerTaskId, context)

    if (payload.code !== 'success') {
      this.clearTaskState(providerTaskId)
      return {
        status: 'failed',
        progress: 0,
        processorId: 'doc2x',
        error: payload.msg || payload.message || payload.code
      }
    }

    const exportStatus = payload.data

    if (!exportStatus) {
      throw new Error(`Doc2x export result response is missing data for uid ${providerTaskId}`)
    }

    if (exportStatus.status === 'failed') {
      this.clearTaskState(providerTaskId)
      return {
        status: 'failed',
        progress: 0,
        processorId: 'doc2x',
        error: 'Doc2x markdown export failed'
      }
    }

    if (exportStatus.status !== 'success') {
      return {
        status: 'processing',
        progress: 99,
        processorId: 'doc2x'
      }
    }

    if (!exportStatus.url) {
      throw new Error(`Doc2x export result completed without a download URL for uid ${providerTaskId}`)
    }

    const markdownPath = await this.persistMarkdownConversionResult(providerTaskId, exportStatus.url)
    this.clearTaskState(providerTaskId)

    return {
      status: 'completed',
      progress: 100,
      processorId: 'doc2x',
      markdownPath
    }
  }

  private setTaskStage(providerTaskId: string, stage: Doc2xTaskStage): void {
    const current = this.taskStateByUid.get(providerTaskId)

    this.taskStateByUid.set(providerTaskId, {
      stage,
      createdAt: current?.createdAt ?? Date.now()
    })
  }

  private clearTaskState(providerTaskId: string): void {
    this.taskStateByUid.delete(providerTaskId)
  }
}

export const doc2xProcessor = new Doc2xProcessor()
