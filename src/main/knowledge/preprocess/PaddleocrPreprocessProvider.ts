import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { fileStorage } from '@main/services/FileStorage'
import { getFileType } from '@main/utils/file'
import { MB } from '@shared/config/constant'
import type { FileMetadata, PreprocessProvider } from '@types'
import { net } from 'electron'
import { t } from 'i18next'
import { z } from 'zod'

import BasePreprocessProvider from './BasePreprocessProvider'

const logger = loggerService.withContext('PaddleocrPreprocessProvider')

export const PDF_SIZE_LIMIT_MB = 50
export const PDF_PAGE_LIMIT = 100
export const PDF_SIZE_LIMIT_BYTES = PDF_SIZE_LIMIT_MB * MB

enum FileType {
  PDF = 0,
  Image = 1
}

// Zod schemas for validation
const FileValidationSchema = z.object({
  path: z.string(),
  ext: z.string().refine((ext) => ext.toLowerCase() === '.pdf', {
    message: 'File must be a PDF'
  }),
  size: z.number().max(PDF_SIZE_LIMIT_BYTES, {
    message: `PDF file size exceeds the limit of ${PDF_SIZE_LIMIT_MB}MB`
  }),
  pages: z.number().max(PDF_PAGE_LIMIT, {
    message: `PDF page count exceeds the limit of ${PDF_PAGE_LIMIT} pages`
  })
})

const ApiResponseSchema = z
  .object({
    result: z.object({
      layoutParsingResults: z
        .array(
          z.object({
            markdown: z.object({
              text: z.string().min(1, 'Markdown text cannot be empty')
            })
          })
        )
        .min(1, 'At least one layout parsing result required')
    }),
    errorCode: z.number().optional(),
    errorMsg: z.string().optional()
  })
  .refine(
    (data) => {
      // Check for actual errors: errorCode should be non-zero, or errorMsg should indicate failure (not "Success")
      if (data.errorCode && data.errorCode !== 0) {
        return false
      }
      if (data.errorMsg && !/success/i.test(data.errorMsg)) {
        return false
      }
      return true
    },
    {
      message: 'PaddleOCR API returned an error',
      path: ['errorCode', 'errorMsg']
    }
  )

const ProcessingResultSchema = z.object({
  layoutParsingResults: z
    .array(
      z.object({
        markdown: z.object({
          text: z.string().min(1, 'Markdown text cannot be empty')
        })
      })
    )
    .min(1, 'At least one layout parsing result required')
})

type ApiResponse = z.infer<typeof ApiResponseSchema>

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

  /**
   * 解析文件并通过 PaddleOCR 进行预处理（当前仅支持 PDF 文件）
   * @param sourceId - 源任务ID，用于进度更新/日志追踪
   * @param file - 待处理的文件元数据（仅支持 ext 为 .pdf 的文件）
   * @returns {Promise<{processedFile: FileMetadata; quota: number}>} 处理后的文件元数据 + 配额消耗（当前 PaddleOCR 配额为 0）
   * @throws {Error} 若传入非 PDF 文件、文件大小超限、页数超限等会抛出异常
   */
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
    logger.info(`Validating PDF file: ${filePath}`)

    const ext = path.extname(filePath).toLowerCase()
    const stats = await fs.promises.stat(filePath)
    const fileSizeBytes = stats.size

    // Try to get page count, but don't fail validation if PDF parsing fails
    let pageCount = 0
    try {
      const pdfBuffer = await fs.promises.readFile(filePath)
      const doc = await this.readPdf(pdfBuffer)
      pageCount = doc.numPages
    } catch (error: unknown) {
      // If PDF parsing fails, log a detailed warning but continue processing
      logger.warn(
        `Failed to parse PDF structure (file may be corrupted or use non-standard format). ` +
          `Skipping page count validation. Will attempt to process with PaddleOCR API. ` +
          `Error details: ${getErrorMessage(error)}. ` +
          `Suggestion: If processing fails, try repairing the PDF using tools like Adobe Acrobat or online PDF repair services.`
      )
    }

    // Validate using zod schema
    const validationData = {
      path: filePath,
      ext: ext,
      size: fileSizeBytes,
      pages: pageCount
    }

    try {
      FileValidationSchema.parse(validationData)
      logger.info(`PDF validation passed: ${pageCount} pages, ${Math.round(fileSizeBytes / MB)}MB`)
    } catch (error) {
      if (error instanceof z.ZodError) {
        // For size and page limit errors, throw immediately
        const errorMessages = error.issues.map((e) => e.message)
        if (errorMessages.some((msg) => msg.includes('exceeds the limit'))) {
          throw new Error(errorMessages.find((msg) => msg.includes('exceeds the limit')) || errorMessages[0])
        }
        // For other validation errors (like non-PDF files), throw
        throw new Error(errorMessages[0])
      }
      throw error
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

    if (!fs.existsSync(finalPath)) {
      const errorMsg = `Final processed file does not exist at path: ${finalPath}`
      logger.error(errorMsg)
      throw new Error(errorMsg)
    }

    const ext = path.extname(finalPath)
    const type = getFileType(ext)
    const fileSize = fs.statSync(finalPath).size

    return {
      ...file,
      name: finalName,
      path: finalPath,
      type: type,
      ext: ext,
      size: fileSize
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

      const rawData = await response.json()

      // Log the response for debugging
      logger.debug('PaddleOCR API response', { data: rawData })

      // Validate response using zod schema
      const data = ApiResponseSchema.parse(rawData)

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

    // Validate result using zod schema
    ProcessingResultSchema.parse(result)

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
