import { loggerService } from '@logger'
import { getIpCountry } from '@main/utils/ipService'
import { loadOcrImage } from '@main/utils/ocr'
import { MB } from '@shared/config/constant'
import { ImageFileMetadata, isImageFile, OcrResult, SupportedOcrFile } from '@types'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import Tesseract, { createWorker, LanguageCode } from 'tesseract.js'

const logger = loggerService.withContext('TesseractService')

// config
const MB_SIZE_THRESHOLD = 50
const tesseractLangs = ['chi_sim', 'chi_tra', 'eng'] satisfies LanguageCode[]
enum TesseractLangsDownloadUrl {
  CN = 'https://gitcode.com/beyondkmp/tessdata/releases/download/4.1.0/',
  GLOBAL = 'https://github.com/tesseract-ocr/tessdata/raw/main/'
}

export class TesseractService {
  private worker: Tesseract.Worker | null = null

  async getWorker(): Promise<Tesseract.Worker> {
    if (!this.worker) {
      // for now, only support limited languages
      this.worker = await createWorker(tesseractLangs, undefined, {
        langPath: await this._getLangPath(),
        cachePath: await this._getCacheDir(),
        gzip: false,
        logger: (m) => logger.debug('From worker', m)
      })
    }
    return this.worker
  }

  async imageOcr(file: ImageFileMetadata): Promise<OcrResult> {
    const worker = await this.getWorker()
    const stat = await fs.promises.stat(file.path)
    if (stat.size > MB_SIZE_THRESHOLD * MB) {
      throw new Error(`This image is too large (max ${MB_SIZE_THRESHOLD}MB)`)
    }
    const buffer = await loadOcrImage(file)
    const result = await worker.recognize(buffer)
    return { text: result.data.text }
  }

  async ocr(file: SupportedOcrFile): Promise<OcrResult> {
    if (!isImageFile(file)) {
      throw new Error('Only image files are supported currently')
    }
    return this.imageOcr(file)
  }

  private async _getLangPath(): Promise<string> {
    const country = await getIpCountry()
    return country.toLowerCase() === 'cn' ? TesseractLangsDownloadUrl.CN : TesseractLangsDownloadUrl.GLOBAL
  }

  private async _getCacheDir(): Promise<string> {
    const cacheDir = path.join(app.getPath('userData'), 'tesseract')
    // use access to check if the directory exists
    if (
      !(await fs.promises
        .access(cacheDir, fs.constants.F_OK)
        .then(() => true)
        .catch(() => false))
    ) {
      await fs.promises.mkdir(cacheDir, { recursive: true })
    }
    return cacheDir
  }

  async dispose(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate()
      this.worker = null
    }
  }
}

export const tesseractService = new TesseractService()
