import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { SpeechModelV3 } from '@ai-sdk/provider'

import { application } from '@application'
import type { SpeechOptions } from '@cherrystudio/ai-core'
import { UtilityProcessError } from '@main/core/utilityProcess/UtilityProcessError'
import { regionService } from '@main/services/RegionService'
import {
  DEFAULT_SPEECH_SPEED,
  SHERPA_VOICE_SUPPORTED_PLATFORM_KEYS,
  KOKORO_TTS_BUNDLE_ID,
  KOKORO_TTS_MODEL_ID,
  LOCAL_VOICE_MODELS,
  MAX_SPEECH_SPEED,
  MIN_SPEECH_SPEED,
  VoiceModelSupport,
  VoiceResourceOperation,
  type LocalSpeechVoice
} from '@shared/ai/localVoice'
import { LOCAL_MODEL_STATUS_CACHE_KEY } from '@shared/data/presets/localModel'

import type { LocalVoiceStatus, SpeechModelDefinition } from '../voiceModelTypes'
import type { VoiceEnvironment } from '../voicePlatform'
import { checkAbort, VoiceRuntimeError } from '../VoiceRuntimeError'
import { withScratch } from './scratch'
import { completeSpeechOperation } from './sdkOperations'

const LANGUAGES = ['zh-CN', 'en-US', 'en-GB'] as const
const VOICES: LocalSpeechVoice[] = [
  'af_maple',
  'af_sol',
  'bf_vale',
  ...Array.from({ length: 55 }, (_, index) => `zf_${String(index + 1).padStart(3, '0')}`),
  ...Array.from({ length: 45 }, (_, index) => `zm_${String(index + 1).padStart(3, '0')}`)
].map((id) => ({
  id,
  name: id,
  locale: id.startsWith('z') ? 'zh-CN' : id.startsWith('b') ? 'en-GB' : 'en-US',
  languages: LANGUAGES
}))

export function kokoroTtsSupport(environment: VoiceEnvironment) {
  if (!['darwin', 'linux', 'win32'].includes(environment.platform)) return VoiceModelSupport.UnsupportedPlatform
  return SHERPA_VOICE_SUPPORTED_PLATFORM_KEYS.some((key) => key === `${environment.platform}-${environment.arch}`)
    ? VoiceModelSupport.Supported
    : VoiceModelSupport.UnsupportedArchitecture
}

export function getKokoroTtsStatus(signal?: AbortSignal): LocalVoiceStatus {
  checkAbort(signal)
  const { status } = application.get('LocalModelService').refreshStatus(KOKORO_TTS_BUNDLE_ID)
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
          application.get('CacheService').getShared(LOCAL_MODEL_STATUS_CACHE_KEY)?.[KOKORO_TTS_BUNDLE_ID]?.percent ?? 0
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

export function createKokoroSpeechModel(options: SpeechOptions): SpeechModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'local-voice',
    modelId: KOKORO_TTS_MODEL_ID,
    async doGenerate(input) {
      checkAbort(input.abortSignal)
      const speaker = VOICES.findIndex((voice) => voice.id === options.voice)
      const language = options.language ?? VOICES[speaker]?.locale
      const speed = options.speed ?? DEFAULT_SPEECH_SPEED
      if (
        speaker < 0 ||
        !LANGUAGES.some((locale) => locale === language) ||
        !Number.isFinite(speed) ||
        speed < MIN_SPEECH_SPEED ||
        speed > MAX_SPEECH_SPEED ||
        (input.outputFormat !== undefined && input.outputFormat !== 'wav')
      )
        throw new VoiceRuntimeError('invalid_request')
      const status = getKokoroTtsStatus(input.abortSignal)
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
                KOKORO_TTS_BUNDLE_ID,
                { text: input.text, voice: String(speaker), language, speed, outputPath },
                signal
              )
          } catch (error) {
            if (timeout.aborted && !input.abortSignal?.aborted) throw new VoiceRuntimeError('timeout')
            throw error
          }
          checkAbort(input.abortSignal)
          const audio = new Uint8Array(await readFile(outputPath))
          checkAbort(input.abortSignal)
          return { audio, warnings: [], response: { timestamp: new Date(), modelId: KOKORO_TTS_MODEL_ID } }
        },
        input.abortSignal,
        normalizeFailure
      )
    }
  }
}

export const kokoroSpeechDefinition: SpeechModelDefinition = {
  id: KOKORO_TTS_MODEL_ID,
  adapterId: 'sherpa',
  support: kokoroTtsSupport,
  describe: () => ({
    ...LOCAL_VOICE_MODELS.find((model) => model.id === KOKORO_TTS_MODEL_ID)!,
    localeSelection: null,
    resourceOperations: [
      VoiceResourceOperation.Download,
      VoiceResourceOperation.CancelDownload,
      VoiceResourceOperation.Remove
    ]
  }),
  status: (_options, signal) => getKokoroTtsStatus(signal),
  speechOperations: [completeSpeechOperation(createKokoroSpeechModel)],
  voices: async (signal) => {
    checkAbort(signal)
    return VOICES
  },
  getDefaultVoice: async (language, signal) => {
    checkAbort(signal)
    if (language && !LANGUAGES.some((locale) => locale === language)) return null
    return VOICES.find((voice) => voice.locale === language) ?? VOICES[0]
  },
  download: () =>
    application
      .get('LocalModelService')
      .download(KOKORO_TTS_BUNDLE_ID, async () => ((await regionService.isInChina()) ? 'china-first' : 'global-first'))
      .catch(() => {
        throw new VoiceRuntimeError('download_failed')
      }),
  cancelDownload: () => application.get('LocalModelService').cancel(KOKORO_TTS_BUNDLE_ID),
  remove: () => application.get('LocalModelService').remove(KOKORO_TTS_BUNDLE_ID)
}
