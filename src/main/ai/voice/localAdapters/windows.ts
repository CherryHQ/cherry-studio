import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { SpeechModelV3 } from '@ai-sdk/provider'

import type { SpeechOptions } from '@cherrystudio/ai-core'
import { DEFAULT_SPEECH_SPEED, MAX_SPEECH_SPEED, MIN_SPEECH_SPEED, WINDOWS_TTS_MODEL_ID } from '@shared/ai/localVoice'

import type { LocalVoiceStatus } from '../localAdapters'
import { VoiceRuntimeError } from '../VoiceRuntimeError'
import { checkAbort, nativeClient, normalizeFailure, withScratch } from './nativeSupport'

function supportsWindows(): boolean {
  return process.platform === 'win32' && process.arch === 'x64'
}

export async function listWindowsVoices(signal?: AbortSignal) {
  checkAbort(signal)
  if (!supportsWindows()) return []
  try {
    return (await nativeClient().request({ operation: 'capabilities', locale: 'en-US' }, { signal })).result.voices
  } catch (error) {
    throw normalizeFailure(error, signal)
  }
}

export async function getWindowsVoiceStatus(
  options: { language?: string; voice?: string },
  signal?: AbortSignal
): Promise<LocalVoiceStatus> {
  checkAbort(signal)
  if (!supportsWindows()) return { status: 'unsupported', reason: 'unsupported' }
  try {
    const voices = await listWindowsVoices(signal)
    const matchingVoice = voices.some(
      (voice) =>
        (!options.voice || voice.id === options.voice) &&
        (!options.language || voice.locale.replaceAll('_', '-').toLowerCase() === options.language.toLowerCase())
    )
    return matchingVoice ? { status: 'ready' } : { status: 'not_installed', reason: 'voice_unavailable' }
  } catch (error) {
    const normalized = normalizeFailure(error, signal)
    if (normalized.reason === 'aborted') throw normalized
    return { status: 'failed', reason: normalized.reason }
  }
}

export function createWindowsSpeechModel(options: SpeechOptions): SpeechModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'local-voice',
    modelId: WINDOWS_TTS_MODEL_ID,
    async doGenerate(input) {
      const speed = options.speed ?? DEFAULT_SPEECH_SPEED
      if (
        !Number.isFinite(speed) ||
        speed < MIN_SPEECH_SPEED ||
        speed > MAX_SPEECH_SPEED ||
        (input.outputFormat !== undefined && input.outputFormat !== 'wav')
      )
        throw new VoiceRuntimeError('invalid_request')
      const status = await getWindowsVoiceStatus(options, input.abortSignal)
      if (status.status !== 'ready') throw new VoiceRuntimeError(status.reason ?? 'operation_failed')
      return withScratch(async (directory) => {
        const outputPath = join(directory, 'output.wav')
        await nativeClient().request(
          { operation: 'synthesize', voiceId: options.voice, text: input.text, outputPath, speed },
          { signal: input.abortSignal }
        )
        checkAbort(input.abortSignal)
        const audio = new Uint8Array(await readFile(outputPath))
        checkAbort(input.abortSignal)
        return { audio, warnings: [], response: { timestamp: new Date(), modelId: WINDOWS_TTS_MODEL_ID } }
      }, input.abortSignal)
    }
  }
}
