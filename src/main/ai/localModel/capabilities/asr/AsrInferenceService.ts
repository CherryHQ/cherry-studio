import { Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { CPU_LOCAL_INFERENCE_PROFILE } from '../../runtime/inferenceAcceleration'
import { type AsrInferenceContract, defineInferenceProcess } from '../../runtime/inferenceProcess'
import { InferenceServiceBase } from '../../runtime/InferenceServiceBase'
import { resolveAsrModelPaths } from './modelPaths'
import type { AsrSegment, AsrTranscribeSource } from './protocol'

export const asrInferenceProcess = defineInferenceProcess<AsrInferenceContract>({
  capability: 'asr',
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

  async transcribe(
    source: AsrTranscribeSource,
    signal?: AbortSignal
  ): Promise<{ text: string; segments: AsrSegment[] }> {
    return this.run('transcribe', { modelPaths: resolveAsrModelPaths(), source }, { signal })
  }
}
