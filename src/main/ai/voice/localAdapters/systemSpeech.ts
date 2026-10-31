import { application } from '@application'
import { SystemSpeechError } from '@cherrystudio/system-speech/contracts'
import { SystemSpeechNativeClient } from '@cherrystudio/system-speech/native'
import { UtilityProcessError } from '@main/core/utilityProcess/UtilityProcessError'

import { VoiceRuntimeError } from '../VoiceRuntimeError'

export function nativeClient(timeoutMs?: number): SystemSpeechNativeClient {
  return new SystemSpeechNativeClient({ helperPath: application.getPath('feature.voice.helper_file'), timeoutMs })
}

export function normalizeFailure(error: unknown, signal?: AbortSignal): VoiceRuntimeError {
  if (signal?.aborted) return new VoiceRuntimeError('aborted')
  if (error instanceof VoiceRuntimeError) return error
  if (
    error instanceof UtilityProcessError &&
    typeof error.remote?.code === 'string' &&
    ['VOICE_AUDIO_INVALID', 'VOICE_AUDIO_UNSUPPORTED', 'VOICE_AUDIO_LIMIT'].includes(error.remote?.code ?? '')
  )
    return new VoiceRuntimeError('invalid_audio')
  if (error instanceof SystemSpeechError) {
    switch (error.code) {
      case 'cancelled':
        return new VoiceRuntimeError('aborted')
      case 'unsupported_locale':
      case 'unsupported_os':
        return new VoiceRuntimeError('unsupported')
      case 'asset_required':
        return new VoiceRuntimeError('asset_required')
      case 'voice_unavailable':
        return new VoiceRuntimeError('voice_unavailable')
      case 'timeout':
        return new VoiceRuntimeError('timeout')
      case 'invalid_request':
        return new VoiceRuntimeError('invalid_request')
    }
  }
  return new VoiceRuntimeError('operation_failed')
}
