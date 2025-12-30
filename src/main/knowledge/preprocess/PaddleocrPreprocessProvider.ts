import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { fileStorage } from '@main/services/FileStorage'
import type { FileMetadata, PreprocessProvider } from '@types'
import { net } from 'electron'
import { MB } from '@shared/config/constant'
import { t } from 'i18next'
import { FileTypes } from '@types'

import BasePreprocessProvider from './BasePreprocessProvider'

const logger = loggerService.withContext('PaddleocrPreprocessProvider')

export const PDF_SIZE_LIMIT_MB = 50
export const PDF_PAGE_LIMIT = 100
export const PDF_SIZE_LIMIT_BYTES = PDF_SIZE_LIMIT_MB * MB

enum FileType {
  PDF = 0,
  Image = 1
}

type ApiResponse = {
  result: {
    layoutParsingResults: Array<{
      markdown: {
        text: string
        images: Record<string, string>
      }
      // outputImages: Record<string, string>
    }>
  }
  errorCode?: number
  errorMsg?: string
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  } else {
    return t('error.unknown')
  }
}

export default class PaddleocrPreprocessProvider extends BasePreprocessProvider {
  constructor(provider: PreprocessProvider, userId?: string) {
    super(provider, userId)
  }

  public async parseFile(
    sourceId: string,
    file: FileMetadata
  ): Promise<{ processedFile: FileMetadata; quota: number }> {
    try {
      const filePath = fileStorage.getFilePathById(file)
      logger.info(`PaddleOCR preprocess processing started: ${filePath}`)

      await this.validateFile(filePath)

      // Send progress update
      await this.sendPreprocessProgress(sourceId, 25)

      // 1. Read file and encode to base64
      const fileBuffer = await fs.promises.readFile(filePath)
      const fileData = fileBuffer.toString('base64')
      await this.sendPreprocessProgress(sourceId, 50)

      // 2. Call PaddleOCR API
      const result = await this.callPaddleOcrApi(fileData, FileType.PDF)
      logger.info(`PaddleOCR API call completed`)

      await this.sendPreprocessProgress(sourceId, 75)

      // 3. Save markdown
      const outputPath = await this.saveResults(result, file)

      await this.sendPreprocessProgress(sourceId, 100)

      // 4. Create processed file metadata
      return {
        processedFile: this.createProcessedFileInfo(file, outputPath),
        quota: 0
      }
    } catch (error: unknown) {
      logger.error(`PaddleOCR preprocess processing failed for:`, error as Error)
      throw new Error(getErrorMessage(error))
    }
  }

  public async checkQuota(): Promise<number> {
    // PaddleOCR doesn't have quota checking, return 0
    return 0
  }

  private async validateFile(filePath: string): Promise<void> {
    // Phase 1: check file size (without loading into memory)
    logger.info(`Validating PDF file: ${filePath}`)
    const ext = path.extname(filePath).toLowerCase()
    if (ext !== '.pdf') {
      throw new Error(`File ${filePath} is not a PDF (extension: ${ext.slice(1)})`)
    }

    const stats = await fs.promises.stat(filePath)
    const fileSizeBytes = stats.size

    // Ensure file size is no more than PDF_SIZE_LIMIT_MB MB
    if (fileSizeBytes > PDF_SIZE_LIMIT_BYTES) {
      const fileSizeMB = Math.round(fileSizeBytes / MB)
      throw new Error(`PDF file size (${fileSizeMB}MB) exceeds the limit of ${PDF_SIZE_LIMIT_MB}MB`)
    }

    // Phase 2: check page count (requires reading file with error handling)
    const pdfBuffer = await fs.promises.readFile(filePath)

    try {
      const doc = await this.readPdf(pdfBuffer)

      // Ensure page count is no more than PDF_PAGE_LIMIT pages
      if (doc.numPages > PDF_PAGE_LIMIT) {
        throw new Error(`PDF page count (${doc.numPages}) exceeds the limit of ${PDF_PAGE_LIMIT} pages`)
      }

      logger.info(`PDF validation passed: ${doc.numPages} pages, ${Math.round(fileSizeBytes / MB)}MB`)
    } catch (error: unknown) {
      // If the page limit is exceeded, rethrow immediately
      if (getErrorMessage(error).includes('exceeds the limit')) {
        throw error
      }

      // If PDF parsing fails, log a detailed warning but continue processing
      logger.warn(
        `Failed to parse PDF structure (file may be corrupted or use non-standard format). ` +
          `Skipping page count validation. Will attempt to process with PaddleOCR API. ` +
          `Error details: ${getErrorMessage(error)}. ` +
          `Suggestion: If processing fails, try repairing the PDF using tools like Adobe Acrobat or online PDF repair services.`
      )
      // Do not throw; continue processing
    }
  }

