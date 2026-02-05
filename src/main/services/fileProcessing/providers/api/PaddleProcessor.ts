/**
 * Paddle Processor
 *
 * API-based OCR processor using PaddleOCR service.
 * Requires an API host to be configured.
 */

import { loggerService } from '@logger'
import { fileStorage } from '@main/services/FileStorage'
import { getTempDir } from '@main/utils/file'
import { loadOcrImage } from '@main/utils/ocr'
import {
  type FileProcessorFeature,
  type FileProcessorMerged,
  PRESETS_FILE_PROCESSORS
} from '@shared/data/presets/file-processing'
import type { ProcessingResult, ProcessResultResponse } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import { isImageFileMetadata } from '@types'
import { net } from 'electron'
import FormData from 'form-data'
import * as fs from 'fs'
import * as path from 'path'
import * as z from 'zod'

import { BaseFileProcessor } from '../../base/BaseFileProcessor'
import { UnsupportedInputError } from '../../errors'
import type { IMarkdownConverter, IProcessStatusProvider, ITextExtractor } from '../../interfaces'
import type { ProcessingContext } from '../../types'

const logger = loggerService.withContext('PaddleProcessor')

const JOB_PATH = '/api/v2/ocr/jobs'

const JobSubmitResponseSchema = z.looseObject({
  traceId: z.string().optional(),
  code: z.number(),
  msg: z.string().optional(),
  data: z
    .looseObject({
      jobId: z.string().optional()
    })
    .optional()
})

const JobStatusResponseSchema = z.looseObject({
  traceId: z.string().optional(),
  code: z.number(),
  msg: z.string().optional(),
  data: z
    .looseObject({
      jobId: z.string().optional(),
      state: z.string().optional(),
      errorMsg: z.string().optional(),
      resultUrl: z
        .looseObject({
          jsonUrl: z.string().optional(),
          markdownUrl: z.string().optional()
        })
        .optional(),
      extractProgress: z
        .looseObject({
          startTime: z.string().optional(),
          endTime: z.string().optional(),
          totalPages: z.union([z.number(), z.string()]).optional(),
          extractedPages: z.union([z.number(), z.string()]).optional()
        })
        .optional()
    })
    .optional()
})

type PaddleTaskPayload = {
  jobId: string
  fileId: string
  originalName: string
  feature: FileProcessorFeature
  modelId: string
}

const formatZodError = (error: z.ZodError): string =>
  error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>'
      return `[${issue.code}] ${path}: ${issue.message}`
    })
    .join('; ')

const getErrorMessage = (error: unknown): string => {
  if (error instanceof z.ZodError) {
    return formatZodError(error)
  }
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return 'Unknown error'
}

/**
 * Paddle processor
 *
 * Sends images to a PaddleOCR API endpoint for text extraction.
 */
