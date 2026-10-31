import type {
  LocalSpeechModelId,
  LocalSpeechVoice,
  LocalTranscriptionModelId,
  LocalVoiceModelDescriptor,
  VoiceModelSupport
} from '@shared/ai/localVoice'
import type { LocalModelDownloadResult } from '@shared/data/presets/localModel'
import type { OutputFor } from '@shared/ipc/types'

import type { SpeechOperation, TranscriptionOperation } from './executionTypes'
import type { VoiceEnvironment } from './voicePlatform'

export type LocalVoiceStatus = OutputFor<'ai.voice.model.status'>

interface VoiceModelDefinition {
  download?(): Promise<LocalModelDownloadResult>
  cancelDownload?(): Promise<void>
  remove?(): Promise<{ removed: boolean }>
  adapterId: string
  support(environment: VoiceEnvironment): Exclude<VoiceModelSupport, typeof VoiceModelSupport.UnknownModel>
  describe(environment: VoiceEnvironment): Omit<LocalVoiceModelDescriptor, 'voiceCapabilities'>
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
    readonly transcriptionOperations: readonly TranscriptionOperation[]
    locales(signal?: AbortSignal): Promise<{ supported: string[]; installed: string[] }>
  }

export interface SpeechModelDefinition extends VoiceModelDefinition {
  id: LocalSpeechModelId
  readonly speechOperations: readonly SpeechOperation[]
  getDefaultVoice(language: string | undefined, signal?: AbortSignal): Promise<LocalSpeechVoice | null>
  voices(signal?: AbortSignal): Promise<LocalSpeechVoice[]>
}
