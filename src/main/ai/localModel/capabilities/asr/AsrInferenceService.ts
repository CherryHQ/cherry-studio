import { Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { type AsrInferenceContract, asrInferenceProcess } from '../../runtime/inferenceProcess'
import { InferenceServiceBase } from '../../runtime/InferenceServiceBase'
import { resolveAsrModelPaths } from './modelPaths'
import type { AsrSegment, AsrTranscribeSource } from './protocol'

@Injectable('AsrInferenceService')
@ServicePhase(Phase.WhenReady)
export class AsrInferenceService extends InferenceServiceBase<AsrInferenceContract> {
  constructor() {
    super(asrInferenceProcess, 'asr', true)
  }

  async transcribe(
    source: AsrTranscribeSource,
    signal?: AbortSignal
  ): Promise<{ text: string; segments: AsrSegment[] }> {
    return this.run('transcribe', { modelPaths: resolveAsrModelPaths(), source }, { signal })
  }
}
