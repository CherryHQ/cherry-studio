import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { fileStorage } from '@main/services/FileStorage'
import { FileMetadata, PreprocessProvider } from '@types'
import AdmZip from 'adm-zip'
import { net } from 'electron'
import FormData from 'form-data'

import BasePreprocessProvider from './BasePreprocessProvider'

const logger = loggerService.withContext('MineruPreprocessProvider')

export default class OpenMineruPreprocessProvider extends BasePreprocessProvider {
  constructor(provider: PreprocessProvider, userId?: string) {
    super(provider, userId)
    this.provider.apiKey = this.provider.apiKey
  }

  public async parseFile(
    sourceId: string,
    file: FileMetadata
  ): Promise<{ processedFile: FileMetadata; quota: number }> {
    try {
      const filePath = fileStorage.getFilePathById(file)
      logger.info(`Open MinerU preprocess processing started: ${filePath}`)
      await this.validateFile(filePath)

      // 1. 更新进度
      await this.sendPreprocessProgress(sourceId, 50)
      logger.info(`File ${file.name} is starting processing...`)

      // 2. 获取上传文件并解析
      const { path: outputPath } = await this.uploadFileAndExtract(file)

      // 3. check quota
      const quota = await this.checkQuota()

      // 4. 创建处理后的文件信息
      return {
        processedFile: this.createProcessedFileInfo(file, outputPath),
        quota
      }
    } catch (error: any) {
      logger.error(`Open MinerU preprocess processing failed for:`, error as Error)
      throw new Error(error.message)
    }
  }

  public async checkQuota() {
    // self-hosted version always has enough quota
    return Infinity
  }

  private async validateFile(filePath: string): Promise<void> {
    const pdfBuffer = await fs.promises.readFile(filePath)

    const doc = await this.readPdf(pdfBuffer)

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
    // 按文件名找到对应文件夹
    outputPath = path.join(outputPath, `${file.origin_name.replace('.pdf', '')}`)
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
          logger.info(`Renamed markdown file from ${mdFile} to ${finalName}`)
        } catch (renameError) {
          logger.warn(`Failed to rename file ${mdFile} to ${finalName}: ${renameError}`)
          // 如果重命名失败，使用原文件
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

  private async uploadFileAndExtract(
    file: FileMetadata,
    maxRetries: number = 5,
    intervalMs: number = 5000
  ): Promise<{ path: string }> {
    let retries = 0

    const endpoint = `${this.provider.apiHost}/file_parse`

    // 获取文件流
    const filePath = fileStorage.getFilePathById(file)
    const fileBuffer = await fs.promises.readFile(filePath)

    const formData = new FormData()
    formData.append('return_md', 'true')
    formData.append('response_format_zip', 'true')
    formData.append('files', fileBuffer, {
      filename: file.origin_name
    })

    while (retries < maxRetries) {
      try {
        const response = await net.fetch(endpoint, {
          method: 'POST',
          headers: {
            token: this.userId ?? '',
            ...(this.provider.apiKey ? { Authorization: `Bearer ${this.provider.apiKey}` } : {}),
            ...formData.getHeaders()
          },
          body: formData.getBuffer()
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        // 判断响应头是否是application/zip
        if (response.headers.get('content-type') !== 'application/zip') {
          throw new Error(`Downloaded ZIP file has unexpected content-type: ${response.headers.get('content-type')}`)
        }

        const dirPath = this.storageDir

        const zipPath = path.join(dirPath, `${file.id}.zip`)
        const extractPath = path.join(dirPath, `${file.id}`)

        const arrayBuffer = await response.arrayBuffer()
        fs.writeFileSync(zipPath, Buffer.from(arrayBuffer))
        logger.info(`Downloaded ZIP file: ${zipPath}`)

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
        logger.warn(`Failed to upload and extract file: ${error}, retry ${retries + 1}/${maxRetries}`)
        if (retries === maxRetries - 1) {
          throw error
        }
      }

      retries++
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }

    throw new Error(`Processing timeout for file: ${file.id}`)
  }
}
