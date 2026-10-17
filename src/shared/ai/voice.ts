export const SpeechInputKind = { Text: 'text' } as const
export type SpeechInputKind = (typeof SpeechInputKind)[keyof typeof SpeechInputKind]

export const SpeechOutputKind = { Audio: 'audio' } as const
export type SpeechOutputKind = (typeof SpeechOutputKind)[keyof typeof SpeechOutputKind]

export const TranscriptionInputKind = { Audio: 'audio' } as const
export type TranscriptionInputKind = (typeof TranscriptionInputKind)[keyof typeof TranscriptionInputKind]

export const TranscriptionOutputKind = { Final: 'final' } as const
export type TranscriptionOutputKind = (typeof TranscriptionOutputKind)[keyof typeof TranscriptionOutputKind]

export interface VoiceCapabilities {
  readonly speech?: readonly { readonly input: SpeechInputKind; readonly output: SpeechOutputKind }[]
  readonly transcription?: readonly {
    readonly input: TranscriptionInputKind
    readonly output: TranscriptionOutputKind
  }[]
}
