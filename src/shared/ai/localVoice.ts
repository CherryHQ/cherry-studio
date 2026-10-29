import { MODALITY, MODEL_CAPABILITY, type Model } from '@shared/data/types/model'

import type { VoiceCapabilities } from './voice'

export const APPLE_ASR_MODEL_ID = 'local-voice::apple-system-asr' as const
export const APPLE_TTS_MODEL_ID = 'local-voice::apple-system-tts' as const
export const WINDOWS_ASR_MODEL_ID = 'local-voice::windows-system-asr' as const
export const WINDOWS_TTS_MODEL_ID = 'local-voice::windows-system-tts' as const
export const QWEN3_TTS_MODEL_ID = 'local-voice::qwen3-tts-0.6b-customvoice' as const
export const QWEN3_TTS_BUNDLE_ID = 'qwen3-tts-0.6b-customvoice-8bit' as const
export const KOKORO_TTS_MODEL_ID = 'local-voice::kokoro-v1.1' as const
export const KOKORO_TTS_BUNDLE_ID = 'kokoro-multi-lang-v1.1' as const
export const DOWNLOADABLE_SPEECH_BUNDLES = {
  [QWEN3_TTS_MODEL_ID]: QWEN3_TTS_BUNDLE_ID,
  [KOKORO_TTS_MODEL_ID]: KOKORO_TTS_BUNDLE_ID
} as const

export interface LocalSpeechVoice {
  id: string
  name: string
  locale: string
  languages?: readonly string[]
}

export const QWEN3_ASR_MODEL_ID = 'local-voice::qwen3-asr-1.7b' as const
export const QWEN3_ASR_BUNDLE_ID = 'qwen3-asr-1.7b-8bit' as const

export const FUNASR_BUNDLE_ID = 'funasr-nano-int8' as const
export const FUNASR_MODEL_ID = 'local-voice::funasr-nano' as const
export const DOWNLOADABLE_TRANSCRIPTION_BUNDLES = {
  [FUNASR_MODEL_ID]: FUNASR_BUNDLE_ID,
  [QWEN3_ASR_MODEL_ID]: QWEN3_ASR_BUNDLE_ID
} as const
export const SHERPA_VOICE_SUPPORTED_PLATFORM_KEYS = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-arm64',
  'win32-x64'
] as const
export const FUNASR_SUPPORTED_PLATFORM_KEYS = SHERPA_VOICE_SUPPORTED_PLATFORM_KEYS

export const DEFAULT_APPLE_ASR_LOCALE = 'en-US'
export const DEFAULT_WINDOWS_ASR_LOCALE = 'en-US'

export const MIN_SPEECH_SPEED = 0.5
export const MAX_SPEECH_SPEED = 2
export const DEFAULT_SPEECH_SPEED = 1

export const VOICE_SESSION_SOURCES = ['settings', 'dictation', 'playback', 'automation'] as const
export type VoiceSessionSource = (typeof VOICE_SESSION_SOURCES)[number]

export const VOICE_SESSION_TRIGGERS = ['manual', 'auto_read'] as const
export type VoiceSessionTrigger = (typeof VOICE_SESSION_TRIGGERS)[number]

export const LOCAL_VOICE_MODEL_IDS = [
  APPLE_ASR_MODEL_ID,
  APPLE_TTS_MODEL_ID,
  WINDOWS_ASR_MODEL_ID,
  WINDOWS_TTS_MODEL_ID,
  FUNASR_MODEL_ID,
  QWEN3_ASR_MODEL_ID,
  QWEN3_TTS_MODEL_ID,
  KOKORO_TTS_MODEL_ID
] as const
export type LocalVoiceModelId = (typeof LOCAL_VOICE_MODEL_IDS)[number]
export type LocalSpeechModelId =
  | typeof APPLE_TTS_MODEL_ID
  | typeof WINDOWS_TTS_MODEL_ID
  | typeof QWEN3_TTS_MODEL_ID
  | typeof KOKORO_TTS_MODEL_ID
