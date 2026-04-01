import { loggerService } from '@logger'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type {
  FileProcessingMarkdownTaskResult,
  FileProcessingMarkdownTaskStartResult
} from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import { isImageFileMetadata } from '@types'

import type { ITextExtractionProcessor } from '../../../interfaces'
import { fileProcessingTaskStore } from '../../../runtime/FileProcessingTaskStore'
import type { FileProcessingTextExtractionResult } from '../../../types'
import { persistMarkdownResult } from '../../../utils/resultPersistence'
import { BaseMarkdownConversionProcessor, getFileProcessingResultsDir } from '../../base/BaseFileProcessor'
import type { PaddleTaskContext, PreparedPaddleQueryContext, PreparedPaddleStartContext } from './types'
import { createJob, getJobResult, mapProgress, resolveJsonlResult, waitForJobCompletion } from './utils'

const logger = loggerService.withContext('FileProcessing:PaddleProcessor')

export class PaddleProcessor extends BaseMarkdownConversionProcessor implements ITextExtractionProcessor {
  constructor() {
    super('paddleocr')
  }

  async extractText(
    file: FileMetadata,
    config: FileProcessorMerged,
    signal?: AbortSignal
  ): Promise<FileProcessingTextExtractionResult> {
    const startContext = this.prepareStartContext(config, signal, file, 'text_extraction')
    const job = await createJob(startContext)
    const queryContext: PreparedPaddleQueryContext = {
      apiHost: startContext.apiHost,
      apiKey: startContext.apiKey,
      signal: startContext.signal
    }
    const jobResult = await waitForJobCompletion(job.jobId, queryContext)

    if (jobResult.state === 'failed') {
      throw new Error(jobResult.errorMsg || 'PaddleOCR text extraction failed')
    }

    logger.info('PaddleOCR text extraction job completed', {
      processorId: 'paddleocr',
      providerTaskId: job.jobId,
      fileId: file.id,
      model: startContext.model,
      resultUrl: jobResult.resultUrl
    })

    return {
      text: await resolveJsonlResult(job.jobId, jobResult, queryContext.signal)
    }
  }

  async startMarkdownConversionTask(
    file: FileMetadata,
    config: FileProcessorMerged,
    signal?: AbortSignal
  ): Promise<FileProcessingMarkdownTaskStartResult> {
    const context = this.prepareStartContext(config, signal, file, 'markdown_conversion')
    const job = await createJob(context)
    fileProcessingTaskStore.create<PaddleTaskContext>('paddleocr', job.jobId, {
      apiHost: context.apiHost,
      apiKey: context.apiKey,
      fileId: file.id
    })

    return {
      providerTaskId: job.jobId,
      status: 'pending',
      progress: 0,
      processorId: 'paddleocr'
    }
  }

  async getMarkdownConversionTaskResult(
    providerTaskId: string,
    signal?: AbortSignal
  ): Promise<FileProcessingMarkdownTaskResult> {
    const taskContext = fileProcessingTaskStore.get<PaddleTaskContext>('paddleocr', providerTaskId)

    if (!taskContext) {
      throw new Error(`PaddleOCR task context not found for task ${providerTaskId}`)
    }

    const context: PreparedPaddleQueryContext = {
      apiHost: taskContext.apiHost,
      apiKey: taskContext.apiKey,
      signal
    }
    const jobResult = await getJobResult(providerTaskId, context)

    if (jobResult.state === 'failed') {
      fileProcessingTaskStore.delete('paddleocr', providerTaskId)
      return {
        status: 'failed',
        progress: 0,
        processorId: 'paddleocr',
        error: jobResult.errorMsg || 'PaddleOCR markdown conversion failed'
      }
    }

    if (jobResult.state !== 'done') {
      return {
        status: jobResult.state === 'pending' ? 'pending' : 'processing',
        progress: mapProgress(jobResult),
        processorId: 'paddleocr'
      }
    }

    logger.info('PaddleOCR markdown conversion job completed', {
      processorId: 'paddleocr',
      providerTaskId,
      resultUrl: jobResult.resultUrl
    })

    const markdownContent = await resolveJsonlResult(providerTaskId, jobResult, context.signal)
    const persistedMarkdownPath = await this.persistMarkdownConversionResult(taskContext.fileId, markdownContent)
    fileProcessingTaskStore.delete('paddleocr', providerTaskId)

    return {
      status: 'completed',
      progress: 100,
      processorId: 'paddleocr',
      markdownPath: persistedMarkdownPath
    }
  }

  private async persistMarkdownConversionResult(fileId: string, markdownContent: string): Promise<string> {
    const fileProcessingResultsDir = getFileProcessingResultsDir(fileId)

    return persistMarkdownResult({
      resultsDir: fileProcessingResultsDir,
      markdownContent
    })
  }

  private prepareStartContext(
    config: FileProcessorMerged,
    signal: AbortSignal | undefined,
    file: FileMetadata,
    feature: 'markdown_conversion' | 'text_extraction'
  ): PreparedPaddleStartContext {
    const capability = this.getRequiredCapability(config, feature)

    if (!file.path) {
      throw new Error('File path is required')
    }

    if (feature === 'text_extraction' && !isImageFileMetadata(file)) {
      throw new Error('PaddleOCR text extraction only supports image files')
    }

    const apiHost = capability.apiHost?.trim().replace(/\/+$/, '')
    if (!apiHost) {
      throw new Error('API host is required')
    }

    const apiKey = this.getApiKey(config)
    if (!apiKey) {
      throw new Error('API key is required')
    }

    const model = capability.modelId?.trim() || undefined

    if (model === 'PP-OCRv5') {
      throw new Error('PaddleOCR model PP-OCRv5 is not supported yet')
    }

    return {
      apiHost,
      apiKey,
      signal,
      file,
      model
    }
  }
}

export const paddleProcessor = new PaddleProcessor()
