/**
 * MinerU Document Processor
 *
 * API-based document processor using MinerU service.
 * Converts PDFs to markdown format.
 */

import { loggerService } from '@logger'
import { fileStorage } from '@main/services/FileStorage'
import { type FileProcessorMerged, PRESETS_FILE_PROCESSORS } from '@shared/data/presets/fileProcessing'
import type { ProcessingResult, ProcessResultResponse } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import AdmZip from 'adm-zip'
import { net } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

import { BaseMarkdownConverter } from '../../base/BaseMarkdownConverter'
import type { IProcessStatusProvider } from '../../interfaces'
import type { ProcessingContext } from '../../types'

const logger = loggerService.withContext('MineruProcessor')

type ApiResponse<T> = {
  code: number
  data: T
  msg?: string
  trace_id?: string
}

type BatchUploadResponse = {
  batch_id: string
  file_urls: string[]
  headers?: Record<string, string>[]
}

type ExtractProgress = {
  extracted_pages: number
  total_pages: number
  start_time: string
}

type ExtractFileResult = {
  file_name: string
  state: 'done' | 'waiting-file' | 'pending' | 'running' | 'converting' | 'failed'
  err_msg: string
  full_zip_url?: string
  data_id?: string
  extract_progress?: ExtractProgress
}

type ExtractResultResponse = {
  batch_id: string
  extract_result: ExtractFileResult[]
}

type MineruTaskPayload = {
  batchId: string
  fileId: string
  fileName: string
  originalName: string
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

    const data: ApiResponse<BatchUploadResponse> = await response.json()
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

    const data: ApiResponse<ExtractResultResponse> = await response.json()
    if (data.code === 0 && data.data) {
      return data.data
    }

    throw new Error(`API returned error: ${data.msg || JSON.stringify(data)}`)
  }

  private buildProviderTaskId(payload: MineruTaskPayload): string {
    return JSON.stringify(payload)
  }

  private parseProviderTaskId(providerTaskId: string): MineruTaskPayload {
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
    const batchId = record['batchId']
    const fileId = record['fileId']
    const fileName = record['fileName']
    const originalName = record['originalName']

    if (
      typeof batchId !== 'string' ||
      typeof fileId !== 'string' ||
      typeof fileName !== 'string' ||
      typeof originalName !== 'string'
    ) {
      throw new Error('Invalid provider task id')
    }

    return { batchId, fileId, fileName, originalName }
  }

  private async downloadAndExtract(zipUrl: string, fileId: string): Promise<string> {
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

    return extractPath
  }

  private readMarkdownContent(extractPath: string, originalName: string): { markdown: string; outputPath: string } {
    const files = fs.readdirSync(extractPath)
    const mdFile = files.find((f) => f.endsWith('.md'))

    if (!mdFile) {
      throw new Error('No markdown file found in extraction output')
    }

    const originalMdPath = path.join(extractPath, mdFile)
    const finalName = originalName.replace(/\.[^/.]+$/, '.md')
    const finalPath = path.join(extractPath, finalName)

    try {
      fs.renameSync(originalMdPath, finalPath)
      logger.info(`Renamed markdown file from ${mdFile} to ${finalName}`)
    } catch (error: unknown) {
      logger.warn(`Failed to rename file, using original: ${mdFile}`, { error })
    }

    const actualPath = fs.existsSync(finalPath) ? finalPath : originalMdPath
    const markdown = fs.readFileSync(actualPath, 'utf-8')

    return { markdown, outputPath: actualPath }
  }

  async convertToMarkdown(
    input: FileMetadata,
    config: FileProcessorMerged,
    context: ProcessingContext
  ): Promise<ProcessingResult> {
    await this.validateFile(input)
    this.checkCancellation(context)

    const apiHost = this.getApiHost(config)
    const apiKey = this.getApiKey(config)!
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
      return {
        requestId: providerTaskId,
        status: 'failed',
        progress: 0,
        error: { code: 'invalid_provider_task_id', message: (error as Error).message }
      }
    }

    const apiHost = this.getApiHost(config)
    const apiKey = this.getApiKey(config)!

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
        const extractPath = await this.downloadAndExtract(fileResult.full_zip_url, payload.fileId)
        const { markdown, outputPath } = this.readMarkdownContent(extractPath, payload.originalName)

        return {
          requestId: providerTaskId,
          status: 'completed',
          progress: 100,
          result: {
            markdown,
            outputPath,
            metadata: {
              batchId: payload.batchId,
              extractPath
            }
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
      return {
        requestId: providerTaskId,
        status: 'failed',
        progress: 0,
        error: { code: 'status_query_failed', message: error instanceof Error ? error.message : String(error) }
      }
    }
  }
}
