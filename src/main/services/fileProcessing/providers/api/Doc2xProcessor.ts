/**
 * Doc2X Document Processor
 *
 * API-based document processor using Doc2X service.
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

const logger = loggerService.withContext('Doc2xProcessor')

type ApiResponse<T> = {
  code: string
  data: T
  message?: string
}

type PreuploadResponse = {
  uid: string
  url: string
}

type StatusResponse = {
  status: string
  progress: number
}

type ParsedFileResponse = {
  status: string
  url: string
}

const POLL_INTERVAL_MS = 1000

export class Doc2xProcessor extends BaseMarkdownConverter {
  constructor() {
    const template = PRESETS_FILE_PROCESSORS.find((p) => p.id === 'doc2x')
    if (!template) {
      throw new Error('Doc2X processor template not found in presets')
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
    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true })
    const numPages = pdfDoc.getPageCount()

    if (maxPageCount !== undefined && numPages > maxPageCount) {
      throw new Error(`PDF page count (${numPages}) exceeds the limit of ${maxPageCount} pages`)
    }
  }

  private async preupload(apiHost: string, apiKey: string): Promise<PreuploadResponse> {
    const response = await net.fetch(`${apiHost}/api/v2/parse/preupload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: null
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = (await response.json()) as ApiResponse<PreuploadResponse>

    if (data.code === 'success' && data.data) {
      return data.data
    }

    throw new Error(`API returned error: ${data.message || JSON.stringify(data)}`)
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

  private async getStatus(apiHost: string, apiKey: string, uid: string): Promise<StatusResponse> {
    const response = await net.fetch(`${apiHost}/api/v2/parse/status?uid=${uid}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = (await response.json()) as ApiResponse<StatusResponse>

    if (data.code === 'success' && data.data) {
      return data.data
    }

    throw new Error(`API returned error: ${data.message || JSON.stringify(data)}`)
  }

  private async waitForProcessing(
    apiHost: string,
    apiKey: string,
    uid: string,
    context: ProcessingContext
  ): Promise<void> {
    while (true) {
      this.checkCancellation(context)
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))

      const { status, progress } = await this.getStatus(apiHost, apiKey, uid)
      logger.debug(`Processing status: ${status}, progress: ${progress}%`)

      if (status === 'success') {
        return
      }

      if (status === 'failed') {
        throw new Error('Doc2X processing failed')
      }
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

    const data = (await response.json()) as ApiResponse<unknown>

    if (data.code !== 'success') {
      throw new Error(`API returned error: ${data.message || JSON.stringify(data)}`)
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

    const data = (await response.json()) as ApiResponse<ParsedFileResponse>

    if (data.data) {
      return data.data
    }

    throw new Error('No data in response')
  }

  private async waitForExport(
    apiHost: string,
    apiKey: string,
    uid: string,
    context: ProcessingContext
  ): Promise<string> {
    while (true) {
      this.checkCancellation(context)
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))

      const { status, url } = await this.getParsedFile(apiHost, apiKey, uid)
      logger.debug(`Export status: ${status}`)

      if (status === 'success' && url) {
        return url
      }

      if (status === 'failed') {
        throw new Error('Export failed')
      }
    }
  }

  private async downloadAndExtract(url: string, fileId: string): Promise<string> {
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

    return extractPath
  }

  private readMarkdownContent(extractPath: string, originalName: string): { markdown: string; outputPath: string } {
    const baseName = originalName.split('.').slice(0, -1).join('.')
    const outputFilePath = path.join(extractPath, `${baseName}.md`)

    if (!fs.existsSync(outputFilePath)) {
      throw new Error(`Markdown file not found at: ${outputFilePath}`)
    }

    const markdown = fs.readFileSync(outputFilePath, 'utf-8')

    return { markdown, outputPath: outputFilePath }
  }

  protected async doConvert(
    input: FileMetadata,
    config: FileProcessorMerged,
    context: ProcessingContext
  ): Promise<ProcessingResult> {
    const apiHost = this.getApiHost(config)
    const apiKey = this.getApiKey(config)!

    const filePath = fileStorage.getFilePathById(input)
    logger.info(`Doc2X processing started: ${filePath}`)

    await this.validatePdf(filePath)
    this.checkCancellation(context)

    const { uid, url } = await this.preupload(apiHost, apiKey)
    logger.info(`Preupload completed: uid=${uid}`)

    await this.putFile(filePath, url)
    logger.info('File uploaded successfully')
    this.checkCancellation(context)

    await this.waitForProcessing(apiHost, apiKey, uid, context)
    logger.info('Processing completed')

    const fileName = path.parse(filePath).name
    await this.convertFile(apiHost, apiKey, uid, fileName)
    logger.info('Conversion initiated')

    const exportUrl = await this.waitForExport(apiHost, apiKey, uid, context)
    logger.info(`Export URL received: ${exportUrl}`)

    const extractPath = await this.downloadAndExtract(exportUrl, input.id)
    this.checkCancellation(context)

    const { markdown, outputPath } = this.readMarkdownContent(extractPath, input.origin_name)

    return {
      markdown,
      outputPath,
      metadata: {
        uid,
        extractPath
      }
    }
  }
}
