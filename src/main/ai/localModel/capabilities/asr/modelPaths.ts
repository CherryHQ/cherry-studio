import path from 'node:path'

import type { LocalModelBundleId } from '@shared/data/presets/localModel'

import { bundleFile, getModelBundle } from '../../catalog/catalog'
import { localModelStorageService } from '../../installation/LocalModelStorageService'
import { AsrEngine, type AsrModelConfig } from './protocol'

export function resolveAsrModelPaths(modelId: LocalModelBundleId): AsrModelConfig {
  const bundle = getModelBundle(modelId)
  if (bundle.capability !== 'asr') throw new Error('Unsupported ASR model configuration')
  const dir = localModelStorageService.resolveInstalledDir(bundle)
  const artifactsReady = bundle.requires.every((id) => localModelStorageService.isArtifactReady(id))
  if (!dir || !artifactsReady) throw new Error('the local speech recognition model is not fully downloaded')
  if (bundle.runtime?.architecture === 'qwen3-asr') return { engine: AsrEngine.Mlx, modelDir: dir }
  if (bundle.runtime?.architecture !== 'funasr-nano') throw new Error('Unsupported ASR model configuration')
  const filePath = (key: string) => path.join(dir, bundleFile(bundle, key).relPath)
  return {
    engine: AsrEngine.Sherpa,
    modelPaths: {
      encoder: filePath('encoder'),
      llm: filePath('llm'),
      embedding: filePath('embedding'),
      tokenizerDir: path.dirname(filePath('tokenizerVocab')),
      voiceActivityDetector: filePath('voiceActivityDetector')
    }
  }
}
