import { application } from '@application'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type {
  FileProcessingMarkdownTaskResult,
  FileProcessingMarkdownTaskStartResult
} from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import { net } from 'electron'

import { persistResponseZipResult } from '../../../persistence/resultPersistence'
import { sanitizeFileProcessingRemoteUrl } from '../../../utils/url'
import { BaseMarkdownConversionProcessor, getFileProcessingResultsDir } from '../../base/BaseFileProcessor'
import type { Doc2xTaskContext, PreparedDoc2xQueryContext, PreparedDoc2xStartContext } from './types'
import { createUploadTask, getExportResult, getParseStatus, triggerExportTask, uploadFile } from './utils'

export class Doc2xProcessor extends BaseMarkdownConversionProcessor {
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
    const runtimeService = application.get('FileProcessingRuntimeService')

    await uploadFile(file.path, uploadTask.uploadUrl, context.signal)

    runtimeService.createTask<Doc2xTaskContext>('doc2x', uploadTask.uid, {
      apiHost: context.apiHost,
      apiKey: context.apiKey,
      fileId: file.id,
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
    const doc2xRuntimeService = application.get('Doc2xRuntimeService')

    return doc2xRuntimeService.runDedupedQuery(
      providerTaskId,
      (runtimeSignal) => this.queryMarkdownConversionTaskResult(providerTaskId, runtimeSignal),
      signal
    )
  }

  private async queryMarkdownConversionTaskResult(
    providerTaskId: string,
    signal?: AbortSignal
  ): Promise<FileProcessingMarkdownTaskResult> {
    const runtimeService = application.get('FileProcessingRuntimeService')
    const taskContext = runtimeService.getTask<Doc2xTaskContext>('doc2x', providerTaskId)

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

    return this.handleExportStage(providerTaskId, taskContext.fileId, context)
  }

  private async persistMarkdownConversionResult(
    fileId: string,
    downloadUrl: string,
    signal?: AbortSignal
  ): Promise<string> {
    if (!downloadUrl) {
      throw new Error('Doc2x result download URL is empty')
    }

    const fileProcessingResultsDir = getFileProcessingResultsDir(fileId)
    signal?.throwIfAborted()
    const safeDownloadUrl = sanitizeFileProcessingRemoteUrl(downloadUrl.replace(/\\u0026/g, '&'))

    const response = await net.fetch(safeDownloadUrl, {
      method: 'GET',
      signal
    })

    if (!response.ok) {
      const message = await response.text()
      throw new Error(`Doc2x result download failed: ${response.status} ${response.statusText} ${message}`)
    }

    return await persistResponseZipResult({
      response,
      resultsDir: fileProcessingResultsDir,
      signal
    })
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
    const runtimeService = application.get('FileProcessingRuntimeService')
    const payload = await getParseStatus(providerTaskId, context)

    if (payload.code !== 'success') {
      runtimeService.deleteTask('doc2x', providerTaskId)
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
      runtimeService.deleteTask('doc2x', providerTaskId)
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
      runtimeService.deleteTask('doc2x', providerTaskId)
      return {
        status: 'failed',
        progress: 0,
        processorId: 'doc2x',
        error: exportPayload.msg || exportPayload.message || exportPayload.code
      }
    }

    const exportStatus = exportPayload.data

    if (exportStatus?.status === 'failed') {
      runtimeService.deleteTask('doc2x', providerTaskId)
      return {
        status: 'failed',
        progress: 0,
        processorId: 'doc2x',
        error: 'Doc2x markdown export failed'
      }
    }

    runtimeService.updateTask<Doc2xTaskContext>('doc2x', providerTaskId, (current) => ({
      apiHost: current.apiHost,
      apiKey: current.apiKey,
      fileId: current.fileId,
      stage: 'exporting',
      createdAt: current.createdAt
    }))

    return {
      status: 'processing',
      progress: 99,
      processorId: 'doc2x'
    }
  }

  private async handleExportStage(
    providerTaskId: string,
    fileId: string,
    context: PreparedDoc2xQueryContext
  ): Promise<FileProcessingMarkdownTaskResult> {
    const runtimeService = application.get('FileProcessingRuntimeService')
    const payload = await getExportResult(providerTaskId, context)

    if (payload.code !== 'success') {
      runtimeService.deleteTask('doc2x', providerTaskId)
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
      runtimeService.deleteTask('doc2x', providerTaskId)
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

    const markdownPath = await this.persistMarkdownConversionResult(fileId, exportStatus.url, context.signal)
    runtimeService.deleteTask('doc2x', providerTaskId)

    return {
      status: 'completed',
      progress: 100,
      processorId: 'doc2x',
      markdownPath
    }
  }
}

export const doc2xProcessor = new Doc2xProcessor()
