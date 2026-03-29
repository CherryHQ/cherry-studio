import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { getIpCountry } from '@main/utils/ipService'
import { loadOcrImage } from '@main/utils/ocr'
import { MB } from '@shared/config/constant'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileMetadata } from '@types'
import { isImageFileMetadata } from '@types'
import { app } from 'electron'
import type { LanguageCode } from 'tesseract.js'
import type Tesseract from 'tesseract.js'
import { createWorker } from 'tesseract.js'

import type { FileProcessingTextExtractionResult } from '../../../types'
import { type PreparedTesseractContext, TesseractProcessorOptionsSchema } from './type'

const logger = loggerService.withContext('FileProcessing:TesseractProcessor')
const MB_SIZE_THRESHOLD = 50
const DEFAULT_LANGS = ['chi_sim', 'chi_tra', 'eng'] satisfies LanguageCode[]
const TESSERACT_LANGS_DOWNLOAD_URL_CN = 'https://gitcode.com/beyondkmp/tessdata-best/releases/download/1.0.0/'

let sharedWorker: Tesseract.Worker | null = null
let previousLangsKey: string | null = null

export function prepareContext(
  file: FileMetadata,
  config: FileProcessorMerged,
  signal?: AbortSignal
): PreparedTesseractContext {
  if (!isImageFileMetadata(file)) {
    throw new Error('Tesseract OCR only supports image files')
  }

  const optionsResult = TesseractProcessorOptionsSchema.safeParse(config.options ?? {})
  const enabledLangs = optionsResult.success
    ? Object.entries(optionsResult.data.langs ?? {})
        .filter(([, enabled]) => enabled)
        .map(([lang]) => lang as LanguageCode)
    : []

  return {
    file,
    signal,
    langs: enabledLangs.length === 0 ? DEFAULT_LANGS : enabledLangs.sort()
  }
}

export async function executeExtraction(
  context: PreparedTesseractContext
): Promise<FileProcessingTextExtractionResult> {
  context.signal?.throwIfAborted()

  const worker = await getWorker(context.langs)
  const stat = await fs.promises.stat(context.file.path)

  if (stat.size > MB_SIZE_THRESHOLD * MB) {
    throw new Error(`This image is too large (max ${MB_SIZE_THRESHOLD}MB)`)
  }

  const buffer = await loadOcrImage(context.file)
  const result = await worker.recognize(buffer)

  return {
    text: result.data.text
  }
}

async function getWorker(langs: LanguageCode[]): Promise<Tesseract.Worker> {
  const langsKey = langs.join(',')

  if (!sharedWorker || previousLangsKey !== langsKey) {
    if (sharedWorker) {
      await sharedWorker.terminate()
    }

    logger.debug('Creating Tesseract worker for file-processing', {
      langs
    })

    sharedWorker = await createWorker(langs, undefined, {
      langPath: await getLangPath(),
      cachePath: await getCacheDir(),
      logger: (message) => logger.debug('Tesseract worker event', message)
    })
    previousLangsKey = langsKey
  }

  return sharedWorker
}

async function getLangPath(): Promise<string> {
  const country = await getIpCountry()
  return country.toLowerCase() === 'cn' ? TESSERACT_LANGS_DOWNLOAD_URL_CN : ''
}

async function getCacheDir(): Promise<string> {
  const cacheDir = path.join(app.getPath('userData'), 'tesseract')
  await fs.promises.mkdir(cacheDir, { recursive: true })
  return cacheDir
}
