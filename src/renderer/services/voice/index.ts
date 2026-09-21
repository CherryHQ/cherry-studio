export { VoiceDomainError, voiceService } from './VoiceService'
export { voiceTargetManager } from './VoiceTargetManager'
export type {
  CapturedVoiceTarget,
  VoiceReplaceRange,
  VoiceTargetInsertResult,
  VoiceTargetRegistration
} from './VoiceTargetManager'
export {
  chunkReadableText,
  normalizeReadableText,
  planReadableText,
  READABLE_TEXT_CHUNK_LIMIT,
  READABLE_TEXT_CONFIRMATION_THRESHOLD,
  SPEECH_ADAPTER_TEXT_LIMIT
} from './readableText'
export type { ReadableTextMode, ReadableTextPlan, ReadableTextTrigger } from './readableText'
export { dictationService } from './DictationService'
export type { DictationErrorCategory, DictationPhase, DictationSnapshot } from './DictationService'
export { speechPlaybackService } from './SpeechPlaybackService'
export type {
  SpeechPlaybackPhase,
  SpeechPlaybackSnapshot,
  SpeechPlaybackSourceLabel,
  SpeechPlaybackStartInput,
  SpeechPlaybackStartResult
} from './SpeechPlaybackService'
export { readMessageAloud } from './messagePlayback'
export type { ReadMessageAloudInput } from './messagePlayback'
export { autoReadCoordinator } from './AutoReadCoordinator'
export type { AutoReadCompletion, AutoReadResult } from './AutoReadCoordinator'
