/** Stable local Voice failures; payloads never carry native/provider errors. */
export const voiceErrorCodes = {
  microphone_permission: 'VOICE_MICROPHONE_PERMISSION',
  microphone_unavailable: 'VOICE_MICROPHONE_UNAVAILABLE',
  microphone_unreadable: 'VOICE_MICROPHONE_UNREADABLE',
  recording_failed: 'VOICE_RECORDING_FAILED',
  unsupported: 'VOICE_UNSUPPORTED',
  asset_required: 'VOICE_ASSET_REQUIRED',
  model_required: 'VOICE_MODEL_REQUIRED',
  download_failed: 'VOICE_DOWNLOAD_FAILED',
  model_load_failed: 'VOICE_MODEL_LOAD_FAILED',
  worker_crashed: 'VOICE_WORKER_CRASHED',
  voice_unavailable: 'VOICE_VOICE_UNAVAILABLE',
  busy: 'VOICE_BUSY',
  forbidden_owner: 'VOICE_FORBIDDEN',
  invalid_audio: 'VOICE_INVALID_AUDIO',
  no_speech: 'VOICE_NO_SPEECH',
  aborted: 'VOICE_ABORTED',
  stopped: 'VOICE_STOPPED',
  invalid_request: 'VOICE_INVALID_REQUEST',
  operation_failed: 'VOICE_OPERATION_FAILED',
  timeout: 'VOICE_TIMEOUT'
} as const

export type VoiceErrorReason = keyof typeof voiceErrorCodes
