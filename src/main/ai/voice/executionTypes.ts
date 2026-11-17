import type { SpeechOptions, SpeechResult, TranscriptionOptions, TranscriptionResult } from '@cherrystudio/ai-core'
import type { LocalSpeechModelId, LocalTranscriptionModelId } from '@shared/ai/localVoice'
import type {
  SpeechTextEvent,
  TranscriptRevision,
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

export type { TranscriptRevision } from '@shared/ai/voice'

export interface TranscriptionExecution extends VoiceExecution {
  readonly ready?: Promise<void>
  readonly updates: AsyncIterable<TranscriptRevision>
  readonly completed: Promise<TranscriptionResult>
}

export interface SpeechRequest {
  readonly modelId: LocalSpeechModelId
  readonly input:
    | { readonly kind: typeof SpeechInputKind.Text; readonly text: string }
    | { readonly kind: typeof SpeechInputKind.TextStream; readonly events: AsyncIterable<SpeechTextEvent> }
  readonly output: SpeechOutputKind
  readonly options: Readonly<SpeechOptions>
}

export interface TranscriptionRequest {
  readonly modelId: LocalTranscriptionModelId
  readonly input:
    | { readonly kind: typeof TranscriptionInputKind.Audio; readonly audio: Uint8Array }
    | {
        readonly kind: typeof TranscriptionInputKind.PcmStream
        readonly format: SpeechPcmFormat
        readonly chunks: AsyncIterable<SpeechPcmChunk>
      }
  readonly output: TranscriptionOutputKind
  readonly options: Readonly<TranscriptionOptions>
}

export type SpeechOperation = {
  [Kind in SpeechInputKind]: {
    [Output in SpeechOutputKind]: {
      readonly input: Kind
      readonly output: Output
      start(
        input: Extract<SpeechRequest['input'], { kind: Kind }>,
        options: Readonly<SpeechOptions>,
        signal?: AbortSignal
      ): SpeechExecution<Output>
    }
  }[SpeechOutputKind]
}[SpeechInputKind]

export type TranscriptionOperation = {
  [Kind in TranscriptionInputKind]: {
    readonly input: Kind
    readonly output: Kind extends typeof TranscriptionInputKind.Audio
      ? typeof TranscriptionOutputKind.Final
      : typeof TranscriptionOutputKind.Revisions
    start(
      input: Extract<TranscriptionRequest['input'], { kind: Kind }>,
      options: Readonly<TranscriptionOptions>,
      signal?: AbortSignal
    ): TranscriptionExecution
  }
}[TranscriptionInputKind]
