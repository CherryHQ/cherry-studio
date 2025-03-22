import fs from 'node:fs'

import { windowService } from '@main/services/WindowService'
import { FileType, KnowledgeBaseParams } from '@types'
import Logger from 'electron-log'
import pdfParse from 'pdf-parse'
export default abstract class BaseOcrProvider {
  protected base: KnowledgeBaseParams
  constructor(base: KnowledgeBaseParams) {
    if (!base) {
      throw new Error('KnowledgeBaseParams is required')
    }
    if (!base.ocrProvider || base.ocrProvider?.apiKey === '') {
      throw new Error('Ocr provider is not set or apiKey is empty')
    }
    this.base = base
  }
  abstract parseFile(sourceId: string, file: FileType): Promise<{ processedFile: FileType }>
  /**
   * 辅助方法：延迟执行
   */
  public delay = (ms: number): Promise<void> => {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * 获取PDF文件的页数和文件大小
   * @param filePath PDF文件路径
   * @returns 包含页数和文件大小(字节)的对象
   */
  public async getPdfInfo(filePath: string): Promise<{ pageCount: number; fileSize: number }> {
    try {
      Logger.info(`Getting PDF info for: ${filePath}`)

      if (!filePath.toLowerCase().endsWith('.pdf')) {
        throw new Error('File is not a PDF')
      }

      const stats = fs.statSync(filePath)
      const fileSize = stats.size
      const dataBuffer = fs.readFileSync(filePath)
      const pdfData = await pdfParse(dataBuffer)

      Logger.info(`File ${filePath} has ${pdfData.numpages} pages and size: ${fileSize} bytes`)
      return {
        pageCount: pdfData.numpages,
        fileSize: fileSize
      }
    } catch (error) {
      Logger.error(`Failed to get PDF info for ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
      throw new Error('Failed to get PDF information')
    }
  }

  public async sendOcrProgress(sourceId: string, progress: number): Promise<void> {
    const mainWindow = windowService.getMainWindow()
    mainWindow?.webContents.send('file-ocr-progress', {
      itemId: sourceId,
      progress: progress
    })
  }
}
