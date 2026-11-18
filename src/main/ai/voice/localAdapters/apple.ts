import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { SpeechModelV3, TranscriptionModelV3 } from '@ai-sdk/provider'

import type { SpeechOptions, TranscriptionOptions } from '@cherrystudio/ai-core'
import { SystemSpeechError } from '@cherrystudio/system-speech/contracts'
import { loggerService } from '@logger'
import { UtilityProcessError } from '@main/core/utilityProcess/UtilityProcessError'
import { LOCAL_VOICE_MODELS, VoiceModelSupport, VoiceResourceOperation } from '@shared/ai/localVoice'
import {
  APPLE_ASR_MODEL_ID,
  APPLE_TTS_MODEL_ID,
  DEFAULT_APPLE_ASR_LOCALE,
  DEFAULT_SPEECH_SPEED,
  MAX_SPEECH_SPEED,
  MIN_SPEECH_SPEED
} from '@shared/ai/localVoice'
import { SpeechInputKind, SpeechOutputKind } from '@shared/ai/voice'

import type { SpeechOperation } from '../executionTypes'
import type { TranscriptionModelDefinition, SpeechModelDefinition } from '../voiceModelTypes'
import type { LocalVoiceStatus } from '../voiceModelTypes'
import { getVoiceEnvironment, type VoiceEnvironment } from '../voicePlatform'
import { checkAbort, VoiceRuntimeError } from '../VoiceRuntimeError'
import { inspectCanonicalWav } from './inspectCanonicalWav'
import { decodeVoiceRecording } from './recordingDecoder'
import { withScratch } from './scratch'
import { completeSpeechOperation, completeTranscriptionOperation } from './sdkOperations'
import { nativeClient, normalizeFailure } from './systemSpeech'

const logger = loggerService.withContext('AppleVoiceAdapter')

function supportsApple(): boolean {
  return appleSupport(getVoiceEnvironment()) === VoiceModelSupport.Supported
}

function supportsAppleAssetInstall(): boolean {
  return supportsApple() && (getVoiceEnvironment().majorVersion ?? 0) >= 26
}

function normalizeAppleFailure(error: unknown, signal?: AbortSignal): VoiceRuntimeError {
  const normalized = normalizeFailure(error, signal)
  if (signal?.aborted || error instanceof VoiceRuntimeError) return normalized
  if (error instanceof SystemSpeechError) {
    if (error.code !== 'cancelled') logger.warn('Apple voice operation failed', { stage: 'native', code: error.code })
  } else if (error instanceof UtilityProcessError && normalized.reason === 'invalid_audio') {
    logger.warn('Apple voice operation failed', { stage: 'decode', code: error.remote?.code })
  } else {
    logger.warn('Apple voice operation failed', { stage: 'adapter', code: 'operation_failed' })
  }
  return normalized
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
    const normalized = normalizeAppleFailure(error, signal)
    if (normalized.reason === 'aborted') throw normalized
    return { status: 'failed', reason: normalized.reason }
  }
}

async function getDefaultAppleVoice(language: string | undefined, signal?: AbortSignal) {
  checkAbort(signal)
  if (!supportsApple()) return null
  try {
    return (await nativeClient().request({ operation: 'resolve_voice', locale: language }, { signal })).result.voice
  } catch (error) {
    throw normalizeAppleFailure(error, signal)
  }
}

export async function listAppleVoices(signal?: AbortSignal) {
  checkAbort(signal)
  if (!supportsApple()) return []
  try {
    return (await nativeClient().request({ operation: 'capabilities', locale: DEFAULT_APPLE_ASR_LOCALE }, { signal }))
      .result.voices
  } catch (error) {
    throw normalizeAppleFailure(error, signal)
  }
}

export async function listAppleAsrLocales(signal?: AbortSignal) {
  checkAbort(signal)
  if (!supportsApple()) return { supported: [], installed: [] }
  try {
    return (await nativeClient().request({ operation: 'list_asr_locales' }, { signal })).result
  } catch (error) {
    throw normalizeAppleFailure(error, signal)
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
    throw normalizeAppleFailure(error, signal)
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
      return withScratch(
        async (directory) => {
          const outputPath = join(directory, 'output.wav')
          await nativeClient().request(
            { operation: 'synthesize', voiceId: options.voice, text: input.text, outputPath, speed },
            { signal: input.abortSignal }
          )
          checkAbort(input.abortSignal)
          const audio = new Uint8Array(await readFile(outputPath))
          checkAbort(input.abortSignal)
          return { audio, warnings: [], response: { timestamp: new Date(), modelId: APPLE_TTS_MODEL_ID } }
        },
        input.abortSignal,
        normalizeAppleFailure
      )
    }
  }
}