export type LocalTranscriptionModelId =
  | typeof APPLE_ASR_MODEL_ID
  | typeof WINDOWS_ASR_MODEL_ID
  | typeof FUNASR_MODEL_ID
  | typeof QWEN3_ASR_MODEL_ID

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
    id: QWEN3_ASR_MODEL_ID,
    providerId: 'local-voice',
    name: 'Qwen3-ASR 1.7B (8-bit)',
    capabilities: Object.freeze([MODEL_CAPABILITY.AUDIO_TRANSCRIPT]),
    inputModalities: Object.freeze([MODALITY.AUDIO]),
    outputModalities: Object.freeze([MODALITY.TEXT]),
    supportsStreaming: false
  }),
  Object.freeze({
    id: KOKORO_TTS_MODEL_ID,
    providerId: 'local-voice',
    name: 'Kokoro v1.1 (Chinese + English)',
    capabilities: Object.freeze([MODEL_CAPABILITY.AUDIO_GENERATION]),
    inputModalities: Object.freeze([MODALITY.TEXT]),
    outputModalities: Object.freeze([MODALITY.AUDIO]),
    supportsStreaming: false
  }),
  Object.freeze({
    id: QWEN3_TTS_MODEL_ID,
    providerId: 'local-voice',
    name: 'Qwen3-TTS 0.6B CustomVoice',
    capabilities: Object.freeze([MODEL_CAPABILITY.AUDIO_GENERATION]),
    inputModalities: Object.freeze([MODALITY.TEXT]),
    outputModalities: Object.freeze([MODALITY.AUDIO]),
    supportsStreaming: false
  }),
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
    id: WINDOWS_ASR_MODEL_ID,
    providerId: 'local-voice',
    name: 'Windows System ASR',
    capabilities: Object.freeze([MODEL_CAPABILITY.AUDIO_TRANSCRIPT]),
    inputModalities: Object.freeze([MODALITY.AUDIO]),
    outputModalities: Object.freeze([MODALITY.TEXT]),
    supportsStreaming: false
  }),
  Object.freeze({
    id: WINDOWS_TTS_MODEL_ID,
    providerId: 'local-voice',
    name: 'Windows System TTS',
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

export const TranscriptionLanguageSource = {
  ModelDefault: 'model-default',
  Interface: 'interface',
  Explicit: 'explicit'
} as const

export const VoiceResourceOperation = {
  InstallLocale: 'install-locale',
  Download: 'download',
  CancelDownload: 'cancel-download',
  Remove: 'remove'
} as const
export type VoiceResourceOperation = (typeof VoiceResourceOperation)[keyof typeof VoiceResourceOperation]

export const VoiceModelSupport = {
  Supported: 'supported',
  UnknownModel: 'unknown-model',
  UnsupportedPlatform: 'unsupported-platform',
  UnsupportedArchitecture: 'unsupported-architecture',
  UnsupportedVersion: 'unsupported-version'
} as const
export type VoiceModelSupport = (typeof VoiceModelSupport)[keyof typeof VoiceModelSupport]

export interface LocalVoiceModelDescriptor extends LocalVoiceModelFacts {
  readonly voiceCapabilities: VoiceCapabilities
  readonly localeSelection: { readonly defaultLocale: string } | null
  readonly resourceOperations: readonly VoiceResourceOperation[]
}

export type VoiceModelLookup =
  | { support: typeof VoiceModelSupport.UnknownModel; model: null }
  | { support: Exclude<VoiceModelSupport, typeof VoiceModelSupport.UnknownModel>; model: LocalVoiceModelDescriptor }

export function isTranscriptionModelId(value: string): value is LocalTranscriptionModelId {
  return LOCAL_VOICE_MODELS.some(
    (model) => model.id === value && model.capabilities.includes(MODEL_CAPABILITY.AUDIO_TRANSCRIPT)
  )
}

export function isSpeechModelId(value: string): value is LocalSpeechModelId {
  return LOCAL_VOICE_MODELS.some(
    (model) => model.id === value && model.capabilities.includes(MODEL_CAPABILITY.AUDIO_GENERATION)
  )
}
