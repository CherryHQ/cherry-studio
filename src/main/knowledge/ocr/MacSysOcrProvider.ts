import { loggerService } from '@logger'
import { isMac } from '@main/constant'
import { FileMetadata, OcrProvider } from '@types'
import * as fs from 'fs'
import * as path from 'path'
import { TextItem } from 'pdfjs-dist/types/src/display/api'

import BaseOcrProvider from './BaseOcrProvider'

const logger = loggerService.withContext('MacSysOcrProvider')

export default class MacSysOcrProvider extends BaseOcrProvider {
  private readonly MIN_TEXT_LENGTH = 1000
  private MacOCR: any

  private async initMacOCR() {
    if (!isMac) {
      throw new Error('MacSysOcrProvider is only available on macOS')
    }
    if (!this.MacOCR) {
      try {
        // @ts-ignore This module is optional and only installed/available on macOS. Runtime checks prevent execution on other platforms.
        const module = await import('@cherrystudio/mac-system-ocr')
        this.MacOCR = module.default
      } catch (error) {
        logger.error('Failed to load mac-system-ocr:', error as Error)
        throw error
      }
    }
    return this.MacOCR
  }

  private getRecognitionLevel(level?: number) {
    return level === 0 ? this.MacOCR.RECOGNITION_LEVEL_FAST : this.MacOCR.RECOGNITION_LEVEL_ACCURATE
  }

  constructor(provider: OcrProvider) {
    super(provider)
  }

  private async processPages(
    results: any,
    totalPages: number,
    sourceId: string,
    writeStream: fs.WriteStream
  ): Promise<void> {
    await this.initMacOCR()
    // TODO: 下个版本后面使用批处理，以及p-queue来优化
    for (let i = 0; i < totalPages; i++) {
      // Convert pages to buffers
      const pageNum = i + 1
      const pageBuffer = await results.getPage(pageNum)

      // Process batch
      const ocrResult = await this.MacOCR.recognizeFromBuffer(pageBuffer, {
        ocrOptions: {
          recognitionLevel: this.getRecognitionLevel(this.provider.options?.recognitionLevel),
          minConfidence: this.provider.options?.minConfidence || 0.5
        }
      })

      // Write results in order
      writeStream.write(ocrResult.text + '\n')

      // Update progress
      await this.sendOcrProgress(sourceId, (pageNum / totalPages) * 100)
    }
  }

  public async isScanPdf(buffer: Buffer): Promise<boolean> {
    const doc = await this.readPdf(new Uint8Array(buffer))
    const pageLength = doc.numPages
    let counts = 0
    const pagesToCheck = Math.min(pageLength, 10)
    for (let i = 0; i < pagesToCheck; i++) {
      const page = await doc.getPage(i + 1)
      const pageData = await page.getTextContent()
      const pageText = pageData.items.map((item) => (item as TextItem).str).join('')
      counts += pageText.length
      if (counts >= this.MIN_TEXT_LENGTH) {
        return false
      }
    }
    return true
  }

  public async parseFile(sourceId: string, file: FileMetadata): Promise<{ processedFile: FileMetadata }> {
    logger.info(`Starting OCR process for file: ${file.name}`)
    if (file.ext === '.pdf') {
      try {
        const { pdf } = await import('@cherrystudio/pdf-to-img-napi')
        const pdfBuffer = await fs.promises.readFile(file.path)
        const results = await pdf(pdfBuffer, {
          scale: 2
        })
        const totalPages = results.length

        const baseDir = path.dirname(file.path)
        const baseName = path.basename(file.path, path.extname(file.path))
        const txtFileName = `${baseName}.txt`
        const txtFilePath = path.join(baseDir, txtFileName)

        const writeStream = fs.createWriteStream(txtFilePath)
        await this.processPages(results, totalPages, sourceId, writeStream)

        await new Promise<void>((resolve, reject) => {
          writeStream.end(() => {
            logger.info(`OCR process completed successfully for ${file.origin_name}`)
            resolve()
          })
          writeStream.on('error', reject)
        })
        const movedPaths = this.moveToAttachmentsDir(file.id, [txtFilePath])
        return {
          processedFile: {
            ...file,
            name: txtFileName,
            path: movedPaths[0],
            ext: '.txt',
            size: fs.statSync(movedPaths[0]).size
          }
        }
      } catch (error) {
        logger.error('Error during OCR process:', error as Error)
        throw error
      }
    }
    return { processedFile: file }
  }
}
