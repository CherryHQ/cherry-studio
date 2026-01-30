import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { fileStorage } from '@main/services/FileStorage'
import { getFileType } from '@main/utils/file'
import { MB } from '@shared/config/constant'
import type { FileMetadata, PreprocessProvider, PreprocessReadPdfResult } from '@types'
import { net } from 'electron'
import * as z from 'zod'

import BasePreprocessProvider from './BasePreprocessProvider'

const logger = loggerService.withContext('PaddleocrPreprocessProvider')

/**
 * 单个文件大小不超过50MB，为避免处理超时，建议每个文件不超过100页。若超过100页，API只解析前100页，后续页将被忽略。
 * 来源：PaddleOCR 官方 API 调用说明 https://aistudio.baidu.com/paddleocr
 */
export const PDF_SIZE_LIMIT_MB = 50
export const PDF_PAGE_LIMIT = 100
export const PDF_SIZE_LIMIT_BYTES = PDF_SIZE_LIMIT_MB * MB

enum FileType {
  PDF = 0,
  Image = 1
}

const ApiResponseSchema = z.looseObject({
  result: z
    .looseObject({
      layoutParsingResults: z
        .array(
          z.looseObject({
            markdown: z.looseObject({
              text: z.string().min(1, 'Markdown text cannot be empty')
            })
          })
        )
        .min(1, 'At least one layout parsing result required')
    })
    .optional(),
  errorCode: z.number().optional(),
  errorMsg: z.string().optional()
})

type ApiResponse = z.infer<typeof ApiResponseSchema>

const isApiSuccess = (response: ApiResponse): boolean => {
  const hasNoError = !response.errorCode || response.errorCode === 0
  const hasSuccessMsg = !response.errorMsg || /success/i.test(response.errorMsg)
  return hasNoError && hasSuccessMsg
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.')
      const code = issue.code
      const message = issue.message
      return `[${code}] ${path}: ${message}`
    })
    .join('; ')
}

function getErrorMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return formatZodError(error)
  } else if (error instanceof Error) {
    return error.message
  } else if (typeof error === 'string') {
    return error
  } else {
    return 'Unknown error'
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

      const fileBuffer = await this.validateFile(filePath)

      // 进度条
      await this.sendPreprocessProgress(sourceId, 25)

      // 1.读取pdf文件并编码为base64
      const fileData = fileBuffer.toString('base64')
      await this.sendPreprocessProgress(sourceId, 50)

      // 2. 调用PadlleOCR文档处理API
      const apiResponse = await this.callPaddleOcrApi(fileData, FileType.PDF)
      logger.info(`PaddleOCR API call completed`)

      await this.sendPreprocessProgress(sourceId, 75)

      // 3. 处理 API 错误场景
      if (!isApiSuccess(apiResponse)) {
        const errorCode = apiResponse.errorCode ?? -1
        const errorMsg = apiResponse.errorMsg || 'Unknown error'
        const fullErrorMsg = `PaddleOCR API processing failed [${errorCode}]: ${errorMsg}`
        logger.error(fullErrorMsg)
        throw new Error(fullErrorMsg)
      }

      // 4. 保存markdown文本
      const outputDir = await this.saveResults(apiResponse.result, file)

      await this.sendPreprocessProgress(sourceId, 100)

      const processedFile = await this.createProcessedFileInfo(file, outputDir)

      // 5. 创建处理后数据
      return {
        processedFile,
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

  private getMarkdownFileName(file: FileMetadata): string {
    return file.origin_name.replace(/\.(pdf|jpg|jpeg|png)$/i, '.md')
  }

  private async validateFile(filePath: string): Promise<Buffer> {
    // 阶段1：校验文件类型
    logger.info(`Validating PDF file: ${filePath}`)
    const ext = path.extname(filePath).toLowerCase()
    if (ext !== '.pdf') {
      throw new Error(`File ${filePath} is not a PDF (extension: ${ext.slice(1)})`)
    }

    // 阶段2：校验文件大小
    const stats = await fs.promises.stat(filePath)
    const fileSizeBytes = stats.size
    if (fileSizeBytes > PDF_SIZE_LIMIT_BYTES) {
      const fileSizeMB = Math.round(fileSizeBytes / MB)
      throw new Error(`PDF file size (${fileSizeMB}MB) exceeds the limit of ${PDF_SIZE_LIMIT_MB}MB`)
    }

    // 阶段3：校验页数（兼容 PDF 解析失败的场景）
    const pdfBuffer = await fs.promises.readFile(filePath)
    let doc: PreprocessReadPdfResult | undefined

    try {
      doc = await this.readPdf(pdfBuffer)
    } catch (error: unknown) {
      // PDF 解析失败：抛异常，跳过页数校验
      const errorMsg = getErrorMessage(error)
      logger.error(
        `Failed to parse PDF structure (file may be corrupted or use non-standard format). ` +
          `Skipping page count validation. Will attempt to process with PaddleOCR API. ` +
          `Error details: ${errorMsg}. ` +
          `Suggestion: If processing fails, try repairing the PDF using tools like Adobe Acrobat or online PDF repair services.`
      )
      throw error
    }

    if (doc?.numPages > PDF_PAGE_LIMIT) {
      throw new Error(`PDF page count (${doc.numPages}) exceeds the limit of ${PDF_PAGE_LIMIT} pages`)
    }

    logger.info(`PDF validation passed: ${doc.numPages} pages, ${Math.round(fileSizeBytes / MB)}MB`)

    return pdfBuffer
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

  private async callPaddleOcrApi(fileData: string, fileType: number): Promise<ApiResponse> {
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
          'Client-Platform': 'cherry-studio',
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
      logger.debug('PaddleOCR API response', { data: rawData })

      // Zod 校验响应结构（不合法则直接抛错）
      const validatedData = ApiResponseSchema.parse(rawData)
      return validatedData // 返回完整响应
    } catch (error: unknown) {
      const errorMsg = getErrorMessage(error)
      logger.error(`Failed to call PaddleOCR API: ${errorMsg}`, { error })
      throw new Error(`Failed to call PaddleOCR API: ${errorMsg}`)
    }
  }

  private async saveResults(result: ApiResponse['result'], file: FileMetadata): Promise<string> {
    const outputDir = path.join(this.storageDir, file.id)

    // 确保输出目录存在且为空
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
    fs.mkdirSync(outputDir, { recursive: true })

    // 处理 result 为 undefined 的场景（API 无解析结果）
    if (!result) {
      const errorMsg = `Parsing failed: No valid parsing result from PaddleOCR API for file [ID: ${file.id}]`
      // Keep warning log for troubleshooting
      logger.error(errorMsg)
      // Throw exception to interrupt function execution (no empty file created)
      throw new Error(errorMsg)
    }

    // Zod 保证：result 存在时，layoutParsingResults 必是非空数组
    const markdownText = result.layoutParsingResults
      .filter((layoutResult) => layoutResult?.markdown?.text)
      .map((layoutResult) => layoutResult.markdown.text)
      .join('\n\n')

    // 直接构造目标文件名
    const finalMdFileName = this.getMarkdownFileName(file)
    const finalMdPath = path.join(outputDir, finalMdFileName)

    // 保存 Markdown 文件
    fs.writeFileSync(finalMdPath, markdownText, 'utf-8')

    logger.info(`Saved markdown file: ${finalMdPath}`)
    return outputDir
  }
}
