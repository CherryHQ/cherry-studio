import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { getIpCountry } from '@main/utils/ipService'
import { loadOcrImage } from '@main/utils/ocr'
import { MB } from '@shared/config/constant'
import { app } from 'electron'
import type { LanguageCode } from 'tesseract.js'
import type Tesseract from 'tesseract.js'
import { createWorker } from 'tesseract.js'

import type { PreparedTesseractContext } from './providers/builtin/tesseract/type'
import type { FileProcessingTextExtractionResult } from './types'

const logger = loggerService.withContext('TesseractRuntimeService')

const MB_SIZE_THRESHOLD = 50
const TESSERACT_LANGS_DOWNLOAD_URL_CN = 'https://gitcode.com/beyondkmp/tessdata-best/releases/download/1.0.0/'

@Injectable('TesseractRuntimeService')
@ServicePhase(Phase.BeforeReady)
export class TesseractRuntimeService extends BaseService {
  private sharedWorker: Tesseract.Worker | null = null
  private previousLangsKey: string | null = null
  // TODO(file-processing): When ProcessManagerService lands, move the shared
  // worker lifecycle and concurrency control behind a managed utility process
  // or process pool instead of keeping the runtime in the main process.
  private extractionQueue: Promise<void> = Promise.resolve()

  protected async onStop(): Promise<void> {
    await this.disposeWorker()
    this.extractionQueue = Promise.resolve()

    logger.debug('Tesseract runtime cleanup completed')
  }

  async extract(context: PreparedTesseractContext): Promise<FileProcessingTextExtractionResult> {
    return this.runInExtractionQueue(async () => {
      context.signal?.throwIfAborted()

      const worker = await this.getWorker(context.langs)
      const stat = await fs.promises.stat(context.file.path)

      if (stat.size > MB_SIZE_THRESHOLD * MB) {
        throw new Error(`This image is too large (max ${MB_SIZE_THRESHOLD}MB)`)
      }

      const buffer = await loadOcrImage(context.file)
      const result = await worker.recognize(buffer)

      return {
        text: result.data.text
      }
    })
  }

  private async getWorker(langs: LanguageCode[]): Promise<Tesseract.Worker> {
    const langsKey = langs.join(',')

    if (!this.sharedWorker || this.previousLangsKey !== langsKey) {
      await this.disposeWorker()

      logger.debug('Creating Tesseract worker for file-processing', {
        langs
      })

      this.sharedWorker = await createWorker(langs, undefined, {
        langPath: await this.getLangPath(),
        cachePath: await this.getCacheDir(),
        logger: (message) => logger.debug('Tesseract worker event', message)
      })
      this.previousLangsKey = langsKey
    }

    return this.sharedWorker
  }

  private async disposeWorker(): Promise<void> {
    if (!this.sharedWorker) {
      this.previousLangsKey = null
      return
    }

    const worker = this.sharedWorker
    this.sharedWorker = null
    this.previousLangsKey = null
    await worker.terminate()
  }

  private async getLangPath(): Promise<string> {
    const country = await getIpCountry()
    return country.toLowerCase() === 'cn' ? TESSERACT_LANGS_DOWNLOAD_URL_CN : ''
  }

  private async getCacheDir(): Promise<string> {
    const cacheDir = path.join(app.getPath('userData'), 'tesseract')
    await fs.promises.mkdir(cacheDir, { recursive: true })
    return cacheDir
  }

  private runInExtractionQueue<T>(task: () => Promise<T>): Promise<T> {
    const nextTask = this.extractionQueue.then(task)
    this.extractionQueue = nextTask.then(
      () => undefined,
      () => undefined
    )
    return nextTask
  }
}
