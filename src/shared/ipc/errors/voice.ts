/** Stable local Voice failures; payloads never carry native/provider errors. */
export const voiceErrorCodes = {
  unsupported: 'VOICE_UNSUPPORTED',
  asset_required: 'VOICE_ASSET_REQUIRED',
  model_required: 'VOICE_MODEL_REQUIRED',
  license_unverified: 'VOICE_LICENSE_UNVERIFIED',
  voice_unavailable: 'VOICE_VOICE_UNAVAILABLE',
  busy: 'VOICE_BUSY',
  forbidden_owner: 'VOICE_FORBIDDEN',
  invalid_audio: 'VOICE_INVALID_AUDIO',
  aborted: 'VOICE_ABORTED',
  stopped: 'VOICE_STOPPED',
  invalid_request: 'VOICE_INVALID_REQUEST',
  operation_failed: 'VOICE_OPERATION_FAILED',
  timeout: 'VOICE_TIMEOUT'
} as const

export type VoiceErrorReason = keyof typeof voiceErrorCodes