export class PaddleProcessor
  extends BaseFileProcessor
  implements ITextExtractor, IMarkdownConverter, IProcessStatusProvider
{
  private readonly markdownStorageDir: string

  constructor() {
    const template = PRESETS_FILE_PROCESSORS.find((p) => p.id === 'paddleocr')
    if (!template) {
      throw new Error('PaddleOCR processor template not found in presets')
    }
    super(template)
    this.markdownStorageDir = path.join(getTempDir(), 'preprocess')
    this.ensureMarkdownStorageDir()
  }

  private ensureMarkdownStorageDir(): void {
    if (!fs.existsSync(this.markdownStorageDir)) {
      fs.mkdirSync(this.markdownStorageDir, { recursive: true })
    }
  }

  private getTextApiHost(config: FileProcessorMerged): string {
    const capability = config.capabilities.find((cap) => cap.feature === 'text_extraction')
    if (capability?.apiHost) {
      return capability.apiHost
    }

    throw new Error(`API host is required for ${this.id} processor`)
  }

  private getMarkdownApiHost(config: FileProcessorMerged): string {
    const capability = config.capabilities.find((cap) => cap.feature === 'markdown_conversion')
    if (capability?.apiHost) {
      return capability.apiHost
    }

    throw new Error(`API host is required for ${this.id} markdown conversion`)
  }

  private getApiHostForFeature(feature: FileProcessorFeature, config: FileProcessorMerged): string {
    return feature === 'text_extraction' ? this.getTextApiHost(config) : this.getMarkdownApiHost(config)
  }

  private getModelId(feature: FileProcessorFeature, config: FileProcessorMerged): string {
    const capability = config.capabilities.find((cap) => cap.feature === feature)
    if (capability?.modelId) {
      return capability.modelId
    }

    throw new Error(`Model ID is required for ${this.id} ${feature}`)
  }

  private getMarkdownFileName(originalName: string): string {
    return originalName.replace(/\.(pdf|jpg|jpeg|png)$/i, '.md')
  }

  private prepareMarkdownOutputDir(fileId: string): string {
    const outputDir = path.join(this.markdownStorageDir, fileId)

    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
    fs.mkdirSync(outputDir, { recursive: true })

    return outputDir
  }

  private buildJobUrl(apiHost: string): string {
    return `${apiHost.replace(/\/+$/, '')}${JOB_PATH}`
  }

  private getOptionalPayload(feature: FileProcessorFeature): Record<string, boolean> {
    if (feature === 'text_extraction') {
      return {
        useDocOrientationClassify: false,
        useDocUnwarping: false,
        useTextlineOrientation: false
      }
    }

    return {
      useDocOrientationClassify: false,
      useDocUnwarping: false,
      useChartRecognition: false
    }
  }

  private buildProviderTaskId(payload: PaddleTaskPayload): string {
    return JSON.stringify(payload)
  }

  private parseProviderTaskId(providerTaskId: string): PaddleTaskPayload {
    let parsed: unknown
    try {
      parsed = JSON.parse(providerTaskId)
    } catch (error) {
      throw new Error(`Invalid provider task id: ${error instanceof Error ? error.message : String(error)}`)
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid provider task id')
    }

    const record = parsed as Record<string, unknown>
    const jobId = record['jobId']
    const fileId = record['fileId']
    const originalName = record['originalName']
    const feature = record['feature']
    const modelId = record['modelId']

    if (
      typeof jobId !== 'string' ||
      typeof fileId !== 'string' ||
      typeof originalName !== 'string' ||
      typeof feature !== 'string' ||
      typeof modelId !== 'string'
    ) {
      throw new Error('Invalid provider task id')
    }

    if (feature !== 'text_extraction' && feature !== 'markdown_conversion') {
      throw new Error('Invalid provider task id')
    }

    return {
      jobId,
      fileId,
      originalName,
      feature,
      modelId
    }
  }

  private parseJsonl(text: string): Array<Record<string, unknown>> {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  }

  private extractTextFromJsonl(jsonlText: string): string {
    const results: string[] = []

    for (const entry of this.parseJsonl(jsonlText)) {
      const result = entry['result'] as Record<string, unknown> | undefined
      const ocrResults = Array.isArray(result?.['ocrResults']) ? (result?.['ocrResults'] as unknown[]) : []

      for (const ocrResult of ocrResults) {
        if (!ocrResult || typeof ocrResult !== 'object') continue
        const record = ocrResult as Record<string, unknown>
        const pruned = record['prunedResult'] as Record<string, unknown> | undefined
        const recTexts = Array.isArray(pruned?.['rec_texts'])
          ? (pruned?.['rec_texts'] as string[])
          : Array.isArray(record['rec_texts'])
            ? (record['rec_texts'] as string[])
            : []

        results.push(...recTexts.filter((text) => typeof text === 'string'))
      }
    }

    return results.join('\n')
  }

  private extractMarkdownFromJsonl(jsonlText: string): string {
    const markdownParts: string[] = []

    for (const entry of this.parseJsonl(jsonlText)) {
      const result = entry['result'] as Record<string, unknown> | undefined
      const layoutResults = Array.isArray(result?.['layoutParsingResults'])
        ? (result?.['layoutParsingResults'] as unknown[])
        : []

      for (const layoutResult of layoutResults) {
        if (!layoutResult || typeof layoutResult !== 'object') continue
        const record = layoutResult as Record<string, unknown>
        const markdown = record['markdown'] as Record<string, unknown> | undefined
        const text = markdown?.['text']

        if (typeof text === 'string' && text.trim().length > 0) {
          markdownParts.push(text)
        }
      }
    }

    return markdownParts.join('\n\n')
  }

  private parseProgressValue(value: string | number | undefined): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const parsed = Number.parseInt(value, 10)
      if (Number.isFinite(parsed)) return parsed
    }
    return null
  }

  private async submitJob(
    input: FileMetadata,
    config: FileProcessorMerged,
    feature: FileProcessorFeature,
    context: ProcessingContext
  ): Promise<{ jobId: string; modelId: string }> {
    const apiHost = this.getApiHostForFeature(feature, config)
    const apiKey = this.requireApiKey(config)
    const modelId = this.getModelId(feature, config)

    const formData = new FormData()
    formData.append('model', modelId)
    formData.append('optionalPayload', JSON.stringify(this.getOptionalPayload(feature)))

    if (feature === 'text_extraction') {
      if (!isImageFileMetadata(input)) {
        throw new UnsupportedInputError('PaddleProcessor only supports image files')
      }
      const buffer = await loadOcrImage(input)
      formData.append('file', buffer, { filename: input.origin_name || input.name })
    } else {
      const filePath = fileStorage.getFilePathById(input)
      const fileBuffer = await fs.promises.readFile(filePath)
      formData.append('file', fileBuffer, { filename: input.origin_name || input.name })
    }

    this.checkCancellation(context)

    const response = await net.fetch(this.buildJobUrl(apiHost), {
      method: 'POST',
      headers: {
        ...formData.getHeaders(),
        Authorization: `Bearer ${apiKey}`
      },
      body: new Uint8Array(formData.getBuffer())
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`PaddleOCR async job error: ${response.status} ${response.statusText} - ${text}`)
    }

    const data = JobSubmitResponseSchema.parse(await response.json())

    if (data.code !== 0 || !data.data?.jobId) {
      throw new Error(`PaddleOCR job submission failed [${data.code}]: ${data.msg ?? 'Unknown error'}`)
    }

    return { jobId: data.data.jobId, modelId }
  }

  private async fetchJsonl(url: string): Promise<string> {
    const response = await net.fetch(url, { method: 'GET' })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`PaddleOCR result download failed: ${response.status} ${response.statusText} - ${text}`)
    }

    return response.text()
  }

  /**
   * Perform text extraction using PaddleOCR async API
   */
  async extractText(
    input: FileMetadata,
    config: FileProcessorMerged,
    context: ProcessingContext
  ): Promise<ProcessingResult> {
    if (!isImageFileMetadata(input)) {
      throw new UnsupportedInputError('PaddleProcessor only supports image files')
    }

    this.checkCancellation(context)

    try {
      const { jobId, modelId } = await this.submitJob(input, config, 'text_extraction', context)

      return {
        metadata: {
          providerTaskId: this.buildProviderTaskId({
            jobId,
            fileId: input.id,
            originalName: input.origin_name,
            feature: 'text_extraction',
            modelId
          })
        }
      }
    } catch (error) {
      const errorMsg = getErrorMessage(error)
      logger.error('Error during PaddleProcessor text extraction', { error: errorMsg })
      throw error
    }
  }

  /**
   * Convert a document to markdown using PaddleOCR async API
   */
  async convertToMarkdown(
    input: FileMetadata,
    config: FileProcessorMerged,
    context: ProcessingContext
  ): Promise<ProcessingResult> {
    if (input.ext.toLowerCase() !== '.pdf') {
      throw new UnsupportedInputError('PaddleProcessor markdown conversion only supports PDF documents')
    }

    this.validateFile(input)
    this.checkCancellation(context)

    try {
      const { jobId, modelId } = await this.submitJob(input, config, 'markdown_conversion', context)

      return {
        metadata: {
          providerTaskId: this.buildProviderTaskId({
            jobId,
            fileId: input.id,
            originalName: input.origin_name,
            feature: 'markdown_conversion',
            modelId
          })
        }
      }
    } catch (error) {
      const errorMsg = getErrorMessage(error)
      logger.error('Error during PaddleProcessor markdown conversion', { error: errorMsg })
      throw error
    }
  }

  async getStatus(providerTaskId: string, config: FileProcessorMerged): Promise<ProcessResultResponse> {
    let payload: PaddleTaskPayload
    try {
      payload = this.parseProviderTaskId(providerTaskId)
    } catch (error) {
      logger.error('PaddleOCR status query failed: invalid provider task id', {
        providerTaskId,
        error: error instanceof Error ? error.message : String(error)
      })
      return {
        requestId: providerTaskId,
        status: 'failed',
        progress: 0,
        error: { code: 'status_query_failed', message: (error as Error).message }
      }
    }

    const apiHost = this.getApiHostForFeature(payload.feature, config)
    const apiKey = this.requireApiKey(config)

    try {
      const response = await net.fetch(`${this.buildJobUrl(apiHost)}/${payload.jobId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        }
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`PaddleOCR status error: ${response.status} ${response.statusText} - ${text}`)
      }

      const data = JobStatusResponseSchema.parse(await response.json())

      if (data.code !== 0) {
        return {
          requestId: providerTaskId,
          status: 'failed',
          progress: 0,
          error: { code: 'processing_failed', message: data.msg ?? 'PaddleOCR status error' }
        }
      }

      const statusData = data.data
      const state = statusData?.state

      if (!state) {
        return {
          requestId: providerTaskId,
          status: 'processing',
          progress: 0
        }
      }

      if (state === 'failed') {
        return {
          requestId: providerTaskId,
          status: 'failed',
          progress: 0,
          error: { code: 'processing_failed', message: statusData?.errorMsg || 'PaddleOCR processing failed' }
        }
      }

      if (state === 'pending') {
        return {
          requestId: providerTaskId,
          status: 'processing',
          progress: 0
        }
      }

      if (state === 'running') {
        const totalPages = this.parseProgressValue(statusData?.extractProgress?.totalPages)
        const extractedPages = this.parseProgressValue(statusData?.extractProgress?.extractedPages)
        const progress =
          totalPages && extractedPages != null && totalPages > 0 ? Math.round((extractedPages / totalPages) * 100) : 0

        return {
          requestId: providerTaskId,
          status: 'processing',
          progress: Math.max(0, Math.min(progress, 99))
        }
      }

      if (state === 'done') {
        const jsonUrl = statusData?.resultUrl?.jsonUrl
        if (!jsonUrl) {
          return {
            requestId: providerTaskId,
            status: 'failed',
            progress: 0,
            error: { code: 'processing_failed', message: 'PaddleOCR result url missing' }
          }
        }

        const jsonlText = await this.fetchJsonl(jsonUrl)

        if (payload.feature === 'markdown_conversion') {
          const markdownText = this.extractMarkdownFromJsonl(jsonlText)
          if (!markdownText.trim()) {
            return {
              requestId: providerTaskId,
              status: 'failed',
              progress: 0,
              error: { code: 'processing_failed', message: 'PaddleOCR markdown result is empty' }
            }
          }

          const outputDir = this.prepareMarkdownOutputDir(payload.fileId)
          const markdownPath = path.join(outputDir, this.getMarkdownFileName(payload.originalName))
          fs.writeFileSync(markdownPath, markdownText, 'utf-8')

          return {
            requestId: providerTaskId,
            status: 'completed',
            progress: 100,
            result: { markdownPath }
          }
        } else {
          const text = this.extractTextFromJsonl(jsonlText)

          return {
            requestId: providerTaskId,
            status: 'completed',
            progress: 100,
            result: { text }
          }
        }
      }

      return {
        requestId: providerTaskId,
        status: 'processing',
        progress: 0
      }
    } catch (error) {
      logger.error('PaddleOCR status query failed', {
        providerTaskId,
        jobId: payload.jobId,
        error: error instanceof Error ? error.message : String(error)
      })
      return {
        requestId: providerTaskId,
        status: 'failed',
        progress: 0,
        error: { code: 'status_query_failed', message: error instanceof Error ? error.message : String(error) }
      }
    }
  }
}
