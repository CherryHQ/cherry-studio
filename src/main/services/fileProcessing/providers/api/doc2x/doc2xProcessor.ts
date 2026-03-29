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
import type { Doc2xTaskContext, Doc2xTaskStage, PreparedDoc2xQueryContext, PreparedDoc2xStartContext } from './types'
import { createUploadTask, getExportResult, getParseStatus, triggerExportTask, uploadFile } from './utils'

export class Doc2xProcessor extends BaseMarkdownConversionProcessor {
  private readonly taskContextById = new Map<string, Doc2xTaskContext>()

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

    this.taskContextById.set(uploadTask.uid, {
      apiHost: context.apiHost,
      apiKey: context.apiKey,
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
    signal?: AbortSignal
  ): Promise<FileProcessingMarkdownTaskResult> {
    const markdownPath = path.join(this.getFileProcessingResultsDir(providerTaskId), 'output.md')
    const hasPersistedMarkdown = await fs
      .access(markdownPath)
      .then(() => true)
      .catch(() => false)

    if (hasPersistedMarkdown) {
      return {
        status: 'completed',
        progress: 100,
        processorId: 'doc2x',
        markdownPath
      }
    }

    const taskContext = this.taskContextById.get(providerTaskId)

    if (!taskContext) {
      throw new Error(`Doc2x task context not found for uid ${providerTaskId}`)
    }

    const context: PreparedDoc2xQueryContext = {
      apiHost: taskContext.apiHost,
      apiKey: taskContext.apiKey,
      signal
    }

    if (taskContext.stage === 'parsing') {
      return this.handleParseStage(providerTaskId, context)
    }

    return this.handleExportStage(providerTaskId, context)
  }

  private async persistMarkdownConversionResult(providerTaskId: string, downloadUrl: string): Promise<string> {
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

  private async handleParseStage(
    providerTaskId: string,
    context: PreparedDoc2xQueryContext
  ): Promise<FileProcessingMarkdownTaskResult> {
    const payload = await getParseStatus(providerTaskId, context)

    if (payload.code !== 'success') {
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
      return {
        status: 'failed',
        progress: 0,
        processorId: 'doc2x',
        error: exportPayload.msg || exportPayload.message || exportPayload.code
      }
    }

    const exportStatus = exportPayload.data

    if (exportStatus?.status === 'failed') {
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
    this.taskContextById.delete(providerTaskId)

    return {
      status: 'completed',
      progress: 100,
      processorId: 'doc2x',
      markdownPath
    }
  }

  private setTaskStage(providerTaskId: string, stage: Doc2xTaskStage): void {
    const current = this.taskContextById.get(providerTaskId)

    if (!current) {
      throw new Error(`Doc2x task context not found for uid ${providerTaskId}`)
    }

    this.taskContextById.set(providerTaskId, {
      apiHost: current.apiHost,
      apiKey: current.apiKey,
      stage,
      createdAt: current.createdAt
    })
  }
}

export const doc2xProcessor = new Doc2xProcessor()
