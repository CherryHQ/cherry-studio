import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { fileStorage } from '@main/services/FileStorage'
import { FileMetadata, PreprocessProvider } from '@types'
import AdmZip from 'adm-zip'
import axios, { AxiosRequestConfig } from 'axios'

import BasePreprocessProvider from './BasePreprocessProvider'

const logger = loggerService.withContext('Doc2xPreprocessProvider')

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

export default class Doc2xPreprocessProvider extends BasePreprocessProvider {
  constructor(provider: PreprocessProvider) {
    super(provider)
  }

  private async validateFile(filePath: string): Promise<void> {
    const pdfBuffer = await fs.promises.readFile(filePath)

    const doc = await this.readPdf(pdfBuffer)

    // 文件页数小于1000页
    if (doc.numPages >= 1000) {
      throw new Error(`PDF page count (${doc.numPages}) exceeds the limit of 1000 pages`)
    }
    // 文件大小小于300MB
    if (pdfBuffer.length >= 300 * 1024 * 1024) {
      const fileSizeMB = Math.round(pdfBuffer.length / (1024 * 1024))
      throw new Error(`PDF file size (${fileSizeMB}MB) exceeds the limit of 300MB`)
    }
  }

  public async parseFile(sourceId: string, file: FileMetadata): Promise<{ processedFile: FileMetadata }> {
    try {
      const filePath = fileStorage.getFilePathById(file)
      logger.info(`Preprocess processing started: ${filePath}`)

      // 步骤1: 准备上传
      const { uid, url } = await this.preupload()
      logger.info(`Preprocess preupload completed: uid=${uid}`)

      await this.validateFile(filePath)

      // 步骤2: 上传文件
      await this.putFile(filePath, url)

      // 步骤3: 等待处理完成
      await this.waitForProcessing(sourceId, uid)
      logger.info(`Preprocess parsing completed successfully for: ${filePath}`)

      // 步骤4: 导出文件
      const { path: outputPath } = await this.exportFile(file, uid)

      // 步骤5: 创建处理后的文件信息
      return {
        processedFile: this.createProcessedFileInfo(file, outputPath)
      }
    } catch (error) {
      logger.error(`Preprocess processing failed for:`, error as Error)
      throw error
    }
  }

  private createProcessedFileInfo(file: FileMetadata, outputPath: string): FileMetadata {
    const outputFilePath = `${outputPath}/${file.name.split('.').slice(0, -1).join('.')}.md`
    return {
      ...file,
      name: file.name.replace('.pdf', '.md'),
      path: outputFilePath,
      ext: '.md',
      size: fs.statSync(outputFilePath).size
    }
  }

  /**
   * 导出文件
   * @param file 文件信息
   * @param uid 预上传响应的uid
   * @returns 导出文件的路径
   */
  public async exportFile(file: FileMetadata, uid: string): Promise<{ path: string }> {
    const filePath = fileStorage.getFilePathById(file)
    logger.info(`Exporting file: ${filePath}`)

    // 步骤1: 转换文件
    await this.convertFile(uid, filePath)
    logger.info(`File conversion completed for: ${filePath}`)

    // 步骤2: 等待导出并获取URL
    const exportUrl = await this.waitForExport(uid)

    // 步骤3: 下载并解压文件
    return this.downloadFile(exportUrl, file)
  }

  /**
   * 等待处理完成
   * @param sourceId 源文件ID
   * @param uid 预上传响应的uid
   */
  private async waitForProcessing(sourceId: string, uid: string): Promise<void> {
    while (true) {
      await this.delay(1000)
      const { status, progress } = await this.getStatus(uid)
      await this.sendPreprocessProgress(sourceId, progress)
      logger.info(`Preprocess processing status: ${status}, progress: ${progress}%`)

      if (status === 'success') {
        return
      } else if (status === 'failed') {
        throw new Error('Preprocess processing failed')
      }
    }
  }

  /**
   * 等待导出完成
   * @param uid 预上传响应的uid
   * @returns 导出文件的url
   */
  private async waitForExport(uid: string): Promise<string> {
    while (true) {
      await this.delay(1000)
      const { status, url } = await this.getParsedFile(uid)
      logger.info(`Export status: ${status}`)

      if (status === 'success' && url) {
        return url
      } else if (status === 'failed') {
        throw new Error('Export failed')
      }
    }
  }

  /**
   * 预上传文件
   * @returns 预上传响应的url和uid
   */
  private async preupload(): Promise<PreuploadResponse> {
    const config = this.createAuthConfig()
    const endpoint = `${this.provider.apiHost}/api/v2/parse/preupload`

    try {
      const { data } = await axios.post<ApiResponse<PreuploadResponse>>(endpoint, null, config)

      if (data.code === 'success' && data.data) {
        return data.data
      } else {
        throw new Error(`API returned error: ${data.message || JSON.stringify(data)}`)
      }
    } catch (error) {
      logger.error(`Failed to get preupload URL: ${error instanceof Error ? error.message : String(error)}`)
      throw new Error('Failed to get preupload URL')
    }
  }

