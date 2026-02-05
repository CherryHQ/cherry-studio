/**
 * MinerU Document Processor
 *
 * API-based document processor using MinerU service.
 * Converts PDFs to markdown format.
 */

import { loggerService } from '@logger'
import { fileStorage } from '@main/services/FileStorage'
import { type FileProcessorMerged, PRESETS_FILE_PROCESSORS } from '@shared/data/presets/file-processing'
import type { ProcessingResult, ProcessResultResponse } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import AdmZip from 'adm-zip'
import { net } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as z from 'zod'

import { BaseMarkdownConverter } from '../../base/BaseMarkdownConverter'
import type { IProcessStatusProvider } from '../../interfaces'
import type { ProcessingContext } from '../../types'

const logger = loggerService.withContext('MineruProcessor')

const createApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.looseObject({
    code: z.number(),
    data: dataSchema.optional(),
    msg: z.string().optional(),
    trace_id: z.string().optional()
  })

const BatchUploadResponseSchema = z.looseObject({
  batch_id: z.string(),
  file_urls: z.array(z.string()),
  headers: z.array(z.record(z.string(), z.string())).optional()
})

const ExtractProgressSchema = z.looseObject({
  extracted_pages: z.coerce.number(),
  total_pages: z.coerce.number(),
  start_time: z.string()
})

const ExtractFileResultSchema = z.looseObject({
  file_name: z.string(),
  state: z.string(),
  err_msg: z.string().optional(),
  full_zip_url: z.string().optional(),
  data_id: z.string().optional(),
  extract_progress: ExtractProgressSchema.optional()
})

const ExtractResultResponseSchema = z.looseObject({
  batch_id: z.string(),
  extract_result: z.array(ExtractFileResultSchema)
})

const BatchUploadApiResponseSchema = createApiResponseSchema(BatchUploadResponseSchema)
const ExtractResultApiResponseSchema = createApiResponseSchema(ExtractResultResponseSchema)

type ExtractResultResponse = z.infer<typeof ExtractResultResponseSchema>

