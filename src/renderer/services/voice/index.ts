export { VoiceDomainError, voiceService } from './VoiceService'
export type {
  CreateRecordingInput,
  InstallTranscriptionAssetInput,
  SpeechInput,
  StartRecordingInput,
  TranscriptionInput,
  VoiceCommandEvent,
  VoiceOperation
} from './VoiceService'
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
