import { existsSync } from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import type { OcrModelPaths } from '@main/ai/inference/inferenceProtocol'
import { LOCAL_MODELS } from '@main/ai/inference/localModelCatalog'

/**
 * On-disk path helpers for the local PaddleOCR model (PP-OCRv6 medium via
 * ppu-paddle-ocr). The model identity (repos, files) lives in the local model
 * catalog; this module derives the absolute paths the OCR processor and the
 * download service work with. All three files download on demand: the
 * detection + recognition weights directly, and the character dictionary
 * parsed from the recognition model's `inference.yml` (see
 * LocalOcrDownloadService) — the `*_onnx` repos don't publish it standalone.
 */

const { weights, dictionary } = LOCAL_MODELS.ocr

export function ocrModelDir(): string {
  return application.getPath('feature.ocr.paddleocr')
}

export function ocrModelPaths(): OcrModelPaths {
  const dir = ocrModelDir()
  return {
    detection: path.join(dir, weights.detection.fileName),
    recognition: path.join(dir, weights.recognition.fileName),
    charactersDictionary: path.join(dir, dictionary.fileName)
  }
}

/** Whether all local PaddleOCR model files (both weights + the dictionary) are on disk. */
export function isLocalPaddleocrModelDownloaded(): boolean {
  const paths = ocrModelPaths()
  return existsSync(paths.detection) && existsSync(paths.recognition) && existsSync(paths.charactersDictionary)
}
