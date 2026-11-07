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
  const architecture = bundle.runtime?.architecture
  if (architecture === 'qwen3-asr') return { engine: AsrEngine.Mlx, modelDir: dir }
  const filePath = (key: string) => path.join(dir, bundleFile(bundle, key).relPath)
  const voiceActivityDetector = filePath('voiceActivityDetector')
  if (architecture === 'nemo-transducer')
    return {
      engine: AsrEngine.Sherpa,
      modelPaths: {
        kind: 'nemo-transducer',
        encoder: filePath('encoder'),
        decoder: filePath('decoder'),
        joiner: filePath('joiner'),
        tokens: filePath('tokens'),
        voiceActivityDetector
      }
    }
  if (architecture !== 'funasr-nano') throw new Error('Unsupported ASR model configuration')
  return {
    engine: AsrEngine.Sherpa,
    modelPaths: {
      kind: 'funasr-nano',
      encoder: filePath('encoder'),
      llm: filePath('llm'),
      embedding: filePath('embedding'),
      tokenizerDir: path.dirname(filePath('tokenizerVocab')),
      voiceActivityDetector
    }
  }
}
