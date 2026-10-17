import type { SpeechOptions, SpeechResult, TranscriptionOptions, TranscriptionResult } from '@cherrystudio/ai-core'
import type { LocalSpeechModelId, LocalTranscriptionModelId } from '@shared/ai/localVoice'
import type {
  SpeechInputKind,
  SpeechOutputKind,
  SpeechPcmFormat,
  SpeechPcmChunk,
  TranscriptionInputKind,
  TranscriptionOutputKind
} from '@shared/ai/voice'

export interface VoiceExecution {
  /** Settles after execution-owned cleanup; does not wait for playback or unload shared models. */
  readonly closed: Promise<void>
  /** Idempotently aborts work and waits for cleanup, propagating cleanup failures. */
  cancel(): Promise<void>
}

export type SpeechSource =
  | (SpeechResult & { readonly kind: typeof SpeechOutputKind.Audio })
  | {
      readonly kind: typeof SpeechOutputKind.PcmStream
      readonly format: SpeechPcmFormat
      readonly chunks: AsyncIterable<SpeechPcmChunk>
    }

type SpeechSourceByKind = { [Source in SpeechSource as Source['kind']]: Source }

export interface SpeechExecution<Output extends SpeechOutputKind = SpeechOutputKind> extends VoiceExecution {
  readonly output: Promise<SpeechSourceByKind[Output]>
  /** Producer completion is independent of playback completion. */
  readonly completed: Promise<void>
}

export interface TranscriptRevision {
  readonly revision: number
  readonly text: string
  readonly provisionalStart: number
  readonly final: boolean
}

export interface TranscriptionExecution extends VoiceExecution {
  readonly updates: AsyncIterable<TranscriptRevision>
  readonly completed: Promise<TranscriptionResult>
}

export interface SpeechRequest {
  readonly modelId: LocalSpeechModelId
  readonly input: { readonly kind: typeof SpeechInputKind.Text; readonly text: string }
  readonly output: SpeechOutputKind
  readonly options: Readonly<SpeechOptions>
}

export interface TranscriptionRequest {
  readonly modelId: LocalTranscriptionModelId
  readonly input: { readonly kind: typeof TranscriptionInputKind.Audio; readonly audio: Uint8Array }
  readonly output: typeof TranscriptionOutputKind.Final
  readonly options: Readonly<TranscriptionOptions>
}

export type SpeechOperation = {
  [Output in SpeechOutputKind]: {
    readonly input: SpeechRequest['input']['kind']
    readonly output: Output
    start(
      input: SpeechRequest['input'],
      options: Readonly<SpeechOptions>,
      signal?: AbortSignal
    ): SpeechExecution<Output>
  }
}[SpeechOutputKind]

export interface TranscriptionOperation {
  readonly input: TranscriptionRequest['input']['kind']
  readonly output: TranscriptionRequest['output']
  start(
    input: TranscriptionRequest['input'],
    options: Readonly<TranscriptionOptions>,
    signal?: AbortSignal
  ): TranscriptionExecution
}
