import path from 'node:path'

import { bundleFile, getModelBundle } from '../../catalog/catalog'
import { localModelStorageService } from '../../installation/LocalModelStorageService'
import type { OcrModelPaths } from './protocol'

/**
 * On-disk path helpers for the local PaddleOCR model (PP-OCRv6 medium via
 * ppu-paddle-ocr). The model identity (repos, files, checksums) lives in the local
 * model catalog; this module derives the absolute paths the OCR processor works with.
 */

export function resolveOcrModelPaths(): OcrModelPaths {
  const bundle = getModelBundle('pp-ocrv6-medium')
  const dir = localModelStorageService.resolveInstalledDir(bundle)
  const artifactsReady = bundle.requires.every((id) => localModelStorageService.isArtifactReady(id))
  if (!dir || !artifactsReady) throw new Error('the local OCR model is not fully downloaded')
  const filePath = (key: string) => path.join(dir, bundleFile(bundle, key).relPath)
  return {
    detection: filePath('detection'),
    recognition: filePath('recognition'),
    charactersDictionary: filePath('dictionary')
  }
}
