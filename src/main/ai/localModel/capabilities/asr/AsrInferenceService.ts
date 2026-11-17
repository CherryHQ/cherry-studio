import { Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { LocalModelBundleId } from '@shared/data/presets/localModel'

import { CPU_LOCAL_INFERENCE_PROFILE } from '../../runtime/inferenceAcceleration'
import { type AsrInferenceContract, defineInferenceProcess } from '../../runtime/inferenceProcess'
import { InferenceServiceBase } from '../../runtime/InferenceServiceBase'
import { resolveAsrModelPaths } from './modelPaths'
import { AsrEngine, type AsrSegment, type AsrTranscribeSource } from './protocol'

export const asrInferenceProcess = defineInferenceProcess<AsrInferenceContract>({
  artifacts: ['sherpa-onnx', 'mlx-node'],
  id: 'inference.asr',
  entry: 'inference-asr',
  resolveRuntimeProfile: () => CPU_LOCAL_INFERENCE_PROFILE
})

@Injectable('AsrInferenceService')
@ServicePhase(Phase.WhenReady)
export class AsrInferenceService extends InferenceServiceBase<AsrInferenceContract> {
  constructor() {
    super(asrInferenceProcess, 'asr')
  }

  stream(modelId: LocalModelBundleId, sampleRate: number, signal: AbortSignal) {
    return this.openStream(
      modelId,
      'transcribe',
      () => {
        const model = resolveAsrModelPaths(modelId)
        if (model.engine !== AsrEngine.Mlx) throw new Error('Unsupported streaming ASR model')
        return { modelDir: model.modelDir, sampleRate }
      },
      {
        signal,
        input: { maxFrameBytes: 8192, maxBufferedBytes: 65536, maxBufferedFrames: 10, maxPendingWrites: 1 },
        output: { maxFrameBytes: 262144, maxBufferedBytes: 524288, maxBufferedFrames: 2, maxPendingWrites: 1 }
      }
    )
  }

  async transcribe(
    modelId: LocalModelBundleId,
    source: AsrTranscribeSource,
    signal?: AbortSignal
  ): Promise<{ text: string; segments: AsrSegment[] }> {
    return this.run(
      modelId,
      'transcribe',
      () => {
        const model = resolveAsrModelPaths(modelId)
        if (model.engine === AsrEngine.Mlx) {
          if (source.kind !== 'samples') throw new Error('MLX ASR requires decoded PCM')
          return { ...model, source }
        }
        return { ...model, source }
      },
      { signal }
    )
  }
}
