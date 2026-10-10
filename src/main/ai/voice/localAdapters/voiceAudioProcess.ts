import { defineUtilityProcess } from '@main/core/utilityProcess/defineUtilityProcess'
import type { UtilityProcessMethod } from '@main/core/utilityProcess/types'

export interface VoiceAudioInput {
  audio: Uint8Array
  mimeType: string
}

export interface VoiceAudioResult {
  wav: Uint8Array
  sampleRate: 16000
  channels: 1
  durationSeconds: number
}

export type VoiceAudioContract = {
  methods: { decode: UtilityProcessMethod<VoiceAudioInput, VoiceAudioResult> }
}

export const voiceAudioProcess = defineUtilityProcess<VoiceAudioContract>({
  id: 'voice.audio',
  entry: 'voice-audio',
  cancellation: 'terminate',
  idleTimeoutMs: 60_000
})
