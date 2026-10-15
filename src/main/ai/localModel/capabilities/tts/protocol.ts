import type { UtilityProcessMethod } from '@main/core/utilityProcess/types'

export interface TtsSynthesizeInput {
  text: string
  voice: string
  language: string
  speed: number
  outputPath: string
}

export type TtsInferenceContract = {
  methods: {
    synthesize: UtilityProcessMethod<TtsSynthesizeInput & { modelDir: string }, void>
  }
}

export interface TtsInitData {
  runtimePath: string
}

export interface MlxAudioChunk {
  samples: Float32Array
  sampleRate: number
  channels: number
  startSample: number
  segmentIndex: number
}

export interface MlxTtsModel {
  capabilities: { sampleRate: number; channels: number }
  synthesizeStream(
    text: string,
    options: { voice: string; language: string; signal: AbortSignal; maxDurationSeconds: number }
  ): AsyncIterable<MlxAudioChunk> & {
    completed: Promise<{ finishReason: 'eos' | 'length' }>
    cancel(): void
  }
  dispose(): Promise<void>
}

/** The API exported by the pinned, downloadable runtime.cjs artifact. */
export interface MlxTtsRuntime {
  loadTtsModel(modelDir: string): Promise<MlxTtsModel>
  changeAudioSpeed(source: AsyncIterable<MlxAudioChunk>, speed: number): AsyncIterable<MlxAudioChunk>
  WavWriter: {
    open(
      path: string,
      sampleRate: number,
      channels: number
    ): Promise<{ write(chunk: MlxAudioChunk): Promise<void>; close(): Promise<void> }>
  }
}
