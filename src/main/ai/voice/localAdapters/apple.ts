import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { SpeechModelV3, TranscriptionModelV3 } from '@ai-sdk/provider'

import { application } from '@application'
import type { SpeechOptions, TranscriptionOptions } from '@cherrystudio/ai-core'
import { SystemSpeechError } from '@cherrystudio/system-speech/contracts'
import { SystemSpeechNativeClient } from '@cherrystudio/system-speech/native'
import { UtilityProcessError } from '@main/core/utilityProcess/UtilityProcessError'
import {
  APPLE_ASR_MODEL_ID,
  APPLE_TTS_MODEL_ID,
  DEFAULT_APPLE_ASR_LOCALE,
  DEFAULT_SPEECH_SPEED,
  MAX_SPEECH_SPEED,
  MIN_SPEECH_SPEED
} from '@shared/ai/localVoice'

import type { LocalVoiceStatus } from '../localAdapters'
import { VoiceRuntimeError } from '../VoiceRuntimeError'
import { voiceAudioProcess } from './voiceAudioProcess'

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new VoiceRuntimeError('aborted')
}

function supportsApple(): boolean {
  return process.platform === 'darwin' && Number.parseInt(process.getSystemVersion(), 10) >= 13
}

function supportsAppleAssetInstall(): boolean {
  return supportsApple() && Number.parseInt(process.getSystemVersion(), 10) >= 26
}

function nativeClient(timeoutMs?: number): SystemSpeechNativeClient {
  return new SystemSpeechNativeClient({ helperPath: application.getPath('feature.voice.helper_file'), timeoutMs })
}

function normalizeFailure(error: unknown, signal?: AbortSignal): VoiceRuntimeError {
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

export async function getAppleVoiceStatus(
  modelId: typeof APPLE_ASR_MODEL_ID | typeof APPLE_TTS_MODEL_ID,
  options: { language?: string; voice?: string },
  signal?: AbortSignal
): Promise<LocalVoiceStatus> {
  checkAbort(signal)
  if (!supportsApple()) return { status: 'unsupported', reason: 'unsupported' }
  try {
    const { result } = await nativeClient().request(
      { operation: 'capabilities', locale: options.language ?? DEFAULT_APPLE_ASR_LOCALE },
      { signal }
    )
    if (modelId === APPLE_TTS_MODEL_ID) {
      return (options.voice ? result.voices.some((voice) => voice.id === options.voice) : result.voices.length > 0)
        ? { status: 'ready' }
        : { status: 'not_installed', reason: 'voice_unavailable' }
    }
    switch (result.appleAssetStatus) {
      case 'installed':
        return { status: 'ready' }
      case 'downloading':
        return { status: 'installing', reason: 'asset_required' }
      case 'supported':
        return { status: 'not_installed', reason: 'asset_required' }
      case 'unsupported':
        return { status: 'unsupported', reason: 'unsupported' }
    }
  } catch (error) {
    const normalized = normalizeFailure(error, signal)
    if (normalized.reason === 'aborted') throw normalized
    return { status: 'failed', reason: normalized.reason }
  }
}

export async function listLocalVoices(signal?: AbortSignal) {
  checkAbort(signal)
  if (!supportsApple()) return []
  try {
    return (await nativeClient().request({ operation: 'capabilities', locale: DEFAULT_APPLE_ASR_LOCALE }, { signal }))
      .result.voices
  } catch (error) {
    throw normalizeFailure(error, signal)
  }
}

export async function listAppleAsrLocales(signal?: AbortSignal) {
  checkAbort(signal)
  if (!supportsApple()) return { supported: [], installed: [] }
  try {
    return (await nativeClient().request({ operation: 'list_asr_locales' }, { signal })).result
  } catch (error) {
    throw normalizeFailure(error, signal)
  }
}

export async function installAppleAsrAsset(language: string, signal?: AbortSignal) {
  checkAbort(signal)
  if (!supportsAppleAssetInstall()) throw new VoiceRuntimeError('unsupported')
  try {
    return (
      await nativeClient(600_000).request(
        { operation: 'install_asr_assets', locale: language, confirmDownload: true },
        { signal }
      )
    ).result
  } catch (error) {
    throw normalizeFailure(error, signal)
  }
}

async function requireReady(
  modelId: typeof APPLE_ASR_MODEL_ID | typeof APPLE_TTS_MODEL_ID,
  options: { language?: string; voice?: string },
  signal?: AbortSignal
): Promise<void> {
  const state = await getAppleVoiceStatus(modelId, options, signal)
  if (state.status !== 'ready') throw new VoiceRuntimeError(state.reason ?? 'operation_failed')
}

async function withScratch<T>(operation: (directory: string) => Promise<T>, signal?: AbortSignal): Promise<T> {
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

export function createAppleSpeechModel(options: SpeechOptions): SpeechModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'local-voice',
    modelId: APPLE_TTS_MODEL_ID,
    async doGenerate(input) {
      const speed = options.speed ?? DEFAULT_SPEECH_SPEED
      if (
        !Number.isFinite(speed) ||
        speed < MIN_SPEECH_SPEED ||
        speed > MAX_SPEECH_SPEED ||
        (input.outputFormat !== undefined && input.outputFormat !== 'wav')
      )
        throw new VoiceRuntimeError('invalid_request')
      await requireReady(APPLE_TTS_MODEL_ID, options, input.abortSignal)
      return withScratch(async (directory) => {
        const outputPath = join(directory, 'output.wav')
        await nativeClient().request(
          { operation: 'synthesize', voiceId: options.voice, text: input.text, outputPath, speed },
          { signal: input.abortSignal }
        )
        checkAbort(input.abortSignal)
        const audio = new Uint8Array(await readFile(outputPath))
        checkAbort(input.abortSignal)
        return { audio, warnings: [], response: { timestamp: new Date(), modelId: APPLE_TTS_MODEL_ID } }
      }, input.abortSignal)
    }
  }
}

