import path from 'node:path'

import { bundleFile, bundleForCapability } from '../../catalog/catalog'
import { localModelStorageService } from '../../installation/LocalModelStorageService'
import type { AsrModelPaths } from './protocol'

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
