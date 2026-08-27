import path from 'node:path'

import type { OcrModelPaths } from '@main/ai/inference/inferenceProtocol'
import { bundleFile, bundleForCapability, localModelRegistry } from '@main/ai/localModel'

/**
 * On-disk path helpers for the local PaddleOCR model (PP-OCRv6 medium via
 * ppu-paddle-ocr). The model identity (repos, files, checksums) lives in the local
 * model catalog; this module derives the absolute paths the OCR processor works with.
 */

export function ocrModelPaths(): OcrModelPaths {
  const bundle = bundleForCapability('ocr')
  const dir = localModelRegistry.bundleInstallDir(bundle)
  const filePath = (key: string) => path.join(dir, bundleFile(bundle, key).relPath)
  return {
    detection: filePath('detection'),
    recognition: filePath('recognition'),
    charactersDictionary: filePath('dictionary')
  }
}
