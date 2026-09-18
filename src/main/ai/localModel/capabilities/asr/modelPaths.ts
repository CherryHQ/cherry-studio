import path from 'node:path'

import { bundleFile, bundleForCapability } from '../../catalog/catalog'
import { localModelStorageService } from '../../installation/LocalModelStorageService'
import type { AsrModelPaths } from './protocol'

/**
 * On-disk path helpers for the local speech model (Fun-ASR-Nano via sherpa-onnx). The
 * model identity (repos, files, checksums) lives in the local model catalog; this module
 * derives the absolute paths the recognizer is configured with.
 */

export function resolveAsrModelPaths(): AsrModelPaths {
  const bundle = bundleForCapability('asr')
  const dir = localModelStorageService.resolveInstalledDir(bundle)
  const artifactsReady = bundle.requires.every((id) => localModelStorageService.isArtifactReady(id))
  if (!dir || !artifactsReady) throw new Error('the local speech recognition model is not fully downloaded')
  const filePath = (key: string) => path.join(dir, bundleFile(bundle, key).relPath)
  return {
    encoder: filePath('encoder'),
    llm: filePath('llm'),
    embedding: filePath('embedding'),
    tokenizerDir: path.dirname(filePath('tokenizerVocab')),
    voiceActivityDetector: filePath('voiceActivityDetector')
  }
}
