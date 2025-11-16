import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { fileStorage } from '@main/services/FileStorage'
import type { FileMetadata, PreprocessProvider } from '@types'
import AdmZip from 'adm-zip'
import { net } from 'electron'

import BasePreprocessProvider from './BasePreprocessProvider'

const logger = loggerService.withContext('MineruPreprocessProvider')

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
  extract_progress?: ExtractProgress
}

type ExtractResultResponse = {
  batch_id: string
  extract_result: ExtractFileResult[]
}

type QuotaResponse = {
  code: number
  data: {
    user_left_quota: number
    total_left_quota: number
  }
  msg?: string
  trace_id?: string
}

export default class MineruPreprocessProvider extends BasePreprocessProvider {
  constructor(provider: PreprocessProvider, userId?: string) {
    super(provider, userId)
    // TODO: remove after free period ends
    this.provider.apiKey = this.provider.apiKey || import.meta.env.MAIN_VITE_MINERU_API_KEY
  }

  public async parseFile(
    sourceId: string,
    file: FileMetadata
  ): Promise<{ processedFile: FileMetadata; quota: number }> {
    try {
      const filePath = fileStorage.getFilePathById(file)
      logger.info(`MinerU preprocess processing started: ${filePath}`)
      await this.validateFile(filePath)

      // 1. Get upload URL and upload file
      const batchId = await this.uploadFile(file)
      logger.info(`MinerU file upload completed: batch_id=${batchId}`)

      // 2. Wait for completion and fetch results
      const extractResult = await this.waitForCompletion(sourceId, batchId, file.origin_name)
      logger.info(`MinerU processing completed for batch: ${batchId}`)

      // 3. Download and extract output
      const { path: outputPath } = await this.downloadAndExtractFile(extractResult.full_zip_url!, file)

      // 4. check quota
      const quota = await this.checkQuota()

      // 5. Create processed file metadata
      return {
        processedFile: this.createProcessedFileInfo(file, outputPath),
        quota
      }
    } catch (error: any) {
      logger.error(`MinerU preprocess processing failed for:`, error as Error)
      throw new Error(error.message)
    }
  }