export function createAppleTranscriptionModel(options: TranscriptionOptions): TranscriptionModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'local-voice',
    modelId: APPLE_ASR_MODEL_ID,
    async doGenerate(input) {
      if (!(input.audio instanceof Uint8Array) || !['audio/webm', 'audio/webm;codecs=opus'].includes(input.mediaType))
        throw new VoiceRuntimeError('invalid_audio')
      await requireReady(APPLE_ASR_MODEL_ID, options, input.abortSignal)
      return withScratch(async (directory) => {
        const timeout = AbortSignal.timeout(30_000)
        const signal = input.abortSignal ? AbortSignal.any([input.abortSignal, timeout]) : timeout
        const decoded = await application
          .get('UtilityProcessManager')
          .client(voiceAudioProcess)
          .request('decode', { audio: input.audio as Uint8Array, mimeType: 'audio/webm;codecs=opus' }, { signal })
          .catch((error: unknown) => {
            if (timeout.aborted && !input.abortSignal?.aborted) throw new VoiceRuntimeError('timeout')
            throw error
          })
        checkAbort(input.abortSignal)
        const inputPath = join(directory, 'input.wav')
        await writeFile(inputPath, decoded.wav, { mode: 0o600 })
        const { result } = await nativeClient().request(
          { operation: 'transcribe', locale: options.language ?? DEFAULT_APPLE_ASR_LOCALE, inputPath },
          { signal: input.abortSignal }
        )
        checkAbort(input.abortSignal)
        return {
          text: result.text,
          segments: [],
          language: result.locale.replace('_', '-').split('-')[0],
          durationInSeconds: decoded.durationSeconds,
          warnings: [],
          response: { timestamp: new Date(), modelId: APPLE_ASR_MODEL_ID }
        }
      }, input.abortSignal)
    }
  }
}
