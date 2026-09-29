import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { application } from '@application'
import { SystemSpeechError } from '@cherrystudio/system-speech/contracts'
import { SystemSpeechNativeClient } from '@cherrystudio/system-speech/native'
import { UtilityProcessError } from '@main/core/utilityProcess/UtilityProcessError'

import { VoiceRuntimeError } from '../VoiceRuntimeError'

export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new VoiceRuntimeError('aborted')
}

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

export async function withScratch<T>(operation: (directory: string) => Promise<T>, signal?: AbortSignal): Promise<T> {
  checkAbort(signal)
  const directory = join(application.getPath('feature.voice.temp'), randomUUID())
  try {
    await mkdir(directory, { mode: 0o700 })
    checkAbort(signal)
    return await operation(directory)
  } catch (error) {
    throw normalizeFailure(error, signal)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
