import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { SpeechModelV3, TranscriptionModelV3 } from '@ai-sdk/provider'

import type { SpeechOptions, TranscriptionOptions } from '@cherrystudio/ai-core'
import {
  DEFAULT_SPEECH_SPEED,
  DEFAULT_WINDOWS_ASR_LOCALE,
  MAX_SPEECH_SPEED,
  MIN_SPEECH_SPEED,
  WINDOWS_ASR_MODEL_ID,
  WINDOWS_TTS_MODEL_ID
} from '@shared/ai/localVoice'

import type { LocalVoiceStatus } from '../localAdapters'
import { VoiceRuntimeError } from '../VoiceRuntimeError'
import { checkAbort, decodeVoiceRecording, nativeClient, normalizeFailure, withScratch } from './nativeSupport'

function supportsWindows(): boolean {
  return process.platform === 'win32' && process.arch === 'x64'
}

export async function listWindowsAsrLocales(signal?: AbortSignal) {
  checkAbort(signal)
  if (!supportsWindows()) return { supported: [], installed: [] }
  try {
    return (await nativeClient().request({ operation: 'list_asr_locales' }, { signal })).result
  } catch (error) {
    throw normalizeFailure(error, signal)
  }
}

export async function getWindowsAsrStatus(
  options: { language?: string },
  signal?: AbortSignal
): Promise<LocalVoiceStatus> {
  checkAbort(signal)
  if (!supportsWindows()) return { status: 'unsupported', reason: 'unsupported' }
  try {
    await nativeClient().request(
      { operation: 'probe_asr', locale: options.language ?? DEFAULT_WINDOWS_ASR_LOCALE },
      { signal }
    )
    return { status: 'ready' }
  } catch (error) {
    const normalized = normalizeFailure(error, signal)
    if (normalized.reason === 'aborted') throw normalized
    return { status: normalized.reason === 'unsupported' ? 'unsupported' : 'failed', reason: normalized.reason }
  }
}

export function createWindowsTranscriptionModel(options: TranscriptionOptions): TranscriptionModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'local-voice',
    modelId: WINDOWS_ASR_MODEL_ID,
    async doGenerate(input) {
      if (!(input.audio instanceof Uint8Array) || !['audio/webm', 'audio/webm;codecs=opus'].includes(input.mediaType))
        throw new VoiceRuntimeError('invalid_audio')
      const status = await getWindowsAsrStatus(options, input.abortSignal)
      if (status.status !== 'ready') throw new VoiceRuntimeError(status.reason ?? 'operation_failed')
      return withScratch(async (directory) => {
        const decoded = await decodeVoiceRecording(input.audio as Uint8Array, input.abortSignal)
        checkAbort(input.abortSignal)
        const inputPath = join(directory, 'input.wav')
        await writeFile(inputPath, decoded.wav, { mode: 0o600 })
        const { result } = await nativeClient().request(
          { operation: 'transcribe', locale: options.language ?? DEFAULT_WINDOWS_ASR_LOCALE, inputPath },
          { signal: input.abortSignal }
        )
        checkAbort(input.abortSignal)
        return {
          text: result.text,
          segments: [],
          language: result.locale.replace('_', '-').split('-')[0],
          durationInSeconds: decoded.durationSeconds,
          warnings: [],
          response: { timestamp: new Date(), modelId: WINDOWS_ASR_MODEL_ID }
        }
      }, input.abortSignal)
    }
  }
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
