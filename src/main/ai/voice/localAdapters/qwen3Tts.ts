import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { SpeechModelV3 } from '@ai-sdk/provider'

import { application } from '@application'
import type { SpeechOptions } from '@cherrystudio/ai-core'
import { UtilityProcessError } from '@main/core/utilityProcess/UtilityProcessError'
import { regionService } from '@main/services/RegionService'
import {
  DEFAULT_SPEECH_SPEED,
  LOCAL_VOICE_MODELS,
  MAX_SPEECH_SPEED,
  MIN_SPEECH_SPEED,
  QWEN3_TTS_BUNDLE_ID,
  QWEN3_TTS_MODEL_ID,
  VoiceResourceOperation,
  type LocalSpeechVoice
} from '@shared/ai/localVoice'
import { SpeechInputKind, SpeechOutputKind } from '@shared/ai/voice'
import { LOCAL_MODEL_STATUS_CACHE_KEY } from '@shared/data/presets/localModel'

import type { SpeechExecution, SpeechSource, SpeechRequest } from '../executionTypes'
import type { LocalVoiceStatus, SpeechModelDefinition } from '../voiceModelTypes'
import { mlxVoiceSupport } from '../voicePlatform'
import { checkAbort, VoiceRuntimeError } from '../VoiceRuntimeError'
import { withScratch } from './scratch'
import { completeSpeechOperation } from './sdkOperations'

const LANGUAGES: Record<string, string> = {
  'zh-CN': 'chinese',
  'en-US': 'english',
  'ja-JP': 'japanese',
  'ko-KR': 'korean',
  'de-DE': 'german',
  'fr-FR': 'french',
  'ru-RU': 'russian',
  'pt-PT': 'portuguese',
  'es-ES': 'spanish',
  'it-IT': 'italian'
}
const VOICES: LocalSpeechVoice[] = [
  ['vivian', 'Vivian', 'zh-CN'],
  ['serena', 'Serena', 'zh-CN'],
  ['uncle_fu', 'Uncle Fu', 'zh-CN'],
  ['dylan', 'Dylan', 'zh-CN'],
  ['eric', 'Eric', 'zh-CN'],
  ['ryan', 'Ryan', 'en-US'],
  ['aiden', 'Aiden', 'en-US'],
  ['ono_anna', 'Ono Anna', 'ja-JP'],
  ['sohee', 'Sohee', 'ko-KR']
].map(([id, name, locale]) => ({ id, name, locale, languages: Object.keys(LANGUAGES) }))

export function getQwen3TtsStatus(signal?: AbortSignal): LocalVoiceStatus {
  checkAbort(signal)
  const { status } = application.get('LocalModelService').refreshStatus(QWEN3_TTS_BUNDLE_ID)
  switch (status) {
    case 'ready':
      return { status: 'ready' }
    case 'not_downloaded':
      return { status: 'not_installed', reason: 'model_required' }
    case 'downloading':
      return {
        status: 'installing',
        reason: 'model_required',
        percent:
          application.get('CacheService').getShared(LOCAL_MODEL_STATUS_CACHE_KEY)?.[QWEN3_TTS_BUNDLE_ID]?.percent ?? 0
      }
    case 'error':
      return { status: 'failed', reason: 'download_failed' }
    case 'unsupported':
      return { status: 'unsupported', reason: 'unsupported' }
  }
}

function normalizeFailure(error: unknown, signal?: AbortSignal): VoiceRuntimeError {
  if (signal?.aborted) return new VoiceRuntimeError('aborted')
  if (error instanceof VoiceRuntimeError) return error
  if (error instanceof UtilityProcessError) {
    if (error.code === 'PROCESS_BLOCKED') return new VoiceRuntimeError('busy')
    if (error.remote?.code === 'TTS_MODEL_LOAD_FAILED') return new VoiceRuntimeError('model_load_failed')
    if (
      ['PROCESS_START_FAILED', 'PROCESS_EXITED', 'PROCESS_PROTOCOL_ERROR', 'PROCESS_CIRCUIT_OPEN'].includes(error.code)
    )
      return new VoiceRuntimeError('worker_crashed')
  }
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'TTS_MODEL_LOAD_FAILED')
    return new VoiceRuntimeError('model_load_failed')
  return new VoiceRuntimeError('operation_failed')
}

