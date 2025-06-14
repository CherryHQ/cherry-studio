import fs from 'node:fs'
import path from 'node:path'

import { windowService } from '@main/services/WindowService'
import { getFileExt } from '@main/utils/file'
import { FileMetadata, OcrProvider } from '@types'
import { createCanvas, loadImage } from 'canvas'
import { app } from 'electron'
import { TypedArray } from 'pdfjs-dist/types/src/display/api'

export default abstract class BaseOcrProvider {
  protected provider: OcrProvider
  public storageDir = path.join(app.getPath('userData'), 'Data', 'Files')

  constructor(provider: OcrProvider) {
    if (!provider) {
      throw new Error('OCR provider is not set')
    }
    this.provider = provider
  }
  abstract parseFile(sourceId: string, file: FileMetadata): Promise<{ processedFile: FileMetadata; quota?: number }>

  /**
   * 检查文件是否已经被预处理过
   * 统一检测方法：如果 Data/Files/{file.id} 是目录，说明已被预处理
   * @param file 文件信息
   * @returns 如果已处理返回处理后的文件信息，否则返回null
   */
  public async checkIfAlreadyProcessed(file: FileMetadata): Promise<FileMetadata | null> {
    try {
      // 检查 Data/Files/{file.id} 是否是目录
      const preprocessDirPath = path.join(this.storageDir, file.id)

      if (fs.existsSync(preprocessDirPath)) {
        const stats = await fs.promises.stat(preprocessDirPath)

        // 如果是目录，说明已经被预处理过
        if (stats.isDirectory()) {
          // 查找目录中的处理结果文件
          const files = await fs.promises.readdir(preprocessDirPath)

          // 查找主要的处理结果文件（.md 或 .txt）
          const processedFile = files.find((fileName) => fileName.endsWith('.md') || fileName.endsWith('.txt'))

          if (processedFile) {
            const processedFilePath = path.join(preprocessDirPath, processedFile)
            const processedStats = await fs.promises.stat(processedFilePath)
            const ext = getFileExt(processedFile)

            return {
              ...file,
              name: file.name.replace(file.ext, ext),
              path: processedFilePath,
              ext: ext,
              size: processedStats.size,
              created_at: processedStats.birthtime.toISOString()
            }
          }
        }
      }

      return null
    } catch (error) {
      // 如果检查过程中出现错误，返回null表示未处理
      return null
    }
  }

  /**
   * 辅助方法：延迟执行
   */
  public delay = (ms: number): Promise<void> => {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  public async readPdf(
    source: string | URL | TypedArray,
    passwordCallback?: (fn: (password: string) => void, reason: string) => string
  ) {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const documentLoadingTask = getDocument(source)
    if (passwordCallback) {
      documentLoadingTask.onPassword = passwordCallback
    }

    const document = await documentLoadingTask.promise
    return document
  }

  public async sendOcrProgress(sourceId: string, progress: number): Promise<void> {
    const mainWindow = windowService.getMainWindow()
    mainWindow?.webContents.send('file-preprocess-progress', {
      itemId: sourceId,
      progress: progress
    })
  }

  /**
   * 将文件移动到附件目录
   * @param fileId 文件id
   * @param filePaths 需要移动的文件路径数组
   * @returns 移动后的文件路径数组
   */
  public moveToAttachmentsDir(fileId: string, filePaths: string[]): string[] {
    const attachmentsPath = path.join(this.storageDir, fileId)
    if (!fs.existsSync(attachmentsPath)) {
      fs.mkdirSync(attachmentsPath, { recursive: true })
    }

    const movedPaths: string[] = []

    for (const filePath of filePaths) {
      if (fs.existsSync(filePath)) {
        const fileName = path.basename(filePath)
        const destPath = path.join(attachmentsPath, fileName)
        fs.copyFileSync(filePath, destPath)
        fs.unlinkSync(filePath) // 删除原文件，实现"移动"
        movedPaths.push(destPath)
      }
    }
    return movedPaths
  }

  public async cropImage(image: Buffer | string) {
    const img = await loadImage(image)
    const width = img.width
    const height = img.height

    const canvas = createCanvas(width, height)
    const context = canvas.getContext('2d')

    context.drawImage(img, 0, 0)

    const data = context.getImageData(0, 0, width, height).data

    const top = scanY(true)
    const bottom = scanY(false)
    const left = scanX(true)
    const right = scanX(false)

    if (top === null || bottom === null || left === null || right === null) {
      console.error('image is empty')
      return canvas.toBuffer()
    }

    const new_width = right - left
    const new_height = bottom - top

    canvas.width = new_width
    canvas.height = new_height

    context.drawImage(img, left, top, new_width, new_height, 0, 0, new_width, new_height)

    return canvas.toBuffer()

    // get pixel RGB data:
    function getRGB(x: number, y: number) {
      return {
        red: data[(width * y + x) * 4],
        green: data[(width * y + x) * 4 + 1],
        blue: data[(width * y + x) * 4 + 2]
      }
    }

    // check if pixel is a color other than white:
    function isColor(rgb: { red: number; green: number; blue: number }) {
      return rgb.red == 255 && rgb.green == 255 && rgb.blue == 255
    }

    // scan top and bottom edges of image:
    function scanY(top: boolean) {
      const offset = top ? 1 : -1

      for (let y = top ? 0 : height - 1; top ? y < height : y > -1; y += offset) {
        for (let x = 0; x < width; x++) {
          if (!isColor(getRGB(x, y))) {
            return y
          }
        }
      }

      return null
    }

    // scan left and right edges of image:
    function scanX(left: boolean) {
      const offset = left ? 1 : -1

      for (let x = left ? 0 : width - 1; left ? x < width : x > -1; x += offset) {
        for (let y = 0; y < height; y++) {
          if (!isColor(getRGB(x, y))) {
            return x
          }
        }
      }

      return null
    }
  }
}
