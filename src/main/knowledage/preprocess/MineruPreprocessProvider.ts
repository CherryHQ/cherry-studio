import fs from 'node:fs'
import path from 'node:path'

import { FileMetadata, PreprocessProvider } from '@types'
import AdmZip from 'adm-zip'
import axios from 'axios'
import Logger from 'electron-log'

import BasePreprocessProvider from './BasePreprocessProvider'

type ApiResponse<T> = {
  code: number
  data: T
  msg?: string
  trace_id?: string
}

type BatchUploadResponse = {
  batch_id: string
  file_urls: string[]
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
    // todo：免费期结束后删除
    this.provider.apiKey = this.provider.apiKey || import.meta.env.MAIN_VITE_MINERU_API_KEY
  }

  public async parseFile(
    sourceId: string,
    file: FileMetadata
  ): Promise<{ processedFile: FileMetadata; quota: number }> {
    try {
      Logger.info(`MinerU preprocess processing started: ${file.path}`)
      await this.validateFile(file.path)

      // 1. 获取上传URL并上传文件
      const batchId = await this.uploadFile(file)
      Logger.info(`MinerU file upload completed: batch_id=${batchId}`)

      // 2. 等待处理完成并获取结果
      const extractResult = await this.waitForCompletion(sourceId, batchId, file.origin_name)
      Logger.info(`MinerU processing completed for batch: ${batchId}`)

      // 3. 下载并解压文件
      const { path: outputPath } = await this.downloadAndExtractFile(extractResult.full_zip_url!, file)

      // 4. check quota
      const quota = await this.checkQuota()

      // 5. 创建处理后的文件信息
      return {
        processedFile: this.createProcessedFileInfo(file, outputPath),
        quota
      }
    } catch (error: any) {
      Logger.error(`MinerU preprocess processing failed for ${file.path}: ${error.message}`)
      throw new Error(error.message)
    }
  }

  public async checkQuota() {
    try {
      const quota = await fetch(`${this.provider.apiHost}/api/v4/quota`, {
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
      console.error('Error checking quota:', error)
      throw error
    }
  }

  private async validateFile(filePath: string): Promise<void> {
    const pdfBuffer = await fs.promises.readFile(filePath)

    const doc = await this.readPdf(new Uint8Array(pdfBuffer))

    // 文件页数小于600页
    if (doc.numPages >= 600) {
      throw new Error(`PDF page count (${doc.numPages}) exceeds the limit of 600 pages`)
    }
    // 文件大小小于200MB
    if (pdfBuffer.length >= 200 * 1024 * 1024) {
      const fileSizeMB = Math.round(pdfBuffer.length / (1024 * 1024))
      throw new Error(`PDF file size (${fileSizeMB}MB) exceeds the limit of 200MB`)
    }
  }

  private createProcessedFileInfo(file: FileMetadata, outputPath: string): FileMetadata {
    // 查找解压后的主要文件
    let finalPath = ''
    let finalName = file.origin_name.replace('.pdf', '.md')

    try {
      const files = fs.readdirSync(outputPath)

      const mdFile = files.find((f) => f.endsWith('.md'))
      if (mdFile) {
        const originalMdPath = path.join(outputPath, mdFile)
        const newMdPath = path.join(outputPath, finalName)

        // 重命名文件为原始文件名
        try {
          fs.renameSync(originalMdPath, newMdPath)
          finalPath = newMdPath
          Logger.info(`Renamed markdown file from ${mdFile} to ${finalName}`)
        } catch (renameError) {
          Logger.warn(`Failed to rename file ${mdFile} to ${finalName}: ${renameError}`)
          // 如果重命名失败，使用原文件
          finalPath = originalMdPath
          finalName = mdFile
        }
      }
    } catch (error) {
      Logger.warn(`Failed to read output directory ${outputPath}: ${error}`)
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

    Logger.info(`Downloading MinerU result to: ${zipPath}`)

    try {
      // 下载ZIP文件
      const response = await axios.get(zipUrl, { responseType: 'arraybuffer' })
      fs.writeFileSync(zipPath, response.data)
      Logger.info(`Downloaded ZIP file: ${zipPath}`)

      // 确保提取目录存在
      if (!fs.existsSync(extractPath)) {
        fs.mkdirSync(extractPath, { recursive: true })
      }

      // 解压文件
      const zip = new AdmZip(zipPath)
      zip.extractAllTo(extractPath, true)
      Logger.info(`Extracted files to: ${extractPath}`)

      // 删除临时ZIP文件
      fs.unlinkSync(zipPath)

      return { path: extractPath }
    } catch (error: any) {
      Logger.error(`Failed to download and extract file: ${error.message}`)
      throw new Error(error.message)
    }
  }

  private async uploadFile(file: FileMetadata): Promise<string> {
    try {
      // 步骤1: 获取上传URL
      const { batchId, fileUrls } = await this.getBatchUploadUrls(file)
      Logger.info(`Got upload URLs for batch: ${batchId}`)

      console.log('batchId:', batchId, 'fileurls:', fileUrls)
      // 步骤2: 上传文件到获取的URL
      await this.putFileToUrl(file.path, fileUrls[0])
      Logger.info(`File uploaded successfully: ${file.path}`)

      return batchId
    } catch (error: any) {
      Logger.error(`Failed to upload file ${file.path}: ${error.message}`)
      throw new Error(error.message)
    }
  }

  private async getBatchUploadUrls(file: FileMetadata): Promise<{ batchId: string; fileUrls: string[] }> {
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
      const response = await fetch(endpoint, {
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
          const { batch_id, file_urls } = data.data
          return {
            batchId: batch_id,
            fileUrls: file_urls
          }
        } else {
          throw new Error(`API returned error: ${data.msg || JSON.stringify(data)}`)
        }
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
    } catch (error: any) {
      Logger.error(`Failed to get batch upload URLs: ${error.message}`)
      throw new Error(error.message)
    }
  }

  private async putFileToUrl(filePath: string, uploadUrl: string): Promise<void> {
    try {
      const fileBuffer = await fs.promises.readFile(filePath)

      const response = await fetch(uploadUrl, {
        method: 'PUT',
        body: fileBuffer,
        headers: {
          'Content-Type': 'application/pdf'
        }
        // headers: {
        //   'Content-Length': fileBuffer.length.toString()
        // }
      })

      if (!response.ok) {
        // 克隆 response 以避免消费 body stream
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

          console.error('Response details:', errorInfo)
          throw new Error(`Upload failed with status ${response.status}: ${responseBody}`)
        } catch (parseError) {
          throw new Error(`Upload failed with status ${response.status}. Could not parse response body.`)
        }
      }

      Logger.info(`File uploaded successfully to: ${uploadUrl}`)
    } catch (error: any) {
      Logger.error(`Failed to upload file to URL ${uploadUrl}: ${error}`)
      throw new Error(error.message)
    }
  }

  private async getExtractResults(batchId: string): Promise<ExtractResultResponse> {
    const endpoint = `${this.provider.apiHost}/api/v4/extract-results/batch/${batchId}`

    try {
      const response = await fetch(endpoint, {
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
      Logger.error(`Failed to get extract results for batch ${batchId}: ${error.message}`)
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

        // 查找对应文件的处理结果
        const fileResult = result.extract_result.find((item) => item.file_name === fileName)
        if (!fileResult) {
          throw new Error(`File ${fileName} not found in batch results`)
        }

        // 检查处理状态
        if (fileResult.state === 'done' && fileResult.full_zip_url) {
          Logger.info(`Processing completed for file: ${fileName}`)
          return fileResult
        } else if (fileResult.state === 'failed') {
          throw new Error(`Processing failed for file: ${fileName}, error: ${fileResult.err_msg}`)
        } else if (fileResult.state === 'running') {
          // 发送进度更新
          if (fileResult.extract_progress) {
            const progress = Math.round(
              (fileResult.extract_progress.extracted_pages / fileResult.extract_progress.total_pages) * 100
            )
            await this.sendPreprocessProgress(sourceId, progress)
            Logger.info(`File ${fileName} processing progress: ${progress}%`)
          } else {
            // 如果没有具体进度信息，发送一个通用进度
            await this.sendPreprocessProgress(sourceId, 50)
            Logger.info(`File ${fileName} is still processing...`)
          }
        }
      } catch (error) {
        Logger.warn(`Failed to check status for batch ${batchId}, retry ${retries + 1}/${maxRetries}`)
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
