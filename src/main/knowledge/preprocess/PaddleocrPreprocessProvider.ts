import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import BasePreprocessProvider from '@main/knowledge/preprocess/BasePreprocessProvider'
import { paddleOcrSdkService } from '@main/services/paddleocr/PaddleOcrSdkService'
import { fileStorage } from '@main/services/FileStorage'
import { getFileType } from '@main/utils/file'
import { MB } from '@shared/config/constant'
import type { FileMetadata, PreprocessProvider, PreprocessReadPdfResult } from '@types'

const logger = loggerService.withContext('PaddleocrPreprocessProvider')

export const PDF_SIZE_LIMIT_MB = 50
export const PDF_PAGE_LIMIT = 100
export const PDF_SIZE_LIMIT_BYTES = PDF_SIZE_LIMIT_MB * MB
const DOCUMENT_POLL_INTERVAL_MS = 1000

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  return 'Unknown error'
}

function toPreprocessProgress(progress: number): number {
  return Math.max(25, Math.min(99, 25 + Math.round((progress / 100) * 74)))
}

export default class PaddleocrPreprocessProvider extends BasePreprocessProvider {
  constructor(provider: PreprocessProvider, userId?: string) {
    super(provider, userId)
  }

  public async parseFile(sourceId: string, file: FileMetadata): Promise<{ processedFile: FileMetadata }> {
    try {
      const filePath = fileStorage.getFilePathById(file)
      logger.info(`PaddleOCR preprocess processing started: ${filePath}`)

      await this.validateFile(filePath)
      await this.sendPreprocessProgress(sourceId, 25)

      const markdownText = await this.parseDocumentMarkdown(sourceId, filePath)
      const outputDir = await this.saveResults(markdownText, file)
      await this.sendPreprocessProgress(sourceId, 100)

      return {
        processedFile: await this.createProcessedFileInfo(file, outputDir)
      }
    } catch (error: unknown) {
      logger.error('PaddleOCR preprocess processing failed', error as Error)
      throw new Error(getErrorMessage(error))
    }
  }

  private getMarkdownFileName(file: FileMetadata): string {
    return file.origin_name.replace(/\.(pdf|jpg|jpeg|png)$/i, '.md')
  }

  private async validateFile(filePath: string): Promise<void> {
    logger.info(`Validating PDF file: ${filePath}`)
    const ext = path.extname(filePath).toLowerCase()
    if (ext !== '.pdf') {
      throw new Error(`File ${filePath} is not a PDF (extension: ${ext.slice(1)})`)
    }

    const stats = await fs.promises.stat(filePath)
    const fileSizeBytes = stats.size
    if (fileSizeBytes > PDF_SIZE_LIMIT_BYTES) {
      const fileSizeMB = Math.round(fileSizeBytes / MB)
      throw new Error(`PDF file size (${fileSizeMB}MB) exceeds the limit of ${PDF_SIZE_LIMIT_MB}MB`)
    }

    const pdfBuffer = await fs.promises.readFile(filePath)
    let doc: PreprocessReadPdfResult | undefined

    try {
      doc = await this.readPdf(pdfBuffer)
    } catch (error: unknown) {
      const errorMsg = getErrorMessage(error)
      logger.warn(
        `Failed to parse PDF structure (file may be corrupted or use non-standard format). ` +
          `Skipping page count validation. Will attempt to process with PaddleOCR API. ` +
          `Error details: ${errorMsg}. ` +
          `Suggestion: If processing fails, try repairing the PDF using tools like Adobe Acrobat or online PDF repair services.`
      )
    }

    if (doc?.numPages && doc.numPages > PDF_PAGE_LIMIT) {
      throw new Error(`PDF page count (${doc.numPages}) exceeds the limit of ${PDF_PAGE_LIMIT} pages`)
    }

    if (doc) {
      logger.info(`PDF validation passed: ${doc.numPages} pages, ${Math.round(fileSizeBytes / MB)}MB`)
    }
  }

  private async createProcessedFileInfo(file: FileMetadata, outputDir: string): Promise<FileMetadata> {
    const finalMdFileName = this.getMarkdownFileName(file)
    const finalMdPath = path.join(outputDir, finalMdFileName)

    const ext = path.extname(finalMdPath)
    const type = getFileType(ext)
    const fileSize = (await fs.promises.stat(finalMdPath)).size

    return {
      ...file,
      name: finalMdFileName,
      path: finalMdPath,
      type: type,
      ext: ext,
      size: fileSize
    }
  }

  private async parseDocumentMarkdown(sourceId: string, filePath: string): Promise<string> {
    if (!this.provider.apiHost) {
      throw new Error('PaddleOCR API host is not configured')
    }

    if (!this.provider.apiKey) {
      throw new Error('PaddleOCR API key is not configured')
    }

    const task = await paddleOcrSdkService.startDocumentParsing({
      taskId: sourceId,
      token: this.provider.apiKey,
      baseUrl: this.provider.apiHost,
      filePath,
      model: this.provider.model?.trim() || undefined
    })

    logger.info(`Started PaddleOCR document parsing task: ${task.providerTaskId}`)

    while (true) {
      const status = await paddleOcrSdkService.getDocumentParsingStatus({
        taskId: sourceId,
        providerTaskId: task.providerTaskId,
        token: this.provider.apiKey,
        baseUrl: this.provider.apiHost
      })

      if (status.status === 'failed') {
        throw new Error(`PaddleOCR document parsing failed for provider task ${task.providerTaskId}`)
      }

      if (status.status === 'completed') {
        break
      }

      await this.sendPreprocessProgress(sourceId, toPreprocessProgress(status.progress))
      await this.delay(DOCUMENT_POLL_INTERVAL_MS)
    }

    const result = await paddleOcrSdkService.getDocumentParsingResult({
      taskId: sourceId,
      providerTaskId: task.providerTaskId,
      token: this.provider.apiKey,
      baseUrl: this.provider.apiHost
    })

    const markdownText = result.result.markdown.trim()
    if (!markdownText) {
      throw new Error(`PaddleOCR returned empty markdown content for file ${filePath}`)
    }

    return markdownText
  }

  private async saveResults(markdownText: string, file: FileMetadata): Promise<string> {
    const outputDir = path.join(this.storageDir, file.id)

    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
    fs.mkdirSync(outputDir, { recursive: true })

    if (!markdownText.trim()) {
      throw new Error(`PaddleOCR returned empty markdown content for file [ID: ${file.id}]`)
    }

    const finalMdFileName = this.getMarkdownFileName(file)
    const finalMdPath = path.join(outputDir, finalMdFileName)

    fs.writeFileSync(finalMdPath, markdownText, 'utf-8')

    logger.info(`Saved markdown file: ${finalMdPath}`)
    return outputDir
  }
}
