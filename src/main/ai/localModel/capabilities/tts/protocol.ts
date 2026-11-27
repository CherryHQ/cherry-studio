import type { UtilityProcessMethod, UtilityProcessStreamMethod } from '@main/core/utilityProcess/types'
import type { SpeechTextEvent } from '@shared/ai/voice'

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
      Omit<TtsSynthesizeInput, 'outputPath' | 'text'> & { modelDir: string; text?: string },
      { metadata: SpeechTextEvent },
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
