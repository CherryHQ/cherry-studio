import fs from 'node:fs'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { getIpCountry } from '@main/utils/ipService'
import { loadOcrImage } from '@main/utils/ocr'
import { MB } from '@shared/config/constant'
import PQueue from 'p-queue'
import type { LanguageCode } from 'tesseract.js'
import type Tesseract from 'tesseract.js'
import { createWorker } from 'tesseract.js'

import type { FileProcessingTextExtractionResult } from '../../contracts/types'
import type { PreparedTesseractContext } from '../../processors/builtin/tesseract/type'

const logger = loggerService.withContext('TesseractRuntimeService')

const MB_SIZE_THRESHOLD = 50
const TESSERACT_LANGS_DOWNLOAD_URL_CN = 'https://gitcode.com/beyondkmp/tessdata-best/releases/download/1.0.0/'

@Injectable('TesseractRuntimeService')
@ServicePhase(Phase.BeforeReady)
export class TesseractRuntimeService extends BaseService {
  private sharedWorker: Tesseract.Worker | null = null
  private previousLangsKey: string | null = null
  private acceptingTasks = false
  private shutdownController: AbortController | null = null
  // TODO(file-processing): When ProcessManagerService lands, move the shared
  // worker lifecycle and concurrency control behind a managed utility process
  // or process pool instead of keeping the runtime in the main process.
  private extractionQueue = new PQueue({
    concurrency: 1
  })

  protected async onInit(): Promise<void> {
    this.acceptingTasks = true
    this.shutdownController = new AbortController()
  }

  protected async onStop(): Promise<void> {
    this.acceptingTasks = false
    this.shutdownController?.abort(this.createAbortError('Tesseract runtime is stopping'))

    await this.disposeWorkerSafely()
    await this.extractionQueue.onIdle()
    this.shutdownController = null

    logger.debug('Tesseract runtime cleanup completed')
  }

  async extract(context: PreparedTesseractContext): Promise<FileProcessingTextExtractionResult> {
    if (!this.acceptingTasks) {
      throw new Error('TesseractRuntimeService is not initialized')
    }

    context.signal?.throwIfAborted()

    const extractionResult = await this.extractionQueue.add(async () => {
      this.throwIfStopped()
      context.signal?.throwIfAborted()

      const worker = await this.getWorker(context.langs)
      this.throwIfStopped()

      const stat = await fs.promises.stat(context.file.path)
      this.throwIfStopped()

      if (stat.size > MB_SIZE_THRESHOLD * MB) {
        throw new Error(`This image is too large (max ${MB_SIZE_THRESHOLD}MB)`)
      }

      const buffer = await loadOcrImage(context.file)
      this.throwIfStopped()
      const result = await worker.recognize(buffer).catch((error) => {
        this.throwIfStopped()
        throw error
      })
      this.throwIfStopped()

      return {
        text: result.data.text
      }
    })

    if (!extractionResult) {
      throw new Error('Tesseract extraction task did not return a result')
    }

    return extractionResult
  }

  private async getWorker(langs: LanguageCode[]): Promise<Tesseract.Worker> {
    this.throwIfStopped()

    const langsKey = langs.join(',')

    if (!this.sharedWorker || this.previousLangsKey !== langsKey) {
      await this.disposeWorker()
      this.throwIfStopped()

      logger.debug('Creating Tesseract worker for file-processing', {
        langs
      })

      const nextWorker = await createWorker(langs, undefined, {
        langPath: await this.getLangPath(),
        cachePath: await this.getCacheDir(),
        logger: (message) => logger.debug('Tesseract worker event', message)
      })
      try {
        this.throwIfStopped()
      } catch (error) {
        await nextWorker.terminate().catch(() => undefined)
        throw error
      }

      this.sharedWorker = nextWorker
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

  private async disposeWorkerSafely(): Promise<void> {
    try {
      await this.disposeWorker()
    } catch (error) {
      logger.warn('Failed to terminate Tesseract worker during shutdown', error as Error)
    }
  }

  private async getLangPath(): Promise<string> {
    const country = await getIpCountry()
    return country.toLowerCase() === 'cn' ? TESSERACT_LANGS_DOWNLOAD_URL_CN : ''
  }

  private async getCacheDir(): Promise<string> {
    return application.getPath('feature.ocr.tesseract')
  }

  private throwIfStopped(): void {
    const signal = this.shutdownController?.signal

    if (!signal?.aborted) {
      return
    }

    throw this.createAbortError(signal.reason)
  }

  private createAbortError(reason: unknown): Error {
    if (reason instanceof Error && reason.name === 'AbortError') {
      return reason
    }

    if (reason instanceof Error) {
      const error = new Error(reason.message)
      error.name = 'AbortError'
      return error
    }

    const error = new Error(typeof reason === 'string' ? reason : 'The operation was aborted')
    error.name = 'AbortError'
    return error
  }
}
