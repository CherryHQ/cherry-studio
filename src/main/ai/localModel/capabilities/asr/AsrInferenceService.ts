import { Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { type AsrInferenceContract, asrInferenceProcess } from '../../runtime/inferenceProcess'
import { InferenceServiceBase } from '../../runtime/InferenceServiceBase'
import { resolveAsrModelPaths } from './modelPaths'
import type { AsrSegment, AsrTranscribeSource } from './protocol'

/** Local speech recognition (Fun-ASR-Nano via sherpa-onnx) in its own utility process. */
@Injectable('AsrInferenceService')
@ServicePhase(Phase.WhenReady)
export class AsrInferenceService extends InferenceServiceBase<AsrInferenceContract> {
  constructor() {
    super(asrInferenceProcess, 'asr', true)
  }

  /**
   * Transcribe speech out of process; loads the model first if not cached.
   *
   * @returns the joined transcript plus the segments it was assembled from, each with
   *   its position in the source audio (empty when no speech was found, so callers never
   *   branch on null).
   */
  async transcribe(
    source: AsrTranscribeSource,
    signal?: AbortSignal
  ): Promise<{ text: string; segments: AsrSegment[] }> {
    return this.run('transcribe', { modelPaths: resolveAsrModelPaths(), source }, { signal })
  }
}