export function createQwen3SpeechModel(options: SpeechOptions): SpeechModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'local-voice',
    modelId: QWEN3_TTS_MODEL_ID,
    async doGenerate(input) {
      checkAbort(input.abortSignal)
      const voice = VOICES.find((voice) => voice.id === options.voice)
      const language = options.language ?? voice?.locale
      const speed = options.speed ?? DEFAULT_SPEECH_SPEED
      if (
        !voice ||
        !language ||
        !LANGUAGES[language] ||
        !Number.isFinite(speed) ||
        speed < MIN_SPEECH_SPEED ||
        speed > MAX_SPEECH_SPEED ||
        (input.outputFormat !== undefined && input.outputFormat !== 'wav')
      )
        throw new VoiceRuntimeError('invalid_request')
      const status = getQwen3TtsStatus(input.abortSignal)
      if (status.status !== 'ready') throw new VoiceRuntimeError(status.reason ?? 'model_required')
      return withScratch(
        async (directory) => {
          const outputPath = join(directory, 'speech.wav')
          const timeout = AbortSignal.timeout(120_000)
          const signal = input.abortSignal ? AbortSignal.any([timeout, input.abortSignal]) : timeout
          try {
            await application
              .get('TtsInferenceService')
              .synthesize(
                QWEN3_TTS_BUNDLE_ID,
                { text: input.text, voice: voice.id, language: LANGUAGES[language], speed, outputPath },
                signal
              )
          } catch (error) {
            if (timeout.aborted && !input.abortSignal?.aborted) throw new VoiceRuntimeError('timeout')
            throw error
          }
          checkAbort(input.abortSignal)
          const audio = new Uint8Array(await readFile(outputPath))
          checkAbort(input.abortSignal)
          return { audio, warnings: [], response: { timestamp: new Date(), modelId: QWEN3_TTS_MODEL_ID } }
        },
        input.abortSignal,
        normalizeFailure
      )
    }
  }
}