  /**
   * 上传文件
   * @param filePath 文件路径
   * @param url 预上传响应的url
   */
  private async putFile(filePath: string, url: string): Promise<void> {
    try {
      const fileStream = fs.createReadStream(filePath)
      const response = await axios.put(url, fileStream)

      if (response.status !== 200) {
        throw new Error(`HTTP status ${response.status}: ${response.statusText}`)
      }
    } catch (error) {
      logger.error(`Failed to upload file ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
      throw new Error('Failed to upload file')
    }
  }

  private async getStatus(uid: string): Promise<StatusResponse> {
    const config = this.createAuthConfig()
    const endpoint = `${this.provider.apiHost}/api/v2/parse/status?uid=${uid}`

    try {
      const response = await axios.get<ApiResponse<StatusResponse>>(endpoint, config)

      if (response.data.code === 'success' && response.data.data) {
        return response.data.data
      } else {
        throw new Error(`API returned error: ${response.data.message || JSON.stringify(response.data)}`)
      }
    } catch (error) {
      logger.error(`Failed to get status for uid ${uid}: ${error instanceof Error ? error.message : String(error)}`)
      throw new Error('Failed to get processing status')
    }
  }

  /**
   * Preprocess文件
   * @param uid 预上传响应的uid
   * @param filePath 文件路径
   */
  private async convertFile(uid: string, filePath: string): Promise<void> {
    const fileName = path.parse(filePath).name
    const config = {
      ...this.createAuthConfig(),
      headers: {
        ...this.createAuthConfig().headers,
        'Content-Type': 'application/json'
      }
    }

    const payload = {
      uid,
      to: 'md',
      formula_mode: 'normal',
      filename: fileName
    }

    const endpoint = `${this.provider.apiHost}/api/v2/convert/parse`

    try {
      const response = await axios.post<ApiResponse<any>>(endpoint, payload, config)

      if (response.data.code !== 'success') {
        throw new Error(`API returned error: ${response.data.message || JSON.stringify(response.data)}`)
      }
    } catch (error) {
      logger.error(`Failed to convert file ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
      throw new Error('Failed to convert file')
    }
  }

  /**
   * 获取解析后的文件信息
   * @param uid 预上传响应的uid
   * @returns 解析后的文件信息
   */
  private async getParsedFile(uid: string): Promise<ParsedFileResponse> {
    const config = this.createAuthConfig()
    const endpoint = `${this.provider.apiHost}/api/v2/convert/parse/result?uid=${uid}`

    try {
      const response = await axios.get<ApiResponse<ParsedFileResponse>>(endpoint, config)

      if (response.status === 200 && response.data.data) {
        return response.data.data
      } else {
        throw new Error(`HTTP status ${response.status}: ${response.statusText}`)
      }
    } catch (error) {
      logger.error(
        `Failed to get parsed file for uid ${uid}: ${error instanceof Error ? error.message : String(error)}`
      )
      throw new Error('Failed to get parsed file information')
    }
  }

  /**
   * 下载文件
   * @param url 导出文件的url
   * @param file 文件信息
   * @returns 下载文件的路径
   */
  private async downloadFile(url: string, file: FileMetadata): Promise<{ path: string }> {
    const dirPath = this.storageDir
    // 使用统一的存储路径：Data/Files/{file.id}/
    const extractPath = path.join(dirPath, file.id)
    const zipPath = path.join(dirPath, `${file.id}.zip`)

    // 确保目录存在
    fs.mkdirSync(dirPath, { recursive: true })
    fs.mkdirSync(extractPath, { recursive: true })

    logger.info(`Downloading to export path: ${zipPath}`)

    try {
      // 下载文件
      const response = await axios.get(url, { responseType: 'arraybuffer' })
      fs.writeFileSync(zipPath, response.data)

      // 确保提取目录存在
      if (!fs.existsSync(extractPath)) {
        fs.mkdirSync(extractPath, { recursive: true })
      }

      // 解压文件
      const zip = new AdmZip(zipPath)
      zip.extractAllTo(extractPath, true)
      logger.info(`Extracted files to: ${extractPath}`)

      // 删除临时ZIP文件
      fs.unlinkSync(zipPath)

      return { path: extractPath }
    } catch (error) {
      logger.error(`Failed to download and extract file: ${error instanceof Error ? error.message : String(error)}`)
      throw new Error('Failed to download and extract file')
    }
  }

  private createAuthConfig(): AxiosRequestConfig {
    return {
      headers: {
        Authorization: `Bearer ${this.provider.apiKey}`
      }
    }
  }

  public checkQuota(): Promise<number> {
    throw new Error('Method not implemented.')
  }
}
