import { FileSource, isLocalFile, LocalFileSource, OcrProvider } from '@types'
import Logger from 'electron-log'
import * as fs from 'fs'
import PQueue from 'p-queue'
import * as path from 'path'
import { TextItem } from 'pdfjs-dist/types/src/display/api'

import BaseOcrProvider from './BaseOcrProvider'

export default class MacSysOcrProvider extends BaseOcrProvider {
  private readonly BATCH_SIZE = 4
  private readonly CONCURRENCY = 2
  private readonly MIN_TEXT_LENGTH = 1000
  private MacOCR: any

  private async initMacOCR() {
    if (!this.MacOCR) {
      try {
        const module = await import('@cherrystudio/mac-system-ocr')
        this.MacOCR = module.default
      } catch (error) {
        Logger.error('[OCR] Failed to load mac-system-ocr:', error)
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
    const queue = new PQueue({ concurrency: this.CONCURRENCY })
    const batches: Promise<void>[] = []
    await this.initMacOCR()

    // Create ordered batches
    for (let startPage = 0; startPage < totalPages; startPage += this.BATCH_SIZE) {
      const endPage = Math.min(startPage + this.BATCH_SIZE, totalPages)
      const batchPromise = queue.add(async () => {
        // Convert pages to buffers
        const pageBuffers: Buffer[] = []
        for (let i = startPage; i < endPage; i++) {
          const pageNum = i + 1
          const pageBuffer = await results.getPage(pageNum)
          const croppedPageBuffer = await this.cropImage(pageBuffer)
          pageBuffers.push(croppedPageBuffer)
        }

        // Process batch
        const ocrResults = await this.MacOCR.recognizeBatchFromBuffer(pageBuffers, {
          maxThreads: 4,
          ocrOptions: {
            recognitionLevel: this.getRecognitionLevel(this.provider.options?.recognitionLevel),
            minConfidence: this.provider.options?.minConfidence || 0.5
          }
        })

        // Write results in order
        for (const result of ocrResults) {
          writeStream.write(result.text + '\n')
        }

        // Update progress
        await this.sendOcrProgress(sourceId, (endPage / totalPages) * 100)
      })
      batches.push(batchPromise)
    }

    // Wait for all batches to complete in order
    await Promise.all(batches)
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

  public async parseFile(sourceId: string, file: FileSource): Promise<{ processedFile: LocalFileSource }> {
    Logger.info(`[OCR] Starting OCR process for file: ${file.name}`)
    if (isLocalFile(file)) {
      if (file.ext === '.pdf') {
        try {
          const { pdf } = await import('pdf-to-img')
          const pdfBuffer = await fs.promises.readFile(file.path)
          const isScanPdf = await this.isScanPdf(pdfBuffer)
          if (!isScanPdf) {
            Logger.info('[OCR] PDF is not a scan version, skipping OCR')
            return { processedFile: file }
          }
          const results = await pdf(pdfBuffer)
          const totalPages = results.length

          const baseDir = path.dirname(file.path)
          const baseName = path.basename(file.path, path.extname(file.path))
          const txtFileName = `${baseName}.txt`
          const txtFilePath = path.join(baseDir, txtFileName)

          const writeStream = fs.createWriteStream(txtFilePath)
          await this.processPages(results, totalPages, sourceId, writeStream)

          await new Promise<void>((resolve, reject) => {
            writeStream.end(() => {
              Logger.info(`[OCR] OCR process completed successfully for ${file.origin_name}`)
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
          Logger.error('[OCR] Error during OCR process:', error)
          throw error
        }
      }
      return { processedFile: file }
    }
    throw new Error('Only local files are supported')
  }
}
