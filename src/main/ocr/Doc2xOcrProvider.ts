import fs from 'node:fs'
import path from 'node:path'

import { FileType, KnowledgeBaseParams } from '@types'
import AdmZip from 'adm-zip'
import axios, { AxiosRequestConfig } from 'axios'
import Logger from 'electron-log'

import BaseOcrProvider from './BaseOcrProvider'

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

export default class Doc2xOcrProvider extends BaseOcrProvider {
  constructor(base: KnowledgeBaseParams) {
    super(base)
  }

  public async parseFile(sourceId: string, file: FileType): Promise<{ processedFile: FileType }> {
    try {
      Logger.info(`OCR processing started: ${file.path}`)

      const pdfInfo = await this.getPdfInfo(file.path)

      // 文件页数小于1000页
      if (pdfInfo.pageCount >= 1000) {
        throw new Error(`PDF page count (${pdfInfo.pageCount}) exceeds the limit of 1000 pages`)
      }
      // 文件大小小于300MB
      if (pdfInfo.fileSize >= 300 * 1024 * 1024) {
        const fileSizeMB = Math.round(pdfInfo.fileSize / (1024 * 1024))
        throw new Error(`PDF file size (${fileSizeMB}MB) exceeds the limit of 300MB`)
      }

      // 步骤1: 准备上传
      const { uid, url } = await this.preupload()
      Logger.info(`OCR preupload completed: uid=${uid}`)

      // 步骤2: 上传文件
      await this.putFile(file.path, url)

      // 步骤3: 等待处理完成
      await this.waitForProcessing(sourceId, uid)
      Logger.info(`OCR parsing completed successfully for: ${file.path}`)

      // 步骤4: 导出文件
      const { path: outputPath } = await this.exportFile(file.path, uid)

      // 步骤5: 创建处理后的文件信息
      return {
        processedFile: this.createProcessedFileInfo(file, outputPath)
      }
    } catch (error) {
      Logger.error(`OCR processing failed for ${file.path}: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
  }

  private createProcessedFileInfo(file: FileType, outputPath: string): FileType {
    const outputFilePath = `${outputPath}/${file.id}.md`
    return {
      ...file,
      name: file.name.replace('.pdf', '.md'),
      path: outputFilePath,
      ext: '.md',
      size: fs.statSync(outputFilePath).size
    }
  }

  public async exportFile(filePath: string, uid: string): Promise<{ path: string }> {
    Logger.info(`Exporting file: ${filePath}`)

    // 步骤1: 转换文件
    await this.convertFile(uid, filePath)
    Logger.info(`File conversion completed for: ${filePath}`)

    // 步骤2: 等待导出并获取URL
    const exportUrl = await this.waitForExport(uid)

    // 步骤3: 下载并解压文件
    return this.downloadFile(exportUrl, filePath)
  }

  private async waitForProcessing(sourceId: string, uid: string): Promise<void> {
    while (true) {
      await this.delay(1000)
      const { status, progress } = await this.getStatus(uid)
      await this.sendOcrProgress(sourceId, progress)
      Logger.info(`OCR processing status: ${status}, progress: ${progress}%`)

      if (status === 'success') {
        return
      } else if (status === 'failed') {
        throw new Error('OCR processing failed')
      }
    }
  }

  private async waitForExport(uid: string): Promise<string> {
    while (true) {
      await this.delay(1000)
      const { status, url } = await this.getParsedFile(uid)
      Logger.info(`Export status: ${status}`)

      if (status === 'success' && url) {
        return url
      } else if (status === 'failed') {
        throw new Error('Export failed')
      }
    }
  }

  private async preupload(): Promise<PreuploadResponse> {
    const config = this.createAuthConfig()
    const endpoint = `${this.base.ocrProvider?.apiHost}/api/v2/parse/preupload`

    try {
      const { data } = await axios.post<ApiResponse<PreuploadResponse>>(endpoint, null, config)

      if (data.code === 'success' && data.data) {
        return data.data
      } else {
        throw new Error(`API returned error: ${data.message || JSON.stringify(data)}`)
      }
    } catch (error) {
      Logger.error(`Failed to get preupload URL: ${error instanceof Error ? error.message : String(error)}`)
      throw new Error('Failed to get preupload URL')
    }
  }

  private async putFile(filePath: string, url: string): Promise<void> {
    try {
      const fileContent = fs.readFileSync(filePath)
      const response = await axios.put(url, fileContent)

      if (response.status !== 200) {
        throw new Error(`HTTP status ${response.status}: ${response.statusText}`)
      }
    } catch (error) {
      Logger.error(`Failed to upload file ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
      throw new Error('Failed to upload file')
    }
  }

  private async getStatus(uid: string): Promise<StatusResponse> {
    const config = this.createAuthConfig()
    const endpoint = `${this.base.ocrProvider?.apiHost}/api/v2/parse/status?uid=${uid}`

    try {
      const response = await axios.get<ApiResponse<StatusResponse>>(endpoint, config)

      if (response.data.code === 'success' && response.data.data) {
        return response.data.data
      } else {
        throw new Error(`API returned error: ${response.data.message || JSON.stringify(response.data)}`)
      }
    } catch (error) {
      Logger.error(`Failed to get status for uid ${uid}: ${error instanceof Error ? error.message : String(error)}`)
      throw new Error('Failed to get processing status')
    }
  }

  private async convertFile(uid: string, filePath: string): Promise<void> {
    const fileName = path.basename(filePath).split('.')[0]
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

    const endpoint = `${this.base.ocrProvider?.apiHost}/api/v2/convert/parse`

    try {
      const response = await axios.post<ApiResponse<any>>(endpoint, payload, config)

      if (response.data.code !== 'success') {
        throw new Error(`API returned error: ${response.data.message || JSON.stringify(response.data)}`)
      }
    } catch (error) {
      Logger.error(`Failed to convert file ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
      throw new Error('Failed to convert file')
    }
  }

  private async getParsedFile(uid: string): Promise<ParsedFileResponse> {
    const config = this.createAuthConfig()
    const endpoint = `${this.base.ocrProvider?.apiHost}/api/v2/convert/parse/result?uid=${uid}`

    try {
      const response = await axios.get<ApiResponse<ParsedFileResponse>>(endpoint, config)

      if (response.status === 200 && response.data.data) {
        return response.data.data
      } else {
        throw new Error(`HTTP status ${response.status}: ${response.statusText}`)
      }
    } catch (error) {
      Logger.error(
        `Failed to get parsed file for uid ${uid}: ${error instanceof Error ? error.message : String(error)}`
      )
      throw new Error('Failed to get parsed file information')
    }
  }

  private async downloadFile(url: string, filePath: string): Promise<{ path: string }> {
    const dirPath = path.dirname(filePath)
    const baseName = path.basename(filePath, path.extname(filePath))
    const zipPath = path.join(dirPath, `${baseName}.zip`)
    const extractPath = path.join(dirPath, baseName)

    Logger.info(`Downloading to export path: ${zipPath}`)

    try {
      // 下载文件
      const response = await axios.get(url, { responseType: 'arraybuffer' })
      fs.writeFileSync(zipPath, response.data)

      // 解压文件
      const zip = new AdmZip(zipPath)
      zip.extractAllTo(extractPath, true)

      // 删除临时ZIP文件
      fs.unlinkSync(zipPath)

      return { path: extractPath }
    } catch (error) {
      Logger.error(`Failed to download and extract file: ${error instanceof Error ? error.message : String(error)}`)
      throw new Error('Failed to download and extract file')
    }
  }

  private createAuthConfig(): AxiosRequestConfig {
    return {
      headers: {
        Authorization: `Bearer ${this.base.ocrProvider?.apiKey}`
      }
    }
  }
}
