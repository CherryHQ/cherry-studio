import { existsSync } from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import type { OcrModelPaths } from '@main/ai/inference/inferenceProtocol'

/**
 * PP-OCRv6 small — the in-process local OCR model (PaddleOCR via ppu-paddle-ocr).
 * Three files (~31MB total) downloaded on demand to the managed model dir; the
 * inference worker is then pointed at their absolute paths.
 */

const REPO = 'PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models'
const BRANCH = 'main'

/** A downloadable model file: where it lands and where to fetch it from. */
interface OcrModelFile {
  fileName: string
  /** Candidate URLs tried in order — China-reachable mirrors first. */
  urls: string[]
  /** Reject smaller downloads (LFS pointers are ~132 bytes; error pages are tiny). */
  minBytes: number
  /** Relative download weight for the aggregate progress bar (≈ file MB). */
  weight: number
}

/**
 * The `.ort` weights are stored with Git LFS, so only `media.githubusercontent.com`
 * serves the real bytes — jsDelivr/raw return the ~132-byte LFS pointer. The plain
 * dictionary text is not LFS, so jsDelivr (reachable where raw.githubusercontent is
 * not) is tried first with raw as a fallback.
 */
export const OCR_MODEL_FILES: Record<keyof OcrModelPaths, OcrModelFile> = {
  detection: {
    fileName: 'PP-OCRv6_small_det.ort',
    urls: [`https://media.githubusercontent.com/media/${REPO}/${BRANCH}/detection/ort/PP-OCRv6_small_det.ort`],
    minBytes: 1_000_000,
    weight: 10
  },
  recognition: {
    fileName: 'PP-OCRv6_small_rec.ort',
    urls: [`https://media.githubusercontent.com/media/${REPO}/${BRANCH}/recognition/ort/PP-OCRv6_small_rec.ort`],
    minBytes: 1_000_000,
    weight: 21
  },
  charactersDictionary: {
    fileName: 'ppocrv6_dict.txt',
    urls: [
      `https://cdn.jsdelivr.net/gh/${REPO}@${BRANCH}/recognition/ppocrv6_dict.txt`,
      `https://raw.githubusercontent.com/${REPO}/${BRANCH}/recognition/ppocrv6_dict.txt`
    ],
    minBytes: 1_000,
    weight: 1
  }
}

export function ocrModelDir(): string {
  return application.getPath('feature.ocr.paddleocr')
}

export function ocrModelPaths(): OcrModelPaths {
  const dir = ocrModelDir()
  return {
    detection: path.join(dir, OCR_MODEL_FILES.detection.fileName),
    recognition: path.join(dir, OCR_MODEL_FILES.recognition.fileName),
    charactersDictionary: path.join(dir, OCR_MODEL_FILES.charactersDictionary.fileName)
  }
}

/** Whether all three local PaddleOCR model files are present on disk. */
export function isLocalPaddleocrModelDownloaded(): boolean {
  const paths = ocrModelPaths()
  return existsSync(paths.detection) && existsSync(paths.recognition) && existsSync(paths.charactersDictionary)
}