function startPcmSpeech(
  input: SpeechRequest['input'],
  options: SpeechOptions,
  signal?: AbortSignal
): SpeechExecution<typeof SpeechOutputKind.PcmStream> {
  const controller = new AbortController()
  const loadingTimeout = setTimeout(() => controller.abort(new VoiceRuntimeError('timeout')), 120_000)
  loadingTimeout.unref()
  const lifetime = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  const opened = Promise.resolve().then(() => {
    checkAbort(lifetime)
    const voice = VOICES.find((voice) => voice.id === options.voice)
    const language = options.language ?? voice?.locale
    const speed = options.speed ?? DEFAULT_SPEECH_SPEED
    if (
      !voice ||
      !language ||
      !LANGUAGES[language] ||
      !Number.isFinite(speed) ||
      speed < MIN_SPEECH_SPEED ||
      speed > MAX_SPEECH_SPEED
    )
      throw new VoiceRuntimeError('invalid_request')
    return application.get('TtsInferenceService').stream(
      QWEN3_TTS_BUNDLE_ID,
      {
        ...(input.kind === SpeechInputKind.Text && { text: input.text }),
        voice: voice.id,
        language: LANGUAGES[language],
        speed
      },
      lifetime
    )
  })
  const feeding = opened
    .then(async (stream) => {
      if (input.kind === SpeechInputKind.TextStream) {
        for await (const event of input.events) {
          checkAbort(lifetime)
          await stream.write({ metadata: event })
        }
      }
      await stream.finishInput()
    })
    .catch((error) => {
      controller.abort(error)
      throw error
    })
  void feeding.catch(() => undefined)
  const closed = opened.then(
    (stream) => stream.closed,
    () => undefined
  )
  const completed = opened
    .then(async (stream) => {
      await Promise.all([feeding, stream.completed])
    })
    .then(() => undefined)
    .catch((error) => {
      throw lifetime.reason instanceof VoiceRuntimeError ? lifetime.reason : normalizeFailure(error, lifetime)
    })
  const output: Promise<Extract<SpeechSource, { kind: typeof SpeechOutputKind.PcmStream }>> = opened
    .then(async (stream) => {
      const iterator = stream.output[Symbol.asyncIterator]()
      const first = await iterator.next()
      if (first.done || first.value.metadata.type !== 'format') throw new VoiceRuntimeError('invalid_audio')
      const { sampleRate, channels } = first.value.metadata
      return {
        kind: SpeechOutputKind.PcmStream,
        format: { sampleRate, channels },
        chunks: {
          async *[Symbol.asyncIterator]() {
            while (true) {
              const item = await iterator.next()
              if (item.done) return
              if (item.value.metadata.type !== 'pcm' || !('payload' in item.value))
                throw new VoiceRuntimeError('invalid_audio')
              const bytes = item.value.payload
              if (bytes.byteLength % 4) throw new VoiceRuntimeError('invalid_audio')
              yield {
                startFrame: item.value.metadata.startFrame,
                samples: new Float32Array(bytes.slice().buffer)
              }
            }
          }
        }
      }
    })
    .catch(async (error) => {
      const failure = lifetime.reason instanceof VoiceRuntimeError ? lifetime.reason : normalizeFailure(error, lifetime)
      controller.abort()
      await closed
      throw failure
    })
    .finally(() => clearTimeout(loadingTimeout))
  void completed.catch(() => undefined)
  void output.catch(() => undefined)
  let cancellation: Promise<void> | undefined
  return {
    output,
    completed,
    closed,
    cancel: () =>
      (cancellation ??= (async () => {
        controller.abort()
        await closed
      })())
  }
}

export const qwen3SpeechDefinition: SpeechModelDefinition = {
  id: QWEN3_TTS_MODEL_ID,
  adapterId: 'mlx',
  support: mlxVoiceSupport,
  describe: () => ({
    ...LOCAL_VOICE_MODELS.find((model) => model.id === QWEN3_TTS_MODEL_ID)!,
    localeSelection: null,
    resourceOperations: [
      VoiceResourceOperation.Download,
      VoiceResourceOperation.CancelDownload,
      VoiceResourceOperation.Remove
    ]
  }),
  status: (_options, signal) => getQwen3TtsStatus(signal),
  speechOperations: [
    completeSpeechOperation(createQwen3SpeechModel),
    { input: SpeechInputKind.Text, output: SpeechOutputKind.PcmStream, start: startPcmSpeech },
    { input: SpeechInputKind.TextStream, output: SpeechOutputKind.PcmStream, start: startPcmSpeech }
  ],
  voices: async (signal) => {
    checkAbort(signal)
    return VOICES
  },
  getDefaultVoice: async (language, signal) => {
    checkAbort(signal)
    if (language && !LANGUAGES[language]) return null
    return VOICES.find((voice) => voice.locale === language) ?? VOICES[0]
  },
  download: () =>
    application
      .get('LocalModelService')
      .download(QWEN3_TTS_BUNDLE_ID, async () => ((await regionService.isInChina()) ? 'china-first' : 'global-first'))
      .catch(() => {
        throw new VoiceRuntimeError('download_failed')
      }),
  cancelDownload: () => application.get('LocalModelService').cancel(QWEN3_TTS_BUNDLE_ID),
  remove: () => application.get('LocalModelService').remove(QWEN3_TTS_BUNDLE_ID)
}
