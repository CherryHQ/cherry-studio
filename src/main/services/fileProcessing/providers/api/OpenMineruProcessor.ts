/**
 * Open MinerU Document Processor
 *
 * API-based document processor using self-hosted MinerU service.
 * Converts PDFs to markdown format.
 */

import { loggerService } from '@logger'
import { fileStorage } from '@main/services/FileStorage'
import { type FileProcessorMerged, PRESETS_FILE_PROCESSORS } from '@shared/data/presets/fileProcessing'
import type { FileMetadata } from '@types'
import AdmZip from 'adm-zip'
import { net } from 'electron'
import FormData from 'form-data'
import * as fs from 'fs'
import * as path from 'path'
import { PDFDocument } from 'pdf-lib'

import { BaseMarkdownConverter } from '../../base/BaseMarkdownConverter'
import type { ProcessingContext, ProcessingResult } from '../../types'

const logger = loggerService.withContext('OpenMineruProcessor')

const MAX_RETRIES = 5
const RETRY_INTERVAL_MS = 5000

export class OpenMineruProcessor extends BaseMarkdownConverter {
  constructor() {
    const template = PRESETS_FILE_PROCESSORS.find((p) => p.id === 'open-mineru')
    if (!template) {
      throw new Error('Open MinerU processor template not found in presets')
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

  private async uploadAndExtract(
    apiHost: string,
    apiKey: string | undefined,
    file: FileMetadata,
    context: ProcessingContext
  ): Promise<string> {
    const endpoint = `${apiHost}/file_parse`
    const filePath = fileStorage.getFilePathById(file)
    const fileBuffer = await fs.promises.readFile(filePath)

    const formData = new FormData()
    formData.append('return_md', 'true')
    formData.append('response_format_zip', 'true')
    formData.append('files', fileBuffer, {
      filename: file.name
    })

    let retries = 0
    let zipPath: string | undefined

    while (retries < MAX_RETRIES) {
      this.checkCancellation(context)

      try {
        const headers: Record<string, string> = {
          ...formData.getHeaders()
        }

        if (apiKey) {
          headers['Authorization'] = `Bearer ${apiKey}`
        }

        const response = await net.fetch(endpoint, {
          method: 'POST',
          headers,
          body: new Uint8Array(formData.getBuffer())
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const contentType = response.headers.get('content-type')
        if (contentType !== 'application/zip') {
          throw new Error(`Unexpected content-type: ${contentType}`)
        }

        zipPath = path.join(this.storageDir, `${file.id}.zip`)
        const extractPath = path.join(this.storageDir, file.id)

        const arrayBuffer = await response.arrayBuffer()
        fs.writeFileSync(zipPath, Buffer.from(arrayBuffer))
        logger.info(`Downloaded ZIP file: ${zipPath}`)

        if (!fs.existsSync(extractPath)) {
          fs.mkdirSync(extractPath, { recursive: true })
        }

        const zip = new AdmZip(zipPath)
        zip.extractAllTo(extractPath, true)
        logger.info(`Extracted files to: ${extractPath}`)

        if (zipPath && fs.existsSync(zipPath)) {
          fs.unlinkSync(zipPath)
        }

        return extractPath
      } catch (error) {
        logger.warn(`Failed to upload and extract: ${(error as Error).message}, retry ${retries + 1}/${MAX_RETRIES}`)

        if (zipPath && fs.existsSync(zipPath)) {
          try {
            fs.unlinkSync(zipPath)
          } catch {
            // Ignore cleanup errors
          }
        }

        if (retries === MAX_RETRIES - 1) {
          throw error
        }
      }

      retries++
      await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS))
    }

    throw new Error(`Processing timeout for file: ${file.id}`)
  }

  private readMarkdownContent(extractPath: string, file: FileMetadata): { markdown: string; outputPath: string } {
    const fileOutputPath = path.join(extractPath, file.id)
    const files = fs.readdirSync(fileOutputPath)

    const mdFile = files.find((f) => f.endsWith('.md'))
    if (!mdFile) {
      throw new Error('No markdown file found in extraction output')
    }

    const originalMdPath = path.join(fileOutputPath, mdFile)
    const finalName = file.origin_name.replace(/\.[^/.]+$/, '.md')
    const finalPath = path.join(fileOutputPath, finalName)

    try {
      fs.renameSync(originalMdPath, finalPath)
      logger.info(`Renamed markdown file from ${mdFile} to ${finalName}`)
    } catch {
      logger.warn(`Failed to rename file, using original: ${mdFile}`)
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
    const apiKey = this.getApiKey(config, false)

    const filePath = fileStorage.getFilePathById(input)
    logger.info(`Open MinerU processing started: ${filePath}`)

    await this.validatePdf(filePath)
    this.checkCancellation(context)

    context.onProgress?.(50)
    logger.info(`File ${input.name} is starting processing...`)

    const extractPath = await this.uploadAndExtract(apiHost, apiKey, input, context)
    this.checkCancellation(context)

    const { markdown, outputPath } = this.readMarkdownContent(extractPath, input)

    return {
      markdown,
      outputPath,
      metadata: {
        extractPath
      }
    }
  }
}
