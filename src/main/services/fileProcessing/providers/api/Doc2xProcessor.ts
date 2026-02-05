/**
 * Doc2X Document Processor
 *
 * API-based document processor using Doc2X service.
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

const logger = loggerService.withContext('Doc2xProcessor')

const createApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.looseObject({
    code: z.string(),
    data: dataSchema.optional(),
    message: z.string().optional(),
    msg: z.string().optional()
  })

const PreuploadResponseSchema = z.looseObject({
  uid: z.string(),
  url: z.string()
})

const StatusResponseSchema = z.looseObject({
  status: z.string(),
  progress: z.coerce.number(),
  detail: z.string().optional()
})

const ParsedFileResponseSchema = z.looseObject({
  status: z.string(),
  url: z.string(),
  detail: z.string().optional()
})

const PreuploadApiResponseSchema = createApiResponseSchema(PreuploadResponseSchema)
const StatusApiResponseSchema = createApiResponseSchema(StatusResponseSchema)
const ParsedFileApiResponseSchema = createApiResponseSchema(ParsedFileResponseSchema)
const BaseApiResponseSchema = createApiResponseSchema(z.unknown())

type PreuploadResponse = z.infer<typeof PreuploadResponseSchema>
type StatusResponse = z.infer<typeof StatusResponseSchema>
type ParsedFileResponse = z.infer<typeof ParsedFileResponseSchema>

type Doc2xTaskPayload = {
  uid: string
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
    logger.error('Doc2X response validation failed', { context, error: message })
    throw new Error(`Doc2X response validation failed: ${message}`)
  }
}

export class Doc2xProcessor extends BaseMarkdownConverter implements IProcessStatusProvider {
  private static readonly CONVERT_REQUEST_TTL_MS = 30 * 60 * 1000
  private static readonly CONVERT_REQUEST_CLEANUP_INTERVAL_MS = 5 * 60 * 1000
  private convertRequested: Map<string, number> = new Map()
  private lastConvertRequestCleanupAt = 0

  constructor() {
    const template = PRESETS_FILE_PROCESSORS.find((p) => p.id === 'doc2x')
    if (!template) {
      throw new Error('Doc2X processor template not found in presets')
    }
    super(template)
  }

  private getApiErrorMessage(data: { message?: string; msg?: string }): string {
    return data.message ?? data.msg ?? JSON.stringify(data)
  }

  private async preupload(apiHost: string, apiKey: string): Promise<PreuploadResponse> {
    const response = await net.fetch(`${apiHost}/api/v2/parse/preupload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = parseResponse(PreuploadApiResponseSchema, await response.json(), 'preupload')

    if (data.code === 'success' && data.data) {
      return data.data
    }

    throw new Error(`API returned error: ${this.getApiErrorMessage(data)}`)
  }

  private async putFile(filePath: string, url: string): Promise<void> {
    const fileStream = fs.createReadStream(filePath)

    const response = await net.fetch(url, {
      method: 'PUT',
      body: fileStream as unknown as BodyInit,
      duplex: 'half'
    } as RequestInit)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
  }

  private async getParseStatus(apiHost: string, apiKey: string, uid: string): Promise<StatusResponse> {
    const response = await net.fetch(`${apiHost}/api/v2/parse/status?uid=${uid}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = parseResponse(StatusApiResponseSchema, await response.json(), 'getParseStatus')

    if (data.code === 'success' && data.data) {
      return data.data
    }

    return {
      status: 'failed',
      progress: 0,
      detail: this.getApiErrorMessage(data)
    }
  }

  private async convertFile(apiHost: string, apiKey: string, uid: string, fileName: string): Promise<void> {
    const response = await net.fetch(`${apiHost}/api/v2/convert/parse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        uid,
        to: 'md',
        formula_mode: 'normal',
        filename: fileName
      })
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = parseResponse(BaseApiResponseSchema, await response.json(), 'convertFile')

    if (data.code !== 'success') {
      throw new Error(`API returned error: ${this.getApiErrorMessage(data)}`)
    }
  }

  private async getParsedFile(apiHost: string, apiKey: string, uid: string): Promise<ParsedFileResponse> {
    const response = await net.fetch(`${apiHost}/api/v2/convert/parse/result?uid=${uid}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = parseResponse(ParsedFileApiResponseSchema, await response.json(), 'getParsedFile')

    if (data.code === 'success' && data.data) {
      return data.data
    }

    return {
      status: 'failed',
      url: '',
      detail: this.getApiErrorMessage(data)
    }
  }

  private buildProviderTaskId(payload: Doc2xTaskPayload): string {
    return JSON.stringify(payload)
  }

  private cleanupConvertRequests(now: number): void {
    if (now - this.lastConvertRequestCleanupAt < Doc2xProcessor.CONVERT_REQUEST_CLEANUP_INTERVAL_MS) return

    this.lastConvertRequestCleanupAt = now

    for (const [uid, lastSeenAt] of this.convertRequested) {
      if (now - lastSeenAt > Doc2xProcessor.CONVERT_REQUEST_TTL_MS) {
        this.convertRequested.delete(uid)
      }
    }
  }

  private parseProviderTaskId(providerTaskId: string): Doc2xTaskPayload {
    let parsed: unknown
    try {
      parsed = JSON.parse(providerTaskId)
    } catch {
      throw new Error('Invalid provider task id')
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid provider task id')
    }

    const record = parsed as Record<string, unknown>
    const uid = record['uid']
    const fileId = record['fileId']
    const fileName = record['fileName']
    const originalName = record['originalName']

    if (
      typeof uid !== 'string' ||
      typeof fileId !== 'string' ||
      typeof fileName !== 'string' ||
      typeof originalName !== 'string'
    ) {
      throw new Error('Invalid provider task id')
    }

    return { uid, fileId, fileName, originalName }
  }

  private async downloadAndExtractMarkdown(url: string, fileId: string, originalName: string): Promise<string> {
    const extractPath = path.join(this.storageDir, fileId)
    const zipPath = path.join(this.storageDir, `${fileId}.zip`)

    fs.mkdirSync(extractPath, { recursive: true })

    logger.info(`Downloading to export path: ${zipPath}`)

    const response = await net.fetch(url, { method: 'GET' })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    fs.writeFileSync(zipPath, Buffer.from(arrayBuffer))

    const zip = new AdmZip(zipPath)
    zip.extractAllTo(extractPath, true)
    logger.info(`Extracted files to: ${extractPath}`)

    fs.unlinkSync(zipPath)

    const baseName = originalName.split('.').slice(0, -1).join('.')
    const markdownPath = path.join(extractPath, `${baseName}.md`)

    if (!fs.existsSync(markdownPath)) {
      throw new Error(`Markdown file not found at: ${markdownPath}`)
    }

    return markdownPath
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
    logger.info(`Doc2X processing started: ${filePath}`)

    const { uid, url } = await this.preupload(apiHost, apiKey)
    logger.info(`Preupload completed: uid=${uid}`)

    await this.putFile(filePath, url)
    logger.info('File uploaded successfully')
    this.checkCancellation(context)

    return {
      metadata: {
        providerTaskId: this.buildProviderTaskId({
          uid,
          fileId: input.id,
          fileName: path.parse(filePath).name,
          originalName: input.origin_name
        })
      }
    }
  }

  async getStatus(providerTaskId: string, config: FileProcessorMerged): Promise<ProcessResultResponse> {
    let payload: Doc2xTaskPayload
    try {
      payload = this.parseProviderTaskId(providerTaskId)
    } catch (error) {
      logger.error('Doc2X status query failed: invalid provider task id', {
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
    const now = Date.now()
    this.cleanupConvertRequests(now)

    try {
      const { status, progress, detail } = await this.getParseStatus(apiHost, apiKey, payload.uid)

      if (status === 'failed') {
        this.convertRequested.delete(payload.uid)
        return {
          requestId: providerTaskId,
          status: 'failed',
          progress: 0,
          error: { code: 'processing_failed', message: detail || 'Doc2X processing failed' }
        }
      }

      if (status !== 'success') {
        return {
          requestId: providerTaskId,
          status: 'processing',
          progress: Math.max(0, Math.min(progress, 99))
        }
      }

      if (!this.convertRequested.has(payload.uid)) {
        await this.convertFile(apiHost, apiKey, payload.uid, payload.fileName)
      }
      this.convertRequested.set(payload.uid, now)

      const { status: exportStatus, url, detail: exportDetail } = await this.getParsedFile(apiHost, apiKey, payload.uid)

      if (exportStatus === 'failed') {
        this.convertRequested.delete(payload.uid)
        return {
          requestId: providerTaskId,
          status: 'failed',
          progress: 0,
          error: { code: 'processing_failed', message: exportDetail || 'Doc2X export failed' }
        }
      }

      if (exportStatus === 'success' && url) {
        const markdownPath = await this.downloadAndExtractMarkdown(url, payload.fileId, payload.originalName)
        this.convertRequested.delete(payload.uid)

        return {
          requestId: providerTaskId,
          status: 'completed',
          progress: 100,
          result: {
            markdownPath
          }
        }
      }

      return {
        requestId: providerTaskId,
        status: 'processing',
        progress: 90
      }
    } catch (error) {
      this.convertRequested.delete(payload.uid)
      logger.error('Doc2X status query failed', {
        providerTaskId,
        uid: payload.uid,
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
