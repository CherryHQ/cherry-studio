/**
 * Tesseract OCR Processor
 *
 * Worker-based OCR processor using Tesseract.js.
 * Implements IDisposable for proper worker cleanup.
 */

import { loggerService } from '@logger'
import { getIpCountry } from '@main/utils/ipService'
import { loadOcrImage } from '@main/utils/ocr'
import { MB } from '@shared/config/constant'
import { type FileProcessorMerged, PRESETS_FILE_PROCESSORS } from '@shared/data/presets/fileProcessing'
import type { FileMetadata } from '@types'
import { isImageFileMetadata } from '@types'
import { app } from 'electron'
import fs from 'fs'
import { isEqual } from 'lodash'
import path from 'path'
import type { LanguageCode } from 'tesseract.js'
import type Tesseract from 'tesseract.js'
import { createWorker } from 'tesseract.js'

import { BaseTextExtractor } from '../../base/BaseTextExtractor'
import type { IDisposable } from '../../interfaces'
import type { ProcessingContext, ProcessingResult } from '../../types'

const logger = loggerService.withContext('TesseractProcessor')

// Configuration
const MB_SIZE_THRESHOLD = 50
const DEFAULT_LANGS: LanguageCode[] = ['chi_sim', 'chi_tra', 'eng']

enum TesseractLangsDownloadUrl {
  CN = 'https://gitcode.com/beyondkmp/tessdata-best/releases/download/1.0.0/'
}

/**
 * Tesseract OCR processor
 *
 * Uses Tesseract.js for text extraction from images.
 * Manages a worker instance that is reinitialized when language config changes.
 */
export class TesseractProcessor extends BaseTextExtractor implements IDisposable {
  private worker: Tesseract.Worker | null = null
  private currentLangs: LanguageCode[] = []

  constructor() {
    const template = PRESETS_FILE_PROCESSORS.find((p) => p.id === 'tesseract')
    if (!template) {
      throw new Error('Tesseract processor template not found in presets')
    }
    super(template)
  }

  /**
   * Get or create the Tesseract worker
   *
   * Reinitializes the worker if the language configuration has changed.
   */
  private async getWorker(langs: LanguageCode[]): Promise<Tesseract.Worker> {
    // Reinitialize worker if langs changed
    if (!this.worker || !isEqual(this.currentLangs, langs)) {
      if (this.worker) {
        await this.dispose()
      }

      logger.debug('Creating worker with langs', langs)
      const langPath = await this.getLangPath()
      const cachePath = await this.getCacheDir()

      this.worker = await createWorker(langs, undefined, {
        langPath,
        cachePath,
        logger: (m) => logger.debug('Worker progress', m),
        errorHandler: (e) => logger.error('Worker error', e)
      })

      this.currentLangs = [...langs]
    }

    return this.worker
  }

  /**
   * Get the language download path based on user's location
   */
  private async getLangPath(): Promise<string> {
    const country = await getIpCountry()
    return country.toLowerCase() === 'cn' ? TesseractLangsDownloadUrl.CN : ''
  }

  /**
   * Get or create the cache directory for Tesseract data
   */
  private async getCacheDir(): Promise<string> {
    const cacheDir = path.join(app.getPath('userData'), 'tesseract')
    try {
      await fs.promises.access(cacheDir, fs.constants.F_OK)
    } catch {
      await fs.promises.mkdir(cacheDir, { recursive: true })
    }
    return cacheDir
  }

  /**
   * Parse language configuration from processor options
   */
  private parseLangs(config: FileProcessorMerged): LanguageCode[] {
    const langsOption = config.options?.langs

    if (langsOption && typeof langsOption === 'object' && !Array.isArray(langsOption)) {
      // Format: { chi_sim: true, eng: true, ... }
      const langsArray = Object.keys(langsOption) as LanguageCode[]
      if (langsArray.length > 0) {
        return langsArray
      }
    }

    if (Array.isArray(langsOption)) {
      // Format: ['chi_sim', 'eng', ...]
      return langsOption as LanguageCode[]
    }

    logger.debug('No valid langs option found, using defaults')
    return DEFAULT_LANGS
  }

  /**
   * Perform text extraction using Tesseract
   */
  protected async doExtractText(
    input: FileMetadata,
    config: FileProcessorMerged,
    context: ProcessingContext
  ): Promise<ProcessingResult> {
    if (!isImageFileMetadata(input)) {
      throw new Error('TesseractProcessor only supports image files')
    }

    // Check file size
    const stat = await fs.promises.stat(input.path)
    if (stat.size > MB_SIZE_THRESHOLD * MB) {
      throw new Error(`Image file is too large (max ${MB_SIZE_THRESHOLD}MB)`)
    }

    // Get language configuration
    const langs = this.parseLangs(config)
    logger.debug('Using languages', langs)

    // Get worker and perform OCR
    const worker = await this.getWorker(langs)

    // Check cancellation before processing
    this.checkCancellation(context)

    // Load and preprocess image
    const buffer = await loadOcrImage(input)

    // Perform recognition
    const result = await worker.recognize(buffer)

    return { text: result.data.text }
  }

  /**
   * Dispose of the worker
   */
  async dispose(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate()
      this.worker = null
      this.currentLangs = []
      logger.debug('Worker disposed')
    }
  }
}