  public async checkQuota() {
    try {
      const quota = await net.fetch(`${this.provider.apiHost}/api/v4/quota`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.provider.apiKey}`,
          token: this.userId ?? ''
        }
      })
      if (!quota.ok) {
        throw new Error(`HTTP ${quota.status}: ${quota.statusText}`)
      }
      const response: QuotaResponse = await quota.json()
      return response.data.user_left_quota
    } catch (error) {
      logger.error('Error checking quota:', error as Error)
      throw error
    }
  }

  private async validateFile(filePath: string): Promise<void> {
    // Phase 1: check file size (without loading into memory)
    logger.info(`Validating PDF file: ${filePath}`)
    const stats = await fs.promises.stat(filePath)
    const fileSizeBytes = stats.size

    // Ensure file size is under 200MB
    if (fileSizeBytes >= 200 * 1024 * 1024) {
      const fileSizeMB = Math.round(fileSizeBytes / (1024 * 1024))
      throw new Error(`PDF file size (${fileSizeMB}MB) exceeds the limit of 200MB`)
    }

    // Phase 2: check page count (requires reading file with error handling)
    const pdfBuffer = await fs.promises.readFile(filePath)

    try {
      const doc = await this.readPdf(pdfBuffer)

      // Ensure page count is under 600 pages
      if (doc.numPages >= 600) {
        throw new Error(`PDF page count (${doc.numPages}) exceeds the limit of 600 pages`)
      }

      logger.info(`PDF validation passed: ${doc.numPages} pages, ${Math.round(fileSizeBytes / (1024 * 1024))}MB`)
    } catch (error: any) {
      // If the page limit is exceeded, rethrow immediately
      if (error.message.includes('exceeds the limit')) {
        throw error
      }

      // If PDF parsing fails, log a detailed warning but continue processing
      logger.warn(
        `Failed to parse PDF structure (file may be corrupted or use non-standard format). ` +
          `Skipping page count validation. Will attempt to process with MinerU API. ` +
          `Error details: ${error.message}. ` +
          `Suggestion: If processing fails, try repairing the PDF using tools like Adobe Acrobat or online PDF repair services.`
      )
      // Do not throw; continue processing
    }
  }

  private createProcessedFileInfo(file: FileMetadata, outputPath: string): FileMetadata {
    // Locate the main extracted file
    let finalPath = ''
    let finalName = file.origin_name.replace('.pdf', '.md')

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
      ext: '.md',
      size: fs.existsSync(finalPath) ? fs.statSync(finalPath).size : 0
    }
  }

  private async downloadAndExtractFile(zipUrl: string, file: FileMetadata): Promise<{ path: string }> {
    const dirPath = this.storageDir

    const zipPath = path.join(dirPath, `${file.id}.zip`)
    const extractPath = path.join(dirPath, `${file.id}`)

    logger.info(`Downloading MinerU result to: ${zipPath}`)

    try {
      // Download the ZIP file
      const response = await net.fetch(zipUrl, { method: 'GET' })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      const arrayBuffer = await response.arrayBuffer()
      fs.writeFileSync(zipPath, Buffer.from(arrayBuffer))
      logger.info(`Downloaded ZIP file: ${zipPath}`)

      // Ensure the extraction directory exists
      if (!fs.existsSync(extractPath)) {
        fs.mkdirSync(extractPath, { recursive: true })
      }

      // Extract the ZIP contents
      const zip = new AdmZip(zipPath)
      zip.extractAllTo(extractPath, true)
      logger.info(`Extracted files to: ${extractPath}`)

      // Remove the temporary ZIP file
      fs.unlinkSync(zipPath)

      return { path: extractPath }
    } catch (error: any) {
      logger.error(`Failed to download and extract file: ${error.message}`)
      throw new Error(error.message)
    }
  }

  private async uploadFile(file: FileMetadata): Promise<string> {
    try {
      // Step 1: obtain the upload URL
      const { batchId, fileUrls, uploadHeaders } = await this.getBatchUploadUrls(file)
      // Step 2: upload the file to the obtained URL
      const filePath = fileStorage.getFilePathById(file)
      await this.putFileToUrl(filePath, fileUrls[0], file.origin_name, uploadHeaders?.[0])
      logger.info(`File uploaded successfully: ${filePath}`, { batchId, fileUrls })

      return batchId
    } catch (error: any) {
      logger.error(`Failed to upload file:`, error as Error)
      throw new Error(error.message)
    }
  }

  private async getBatchUploadUrls(
    file: FileMetadata
  ): Promise<{ batchId: string; fileUrls: string[]; uploadHeaders?: Record<string, string>[] }> {
    const endpoint = `${this.provider.apiHost}/api/v4/file-urls/batch`

    const payload = {
      language: 'auto',
      enable_formula: true,
      enable_table: true,
      files: [
        {
          name: file.origin_name,
          is_ocr: true,
          data_id: file.id
        }
      ]
    }

    try {
      const response = await net.fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.provider.apiKey}`,
          token: this.userId ?? '',
          Accept: '*/*'
        },
        body: JSON.stringify(payload)
      })

      if (response.ok) {
        const data: ApiResponse<BatchUploadResponse> = await response.json()
        if (data.code === 0 && data.data) {
          const { batch_id, file_urls, headers: uploadHeaders } = data.data
          return {
            batchId: batch_id,
            fileUrls: file_urls,
            uploadHeaders
          }
        } else {
          throw new Error(`API returned error: ${data.msg || JSON.stringify(data)}`)
        }
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
    } catch (error: any) {
      logger.error(`Failed to get batch upload URLs: ${error.message}`)
      throw new Error(error.message)
    }
  }

  private async putFileToUrl(
    filePath: string,
    uploadUrl: string,
    fileName?: string,
    headers?: Record<string, string>
  ): Promise<void> {
    try {
      const fileBuffer = await fs.promises.readFile(filePath)
      const fileSize = fileBuffer.byteLength
      const displayName = fileName ?? path.basename(filePath)

      logger.info(`Uploading file to MinerU OSS: ${displayName} (${fileSize} bytes)`)

      // https://mineru.net/apiManage/docs
      const response = await net.fetch(uploadUrl, {
        method: 'PUT',
        headers,
        body: new Uint8Array(fileBuffer)
      })

      if (!response.ok) {
        // Clone the response to avoid consuming the body stream
        const responseClone = response.clone()

        try {
          const responseBody = await responseClone.text()
          const errorInfo = {
            status: response.status,
            statusText: response.statusText,
            url: response.url,
            type: response.type,
            redirected: response.redirected,
            headers: Object.fromEntries(response.headers.entries()),
            body: responseBody
          }

          logger.error('Response details:', errorInfo)
          throw new Error(`Upload failed with status ${response.status}: ${responseBody}`)
        } catch (parseError) {
          throw new Error(`Upload failed with status ${response.status}. Could not parse response body.`)
        }
      }

      logger.info(`File uploaded successfully to: ${uploadUrl}`)
    } catch (error: any) {
      logger.error(`Failed to upload file to URL ${uploadUrl}: ${error}`)
      throw new Error(error.message)
    }
  }

  private async getExtractResults(batchId: string): Promise<ExtractResultResponse> {
    const endpoint = `${this.provider.apiHost}/api/v4/extract-results/batch/${batchId}`

    try {
      const response = await net.fetch(endpoint, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.provider.apiKey}`,
          token: this.userId ?? ''
        }
      })

      if (response.ok) {
        const data: ApiResponse<ExtractResultResponse> = await response.json()
        if (data.code === 0 && data.data) {
          return data.data
        } else {
          throw new Error(`API returned error: ${data.msg || JSON.stringify(data)}`)
        }
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
    } catch (error: any) {
      logger.error(`Failed to get extract results for batch ${batchId}: ${error.message}`)
      throw new Error(error.message)
    }
  }

  private async waitForCompletion(
    sourceId: string,
    batchId: string,
    fileName: string,
    maxRetries: number = 60,
    intervalMs: number = 5000
  ): Promise<ExtractFileResult> {
    let retries = 0

    while (retries < maxRetries) {
      try {
        const result = await this.getExtractResults(batchId)

        // Find the corresponding file result
        const fileResult = result.extract_result.find((item) => item.file_name === fileName)
        if (!fileResult) {
          throw new Error(`File ${fileName} not found in batch results`)
        }

        // Check the processing state
        if (fileResult.state === 'done' && fileResult.full_zip_url) {
          logger.info(`Processing completed for file: ${fileName}`)
          return fileResult
        } else if (fileResult.state === 'failed') {
          throw new Error(`Processing failed for file: ${fileName}, error: ${fileResult.err_msg}`)
        } else if (fileResult.state === 'running') {
          // Send progress updates
          if (fileResult.extract_progress) {
            const progress = Math.round(
              (fileResult.extract_progress.extracted_pages / fileResult.extract_progress.total_pages) * 100
            )
            await this.sendPreprocessProgress(sourceId, progress)
            logger.info(`File ${fileName} processing progress: ${progress}%`)
          } else {
            // If no detailed progress information is available, send a generic update
            await this.sendPreprocessProgress(sourceId, 50)
            logger.info(`File ${fileName} is still processing...`)
          }
        }
      } catch (error) {
        logger.warn(`Failed to check status for batch ${batchId}, retry ${retries + 1}/${maxRetries}`)
        if (retries === maxRetries - 1) {
          throw error
        }
      }

      retries++
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }

    throw new Error(`Processing timeout for batch: ${batchId}`)
  }

}
