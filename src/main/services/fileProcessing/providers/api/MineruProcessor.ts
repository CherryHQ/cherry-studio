/**
 * MinerU Document Processor
 *
 * API-based document processor using MinerU service.
 * Converts PDFs to markdown format.
 */

import { loggerService } from '@logger'
import { fileStorage } from '@main/services/FileStorage'
import { type FileProcessorMerged, PRESETS_FILE_PROCESSORS } from '@shared/data/presets/fileProcessing'
import type { ProcessingResult } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import AdmZip from 'adm-zip'
import { net } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { PDFDocument } from 'pdf-lib'

import { BaseMarkdownConverter } from '../../base/BaseMarkdownConverter'
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

const POLL_INTERVAL_MS = 5000
const MAX_RETRIES = 60

export class MineruProcessor extends BaseMarkdownConverter {
  constructor() {
    const template = PRESETS_FILE_PROCESSORS.find((p) => p.id === 'mineru')
    if (!template) {
      throw new Error('MinerU processor template not found in presets')
    }
    super(template)
  }

  private async validatePdf(filePath: string): Promise<void> {
    const stats = await fs.promises.stat(filePath)
    const fileSizeBytes = stats.size
    const { maxFileSizeMb, maxPageCount } = this.getDocumentLimits()

    if (maxFileSizeMb !== undefined && fileSizeBytes > maxFileSizeMb * 1024 * 1024) {
      const fileSizeMB = Math.round(fileSizeBytes / (1024 * 1024))
      throw new Error(`PDF file size (${fileSizeMB}MB) exceeds the limit of ${maxFileSizeMb}MB`)
    }

    const pdfBuffer = await fs.promises.readFile(filePath)

    try {
      const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true })
      const numPages = pdfDoc.getPageCount()

      if (maxPageCount !== undefined && numPages > maxPageCount) {
        throw new Error(`PDF page count (${numPages}) exceeds the limit of ${maxPageCount} pages`)
      }

      logger.info(`PDF validation passed: ${numPages} pages, ${Math.round(fileSizeBytes / (1024 * 1024))}MB`)
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes('exceeds the limit')) {
        throw error
      }
      logger.warn(`Failed to parse PDF structure, skipping page count validation: ${errorMessage}`)
    }
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

  private async waitForCompletion(
    apiHost: string,
    apiKey: string,
    batchId: string,
    fileName: string,
    context: ProcessingContext
  ): Promise<ExtractFileResult> {
    let retries = 0

    while (retries < MAX_RETRIES) {
      this.checkCancellation(context)

      try {
        const result = await this.getExtractResults(apiHost, apiKey, batchId)
        const fileResult = result.extract_result.find((item) => item.file_name === fileName)

        if (!fileResult) {
          throw new Error(`File ${fileName} not found in batch results`)
        }

        if (fileResult.state === 'done' && fileResult.full_zip_url) {
          logger.info(`Processing completed for file: ${fileName}`)
          return fileResult
        }

        if (fileResult.state === 'failed') {
          throw new Error(`Processing failed for file: ${fileName}, error: ${fileResult.err_msg}`)
        }

        if (fileResult.state === 'running' && fileResult.extract_progress) {
          const progress = Math.round(
            (fileResult.extract_progress.extracted_pages / fileResult.extract_progress.total_pages) * 100
          )
          logger.debug(`File ${fileName} processing progress: ${progress}%`)
        }
      } catch (error) {
        logger.warn(`Failed to check status for batch ${batchId}, retry ${retries + 1}/${MAX_RETRIES}`)
        if (retries === MAX_RETRIES - 1) {
          throw error
        }
      }

      retries++
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }

    throw new Error(`Processing timeout for batch: ${batchId}`)
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

  protected async doConvert(
    input: FileMetadata,
    config: FileProcessorMerged,
    context: ProcessingContext
  ): Promise<ProcessingResult> {
    const apiHost = this.getApiHost(config)
    const apiKey = this.getApiKey(config)!
    const filePath = fileStorage.getFilePathById(input)
    logger.info(`MinerU processing started: ${filePath}`)

    await this.validatePdf(filePath)

    const { batchId, fileUrls, uploadHeaders } = await this.getBatchUploadUrls(apiHost, apiKey, input)
    logger.info(`Got batch upload URL: batchId=${batchId}`)

    await this.putFileToUrl(filePath, fileUrls[0], uploadHeaders?.[0])
    logger.info(`File uploaded successfully`)
    this.checkCancellation(context)

    const extractResult = await this.waitForCompletion(apiHost, apiKey, batchId, input.origin_name, context)
    logger.info(`Processing completed for batch: ${batchId}`)

    if (!extractResult.full_zip_url) {
      throw new Error(`No download URL available for completed file: ${input.origin_name}`)
    }
    const extractPath = await this.downloadAndExtract(extractResult.full_zip_url, input.id)
    this.checkCancellation(context)

    const { markdown, outputPath } = this.readMarkdownContent(extractPath, input.origin_name)

    return {
      markdown,
      outputPath,
      metadata: {
        batchId,
        extractPath
      }
    }
  }
}