  private createProcessedFileInfo(file: FileMetadata, outputPath: string): FileMetadata {
    // Locate the main extracted file
    let finalPath = ''
    let finalName = file.origin_name.replace(/\.(pdf|jpg|jpeg|png)$/i, '.md')

    try {
      const files = fs.readdirSync(outputPath)

      const mdFile = files.find((f) => f.endsWith('.md'))
      if (mdFile) {
        const originalMdPath = path.join(outputPath, mdFile)
        const newMdPath = path.join(outputPath, finalName)

        // Rename the file to match the original name
        try {
          fs.renameSync(originalMdPath, newMdPath)
          finalPath = newMdPath
          logger.info(`Renamed markdown file from ${mdFile} to ${finalName}`)
        } catch (renameError) {
          logger.warn(`Failed to rename file ${mdFile} to ${finalName}: ${renameError}`)
          // If renaming fails, fall back to the original file
          finalPath = originalMdPath
          finalName = mdFile
        }
      }
    } catch (error) {
      logger.warn(`Failed to read output directory ${outputPath}: ${error}`)
      finalPath = path.join(outputPath, `${file.id}.md`)
    }

    return {
      ...file,
      name: finalName,
      path: finalPath,
      type: FileTypes.DOCUMENT,
      ext: '.md',
      size: fs.existsSync(finalPath) ? fs.statSync(finalPath).size : 0
    }
  }

  private async callPaddleOcrApi(fileData: string, fileType: number): Promise<ApiResponse['result']> {
    if (!this.provider.apiHost) {
      throw new Error('PaddleOCR API host is not configured')
    }

    const endpoint = this.provider.apiHost

    const payload = {
      file: fileData,
      fileType: fileType,
      useDocOrientationClassify: false,
      useDocUnwarping: false,
      useTextlineOrientation: false,
      useChartRecognition: false
    }

    try {
      const response = await net.fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `token ${this.provider.apiKey}`
        },
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error(`PaddleOCR API error: HTTP ${response.status} - ${errorText}`)
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data: ApiResponse = await response.json()

      // Log the response for debugging
      logger.debug('PaddleOCR API response', { data })

      // Check for actual errors: errorCode should be non-zero, or errorMsg should indicate failure (not "Success")
      if (data.errorCode && data.errorCode !== 0) {
        throw new Error(`PaddleOCR API error: ${data.errorMsg || `Error code: ${data.errorCode}`}`)
      }

      // If errorMsg exists and is not a success message, treat as error
      if (data.errorMsg && !/success/i.test(data.errorMsg)) {
        throw new Error(`PaddleOCR API error: ${data.errorMsg}`)
      }

      if (!data.result || !data.result.layoutParsingResults || data.result.layoutParsingResults.length === 0) {
        throw new Error('PaddleOCR API returned empty results')
      }

      return data.result
    } catch (error: unknown) {
      logger.error(`Failed to call PaddleOCR API: ${getErrorMessage(error)}`)
      throw new Error(getErrorMessage(error))
    }
  }

  private async saveResults(result: ApiResponse['result'], file: FileMetadata): Promise<string> {
    const outputDir = path.join(this.storageDir, file.id)

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    if (!result.layoutParsingResults || result.layoutParsingResults.length === 0) {
      throw new Error('No layout parsing result found')
    }

    const markdownText = result.layoutParsingResults
      .filter((layoutResult) => layoutResult?.markdown?.text)
      .map((layoutResult) => layoutResult.markdown.text)
      .join('\n\n')

    // Save markdown text
    const mdFileName = `${file.id}.md`
    const mdFilePath = path.join(outputDir, mdFileName)

    // Write markdown file
    fs.writeFileSync(mdFilePath, markdownText, 'utf-8')
    logger.info(`Saved markdown file: ${mdFilePath}`)

    return outputDir
  }
}
