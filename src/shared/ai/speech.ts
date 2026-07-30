import type { UniqueModelId } from '@shared/data/types/model'

export type SpeechDeliveryTier = 'realtime' | 'composed' | 'text-only'

export interface SpeechModelSelection {
  uniqueModelId: UniqueModelId
  providerId: string
  modelId: string
  name: string
}

export interface SpeechCapabilities {
  realtime: boolean
  transcription: boolean
  synthesis: boolean
  chat: boolean
  audioEvaluation: boolean
}

export interface ResolvedSpeechCapabilities {
  capabilities: SpeechCapabilities
  tier: SpeechDeliveryTier
  models: {
    realtime: SpeechModelSelection | null
    transcription: SpeechModelSelection | null
    synthesis: SpeechModelSelection | null
    chat: SpeechModelSelection | null
    audioEvaluation: SpeechModelSelection | null
  }
  gaps: Array<
    | 'realtime_unavailable'
    | 'transcription_unavailable'
    | 'synthesis_unavailable'
    | 'chat_unavailable'
    | 'audio_evaluation_unavailable'
  >
}

export interface SpeechTranscriptSegment {
  text: string
  startSecond: number
  endSecond: number
}

export interface SpeechTranscriptionResult {
  text: string
  segments: SpeechTranscriptSegment[]
  language: string | null
  durationInSeconds: number | null
  model: SpeechModelSelection
}

export interface SpeechSynthesisResult {
  audioBase64: string
  mediaType: string
  format: string
  model: SpeechModelSelection
}

export interface PronunciationDiagnosis {
  source: 'audio' | 'transcript_only'
  pronunciation: string
  stress: string
  intonation: string
  pace: string
  wordLevelNotes: Array<{
    word: string
    issue: string
    suggestion: string
  }>
}

export interface SpokenEvaluationResult {
  correctedText: string
  modelAnswer: string
  feedback: string[]
  omissions: string[]
  additions: string[]
  pronunciation: PronunciationDiagnosis
  textSimilarity: number
  model: SpeechModelSelection
}

export interface ScenarioTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface ScenarioReplyResult {
  reply: string
  corrections: string[]
  usedTargets: string[]
  feedback: string[]
  shouldEnd: boolean
  model: SpeechModelSelection
}

export interface RealtimeSessionAnswer {
  sdp: string
  model: SpeechModelSelection
}
