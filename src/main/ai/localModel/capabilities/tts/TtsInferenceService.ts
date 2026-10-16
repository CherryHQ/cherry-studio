import { application } from '@application'
import { Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { defineUtilityProcess } from '@main/core/utilityProcess/defineUtilityProcess'
import type { LocalModelBundleId } from '@shared/data/presets/localModel'

import { getModelBundle } from '../../catalog/catalog'
import { localModelStorageService } from '../../installation/LocalModelStorageService'
import { InferenceServiceBase } from '../../runtime/InferenceServiceBase'
import type { TtsInferenceContract, TtsInitData, TtsSynthesizeInput } from './protocol'

export const ttsInferenceProcess = defineUtilityProcess<TtsInferenceContract, TtsInitData>({
  id: 'inference.tts',
  entry: 'inference-tts',
  cancellation: 'terminate',
  idleTimeoutMs: 60_000,
  createEnv: () => ({ TTS_MLX_CACHE_LIMIT: '2' }),
  createInitData: () => ({
    appPath: application.getPath('app.root'),
    bindingPath: localModelStorageService.artifactPath('mlx-node'),
    sherpaBindingPath: localModelStorageService.artifactPath('sherpa-onnx')
  })
})

@Injectable('TtsInferenceService')
@ServicePhase(Phase.WhenReady)
export class TtsInferenceService extends InferenceServiceBase<TtsInferenceContract> {
  constructor() {
    super(ttsInferenceProcess, 'tts')
  }

  async synthesize(modelId: LocalModelBundleId, input: TtsSynthesizeInput, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    await this.run(
      modelId,
      'synthesize',
      () => {
        const bundle = getModelBundle(modelId)
        const architecture = bundle.runtime?.architecture
        if (bundle.capability !== 'tts' || (architecture !== 'qwen3-tts' && architecture !== 'kokoro'))
          throw new Error('Unsupported speech model')
        const modelDir = localModelStorageService.resolveInstalledDir(bundle)
        if (!modelDir || !bundle.requires.every((id) => localModelStorageService.isArtifactReady(id)))
          throw new Error('The selected speech model is not fully downloaded')
        return { ...input, modelDir, architecture }
      },
      { signal }
    )
  }
}