export function createAppleTranscriptionModel(options: TranscriptionOptions): TranscriptionModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'local-voice',
    modelId: APPLE_ASR_MODEL_ID,
    async doGenerate(input) {
      if (!(input.audio instanceof Uint8Array)) throw new VoiceRuntimeError('invalid_audio')
      const audio = input.audio
      const isWebm = ['audio/webm', 'audio/webm;codecs=opus'].includes(input.mediaType)
      const wavMetadata = input.mediaType === 'audio/wav' ? inspectCanonicalWav(audio) : undefined
      if (!isWebm && !wavMetadata) throw new VoiceRuntimeError('invalid_audio')
      await requireReady(APPLE_ASR_MODEL_ID, options, input.abortSignal)
      return withScratch(
        async (directory) => {
          const decoded = wavMetadata
            ? { wav: audio, durationSeconds: wavMetadata.durationSeconds }
            : await decodeVoiceRecording(audio, input.abortSignal)
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
        },
        input.abortSignal,
        normalizeAppleFailure
      )
    }
  }
}

function appleSupport(environment: VoiceEnvironment) {
  if (environment.platform !== 'darwin') return VoiceModelSupport.UnsupportedPlatform
  if (!Number.isInteger(environment.majorVersion) || (environment.majorVersion ?? 0) < 13)
    return VoiceModelSupport.UnsupportedVersion
  return VoiceModelSupport.Supported
}

export const appleTranscriptionDefinition: TranscriptionModelDefinition = {
  id: APPLE_ASR_MODEL_ID,
  adapterId: 'apple',
  support: appleSupport,
  describe: (environment) => ({
    ...LOCAL_VOICE_MODELS.find((model) => model.id === APPLE_ASR_MODEL_ID)!,
    localeSelection: { defaultLocale: DEFAULT_APPLE_ASR_LOCALE },
    resourceOperations:
      appleSupport(environment) === VoiceModelSupport.Supported && (environment.majorVersion ?? 0) >= 26
        ? [VoiceResourceOperation.InstallLocale]
        : []
  }),
  status: (options, signal) => getAppleVoiceStatus(APPLE_ASR_MODEL_ID, options, signal),
  locales: listAppleAsrLocales,
  installLocale: installAppleAsrAsset,
  transcriptionOperations: [completeTranscriptionOperation(createAppleTranscriptionModel)]
}

const streamingSpeech: SpeechOperation = {
  input: SpeechInputKind.Text,
  output: SpeechOutputKind.PcmStream,
  start(input, options, signal) {
    const controller = new AbortController()
    const lifetime = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    const opened = Promise.resolve().then(async () => {
      const speed = options.speed ?? DEFAULT_SPEECH_SPEED
      if (!Number.isFinite(speed) || speed < MIN_SPEECH_SPEED || speed > MAX_SPEECH_SPEED)
        throw new VoiceRuntimeError('invalid_request')
      await requireReady(APPLE_TTS_MODEL_ID, options, lifetime)
      return nativeClient().stream(
        { operation: 'synthesize_stream', voiceId: options.voice, text: input.text, speed },
        { signal: lifetime }
      )
    })
    const closed = opened.then(
      (stream) => stream.closed,
      () => undefined
    )
    const output = opened
      .then(async (stream) => {
        const source = await stream.output
        return {
          kind: SpeechOutputKind.PcmStream,
          format: source.format,
          chunks: {
            async *[Symbol.asyncIterator]() {
              try {
                yield* source.chunks
              } catch (error) {
                throw normalizeAppleFailure(error, lifetime)
              }
            }
          }
        }
      })
      .catch((error) => {
        throw normalizeAppleFailure(error, lifetime)
      })
    const completed = opened
      .then((stream) => stream.completed)
      .catch((error) => {
        throw normalizeAppleFailure(error, lifetime)
      })
    void output.catch(() => undefined)
    void completed.catch(() => undefined)
    return {
      output,
      completed,
      closed,
      cancel: async () => {
        controller.abort()
        await opened.then(
          (stream) => stream.cancel(),
          () => undefined
        )
      }
    }
  }
}

export const appleSpeechDefinition: SpeechModelDefinition = {
  id: APPLE_TTS_MODEL_ID,
  adapterId: 'apple',
  support: appleSupport,
  describe: () => ({
    ...LOCAL_VOICE_MODELS.find((model) => model.id === APPLE_TTS_MODEL_ID)!,
    localeSelection: null,
    resourceOperations: []
  }),
  status: (options, signal) => getAppleVoiceStatus(APPLE_TTS_MODEL_ID, options, signal),
  voices: listAppleVoices,
  getDefaultVoice: getDefaultAppleVoice,
  speechOperations: [completeSpeechOperation(createAppleSpeechModel), streamingSpeech]
}