type MineruTaskPayload = {
  batchId: string
  fileId: string
  fileName: string
  originalName: string
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

const parseResponse = <T>(schema: z.ZodType<T>, payload: unknown, context: string): T => {
  try {
    return schema.parse(payload)
  } catch (error) {
    const message = getErrorMessage(error)
    logger.error('MinerU response validation failed', { context, error: message })
    throw new Error(`MinerU response validation failed: ${message}`)
  }
}

export class MineruProcessor extends BaseMarkdownConverter implements IProcessStatusProvider {
  constructor() {
    const template = PRESETS_FILE_PROCESSORS.find((p) => p.id === 'mineru')
    if (!template) {
      throw new Error('MinerU processor template not found in presets')
    }
    super(template)
  }

  private async getBatchUploadUrls(
    apiHost: string,
    apiKey: string,
    file: FileMetadata
  ): Promise<{ batchId: string; fileUrls: string[]; uploadHeaders?: Record<string, string>[] }> {
    const response = await net.fetch(`${apiHost}/api/v4/file-urls/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        Accept: '*/*'
      },
      body: JSON.stringify({
        enable_formula: true,
        enable_table: true,
        files: [
          {
            name: file.origin_name,
            is_ocr: true,
            data_id: file.id
          }
        ]
      })
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = parseResponse(BatchUploadApiResponseSchema, await response.json(), 'getBatchUploadUrls')
    if (data.code === 0 && data.data) {
      const { batch_id, file_urls, headers: uploadHeaders } = data.data
      return { batchId: batch_id, fileUrls: file_urls, uploadHeaders }
    }

    throw new Error(`API returned error: ${data.msg || JSON.stringify(data)}`)
  }

  private async putFileToUrl(filePath: string, uploadUrl: string, headers?: Record<string, string>): Promise<void> {
    const fileBuffer = await fs.promises.readFile(filePath)

    const response = await net.fetch(uploadUrl, {
      method: 'PUT',
      headers,
      body: new Uint8Array(fileBuffer)
    })

    if (!response.ok) {
      const responseBody = await response.text()
      throw new Error(`Upload failed with status ${response.status}: ${responseBody}`)
    }
  }

  private async getExtractResults(apiHost: string, apiKey: string, batchId: string): Promise<ExtractResultResponse> {
    const response = await net.fetch(`${apiHost}/api/v4/extract-results/batch/${batchId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = parseResponse(ExtractResultApiResponseSchema, await response.json(), 'getExtractResults')
    if (data.code === 0 && data.data) {
      return data.data
    }

    throw new Error(`API returned error: ${data.msg || JSON.stringify(data)}`)
  }

  private buildProviderTaskId(payload: MineruTaskPayload): string {
    return JSON.stringify(payload)
  }

  private parseProviderTaskId(providerTaskId: string): MineruTaskPayload {
    try {
      const payload = JSON.parse(providerTaskId) as MineruTaskPayload
      const { batchId, fileId, fileName, originalName } = payload
      if (!batchId || !fileId || !fileName || !originalName) {
        throw new Error(
          `Missing required fields in provider task id: ${JSON.stringify({ batchId: !!batchId, fileId: !!fileId, fileName: !!fileName, originalName: !!originalName })}`
        )
      }
      return { batchId, fileId, fileName, originalName }
    } catch (error) {
      throw new Error(`Invalid provider task id: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async downloadAndExtractMarkdown(zipUrl: string, fileId: string): Promise<string> {
    const zipPath = path.join(this.storageDir, `${fileId}.zip`)
    const extractPath = path.join(this.storageDir, fileId)

    logger.info(`Downloading MinerU result to: ${zipPath}`)

    const response = await net.fetch(zipUrl, { method: 'GET' })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    fs.writeFileSync(zipPath, Buffer.from(arrayBuffer))

    if (!fs.existsSync(extractPath)) {
      fs.mkdirSync(extractPath, { recursive: true })
    }

    const zip = new AdmZip(zipPath)
    zip.extractAllTo(extractPath, true)
    logger.info(`Extracted files to: ${extractPath}`)

    fs.unlinkSync(zipPath)

    const files = fs.readdirSync(extractPath)
    const mdFile = files.find((f) => f.endsWith('.md'))

    if (!mdFile) {
      throw new Error('No markdown file found in extraction output')
    }

    return path.join(extractPath, mdFile)
  }

  async convertToMarkdown(
    input: FileMetadata,
    config: FileProcessorMerged,
    context: ProcessingContext
  ): Promise<ProcessingResult> {
    await this.validateFile(input)
    this.checkCancellation(context)

    const apiHost = this.getApiHost(config)
    const apiKey = this.requireApiKey(config)
    const filePath = fileStorage.getFilePathById(input)
    logger.info(`MinerU processing started: ${filePath}`)

    const { batchId, fileUrls, uploadHeaders } = await this.getBatchUploadUrls(apiHost, apiKey, input)
    logger.info(`Got batch upload URL: batchId=${batchId}`)

    await this.putFileToUrl(filePath, fileUrls[0], uploadHeaders?.[0])
    logger.info(`File uploaded successfully`)
    this.checkCancellation(context)

    return {
      metadata: {
        providerTaskId: this.buildProviderTaskId({
          batchId,
          fileId: input.id,
          fileName: input.origin_name,
          originalName: input.origin_name
        })
      }
    }
  }

  async getStatus(providerTaskId: string, config: FileProcessorMerged): Promise<ProcessResultResponse> {
    let payload: MineruTaskPayload
    try {
      payload = this.parseProviderTaskId(providerTaskId)
    } catch (error) {
      logger.error('MinerU status query failed: invalid provider task id', {
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

    const apiHost = this.getApiHost(config)
    const apiKey = this.requireApiKey(config)

    try {
      const result = await this.getExtractResults(apiHost, apiKey, payload.batchId)
      const fileResult = result.extract_result.find((item) => item.file_name === payload.fileName)

      if (!fileResult) {
        return {
          requestId: providerTaskId,
          status: 'processing',
          progress: 0
        }
      }

      if (fileResult.state === 'failed') {
        return {
          requestId: providerTaskId,
          status: 'failed',
          progress: 0,
          error: { code: 'processing_failed', message: fileResult.err_msg || 'Processing failed' }
        }
      }

      if (fileResult.state === 'done' && fileResult.full_zip_url) {
        const markdownPath = await this.downloadAndExtractMarkdown(fileResult.full_zip_url, payload.fileId)

        return {
          requestId: providerTaskId,
          status: 'completed',
          progress: 100,
          result: {
            markdownPath
          }
        }
      }

      const progress = fileResult.extract_progress
        ? Math.round((fileResult.extract_progress.extracted_pages / fileResult.extract_progress.total_pages) * 100)
        : 0

      return {
        requestId: providerTaskId,
        status: 'processing',
        progress: Math.max(0, Math.min(progress, 99))
      }
    } catch (error) {
      logger.error('MinerU status query failed', {
        providerTaskId,
        batchId: payload.batchId,
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
