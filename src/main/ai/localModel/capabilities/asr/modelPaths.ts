import path from 'node:path'

import type { LocalModelBundleId } from '@shared/data/presets/localModel'

import { bundleFile, getModelBundle } from '../../catalog/catalog'
import { localModelStorageService } from '../../installation/LocalModelStorageService'
import type { AsrModelPaths } from './protocol'

export function resolveAsrModelPaths(modelId: LocalModelBundleId): AsrModelPaths {
  const bundle = getModelBundle(modelId)
  if (bundle.capability !== 'asr' || bundle.runtime?.architecture !== 'funasr-nano')
    throw new Error('Unsupported ASR model configuration')
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
