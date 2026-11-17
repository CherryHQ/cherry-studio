export const SpeechInputKind = { Text: 'text', TextStream: 'text-stream' } as const
export type SpeechInputKind = (typeof SpeechInputKind)[keyof typeof SpeechInputKind]

export const SpeechOutputKind = { Audio: 'audio', PcmStream: 'pcm-stream' } as const
export type SpeechOutputKind = (typeof SpeechOutputKind)[keyof typeof SpeechOutputKind]

export interface SpeechPcmFormat {
  readonly sampleRate: number
  readonly channels: number
}

export interface SpeechPcmChunk {
  readonly startFrame: number
  readonly samples: Float32Array
}

export interface SpeechStreamIdentity {
  readonly sessionId: string
  readonly requestId: string
  readonly attemptId: number
}

export type SpeechStreamEvent = SpeechStreamIdentity &
  ({ readonly type: 'pcm'; readonly chunk: SpeechPcmChunk } | { readonly type: 'end'; readonly frames: number })

export const TranscriptionInputKind = { Audio: 'audio', PcmStream: 'pcm-stream' } as const
export type TranscriptionInputKind = (typeof TranscriptionInputKind)[keyof typeof TranscriptionInputKind]

export const TranscriptionOutputKind = { Final: 'final', Revisions: 'revisions' } as const
export type TranscriptionOutputKind = (typeof TranscriptionOutputKind)[keyof typeof TranscriptionOutputKind]

export interface VoiceCapabilities {
  readonly speech?: readonly { readonly input: SpeechInputKind; readonly output: SpeechOutputKind }[]
  readonly transcription?: readonly {
    readonly input: TranscriptionInputKind
    readonly output: TranscriptionOutputKind
  }[]
}

export interface TranscriptRevision {
  readonly revision: number
  readonly text: string
  readonly provisionalStart: number
  readonly final: boolean
}

export type TranscriptionStreamEvent = { readonly sessionId: string; readonly requestId: string } & (
  | { readonly type: 'ready' }
  | { readonly type: 'revision'; readonly update: TranscriptRevision }
)

export const SPEECH_TEXT_STREAM_LIMIT = 5_000
export type SpeechTextEvent = { readonly type: 'text'; readonly text: string } | { readonly type: 'flush' }
