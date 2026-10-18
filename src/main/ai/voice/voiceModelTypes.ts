import type { SpeechModelV3, TranscriptionModelV3 } from '@ai-sdk/provider'

import type { SpeechOptions, TranscriptionOptions } from '@cherrystudio/ai-core'
import type {
  LocalSpeechModelId,
  LocalSpeechVoice,
  LocalTranscriptionModelId,
  LocalVoiceModelDescriptor,
  VoiceModelSupport
} from '@shared/ai/localVoice'
import type { LocalModelDownloadResult } from '@shared/data/presets/localModel'
import type { OutputFor } from '@shared/ipc/types'

import type { VoiceEnvironment } from './voicePlatform'

export type LocalVoiceStatus = OutputFor<'ai.voice.model.status'>

interface VoiceModelDefinition {
  download?(): Promise<LocalModelDownloadResult>
  cancelDownload?(): Promise<void>
  remove?(): Promise<{ removed: boolean }>
  adapterId: string
  support(environment: VoiceEnvironment): Exclude<VoiceModelSupport, typeof VoiceModelSupport.UnknownModel>
  describe(environment: VoiceEnvironment): LocalVoiceModelDescriptor
  status(
    options: { language?: string; voice?: string },
    signal?: AbortSignal
  ): LocalVoiceStatus | Promise<LocalVoiceStatus>
}

type TranscriptionResources =
  | {
      installLocale(language: string, signal?: AbortSignal): Promise<unknown>
      download?: never
      cancelDownload?: never
      remove?: never
    }
  | {
      installLocale?: never
      download(): Promise<LocalModelDownloadResult>
      cancelDownload(): Promise<void>
      remove(): Promise<{ removed: boolean }>
    }
  | { installLocale?: never; download?: never; cancelDownload?: never; remove?: never }

export type TranscriptionModelDefinition = VoiceModelDefinition &
  TranscriptionResources & {
    id: LocalTranscriptionModelId
    createModel(options: TranscriptionOptions): TranscriptionModelV3
    locales(signal?: AbortSignal): Promise<{ supported: string[]; installed: string[] }>
  }

export interface SpeechModelDefinition extends VoiceModelDefinition {
  id: LocalSpeechModelId
  createModel(options: SpeechOptions): SpeechModelV3
  getDefaultVoice(language: string | undefined, signal?: AbortSignal): Promise<LocalSpeechVoice | null>
  voices(signal?: AbortSignal): Promise<LocalSpeechVoice[]>
}
