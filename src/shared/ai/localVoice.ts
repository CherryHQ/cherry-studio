import { MODALITY, MODEL_CAPABILITY, type Model } from '@shared/data/types/model'

export const APPLE_ASR_MODEL_ID = 'local-voice::apple-system-asr' as const
export const APPLE_TTS_MODEL_ID = 'local-voice::apple-system-tts' as const
export const FUNASR_MODEL_ID = 'local-voice::funasr-nano' as const

export const LOCAL_VOICE_MODEL_IDS = [APPLE_ASR_MODEL_ID, APPLE_TTS_MODEL_ID, FUNASR_MODEL_ID] as const
export type LocalVoiceModelId = (typeof LOCAL_VOICE_MODEL_IDS)[number]
export type LocalSpeechModelId = typeof APPLE_TTS_MODEL_ID
export type LocalTranscriptionModelId = typeof APPLE_ASR_MODEL_ID | typeof FUNASR_MODEL_ID

export interface LocalVoiceModelFacts {
  readonly id: LocalVoiceModelId
  readonly providerId: 'local-voice'
  readonly name: string
  readonly capabilities: Readonly<Model['capabilities']>
  readonly inputModalities: Readonly<NonNullable<Model['inputModalities']>>
  readonly outputModalities: Readonly<NonNullable<Model['outputModalities']>>
  readonly supportsStreaming: false
}

export const LOCAL_VOICE_MODELS: readonly LocalVoiceModelFacts[] = Object.freeze([
  Object.freeze({
    id: APPLE_ASR_MODEL_ID,
    providerId: 'local-voice',
    name: 'Apple System ASR',
    capabilities: Object.freeze([MODEL_CAPABILITY.AUDIO_TRANSCRIPT]),
    inputModalities: Object.freeze([MODALITY.AUDIO]),
    outputModalities: Object.freeze([MODALITY.TEXT]),
    supportsStreaming: false
  }),
  Object.freeze({
    id: APPLE_TTS_MODEL_ID,
    providerId: 'local-voice',
    name: 'Apple System TTS',
    capabilities: Object.freeze([MODEL_CAPABILITY.AUDIO_GENERATION]),
    inputModalities: Object.freeze([MODALITY.TEXT]),
    outputModalities: Object.freeze([MODALITY.AUDIO]),
    supportsStreaming: false
  }),
  Object.freeze({
    id: FUNASR_MODEL_ID,
    providerId: 'local-voice',
    name: 'FunASR Nano',
    capabilities: Object.freeze([MODEL_CAPABILITY.AUDIO_TRANSCRIPT]),
    inputModalities: Object.freeze([MODALITY.AUDIO]),
    outputModalities: Object.freeze([MODALITY.TEXT]),
    supportsStreaming: false
  })
])

/** A recommendation only: unavailable resources never change an explicit selection. */
export function resolveDefaultAsrModel(
  platform: { platform: string; majorVersion?: number },
  explicitModelId?: LocalTranscriptionModelId
): LocalTranscriptionModelId | undefined {
  if (explicitModelId !== undefined) return explicitModelId
  if (
    platform.platform !== 'darwin' ||
    platform.majorVersion === undefined ||
    !Number.isInteger(platform.majorVersion) ||
    platform.majorVersion <= 0
  ) {
    return undefined
  }
  return platform.majorVersion >= 13 ? APPLE_ASR_MODEL_ID : undefined
}
