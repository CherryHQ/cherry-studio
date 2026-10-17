import type { UtilityProcessMethod, UtilityProcessStreamMethod } from '@main/core/utilityProcess/types'

export interface TtsSynthesizeInput {
  text: string
  voice: string
  language: string
  speed: number
  outputPath: string
}

export type TtsInferenceContract = {
  methods: {
    synthesize: UtilityProcessMethod<
      TtsSynthesizeInput & { modelDir: string; architecture: 'qwen3-tts' | 'kokoro' },
      void
    >
  }
  streams: {
    synthesize: UtilityProcessStreamMethod<
      Omit<TtsSynthesizeInput, 'outputPath'> & { modelDir: string },
      never,
      | { metadata: { type: 'format'; sampleRate: number; channels: number } }
      | { metadata: { type: 'pcm'; startFrame: number }; payload: Uint8Array },
      { frames: number }
    >
  }
}

export interface TtsInitData {
  appPath: string
  bindingPath: string
  sherpaBindingPath: string
}
