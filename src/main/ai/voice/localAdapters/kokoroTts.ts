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
  KOKORO_V1_TTS_BUNDLE_ID,
  KOKORO_V1_TTS_MODEL_ID,
  DOWNLOADABLE_SPEECH_BUNDLES,
  QWEN3_TTS_MODEL_ID,
  type LocalSpeechModelId,
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

type SherpaSpeechModelId = Exclude<
  keyof typeof DOWNLOADABLE_SPEECH_BUNDLES & LocalSpeechModelId,
  typeof QWEN3_TTS_MODEL_ID
>
type SherpaSpeechBundleId = (typeof DOWNLOADABLE_SPEECH_BUNDLES)[SherpaSpeechModelId]

/** One downloadable sherpa-onnx speech bundle: its voices, the speaker id each maps to, and its languages. */
export interface SherpaSpeechVariant {
  modelId: SherpaSpeechModelId
  bundleId: SherpaSpeechBundleId
  languages: readonly string[]
  voices: LocalSpeechVoice[]
  /** Speaker id in the release's `voices.bin`, keyed by voice id. */
  speakerIds: ReadonlyMap<string, number>
}

const V1_1_LANGUAGES = ['zh-CN', 'en-US', 'en-GB'] as const
const V1_1_VOICE_IDS = [
  'af_maple',
  'af_sol',
  'bf_vale',
  ...Array.from({ length: 55 }, (_, index) => `zf_${String(index + 1).padStart(3, '0')}`),
  ...Array.from({ length: 45 }, (_, index) => `zm_${String(index + 1).padStart(3, '0')}`)
]
const KOKORO_V1_1: SherpaSpeechVariant = {
  modelId: KOKORO_TTS_MODEL_ID,
  bundleId: KOKORO_TTS_BUNDLE_ID,
  languages: V1_1_LANGUAGES,
  voices: V1_1_VOICE_IDS.map((id) => ({
    id,
    name: id,
    locale: id.startsWith('z') ? 'zh-CN' : id.startsWith('b') ? 'en-GB' : 'en-US',
    languages: V1_1_LANGUAGES
  })),
  speakerIds: new Map(V1_1_VOICE_IDS.map((id, index) => [id, index]))
}

// Speaker ids come from the v1.0 model metadata (`speaker2id`). The native Brazilian voices
// come first; the Spanish and Italian voices read pt-BR phonemes with an accent.
const V1_LANGUAGES = ['pt-BR'] as const
const V1_VOICES = [
  ['pf_dora', 'pf_dora', 42],
  ['pm_alex', 'pm_alex', 43],
  ['pm_santa', 'pm_santa', 44],
  ['ef_dora', 'ef_dora (es)', 28],
  ['if_sara', 'if_sara (it)', 35],
  ['im_nicola', 'im_nicola (it)', 36]
] as const
const KOKORO_V1: SherpaSpeechVariant = {
  modelId: KOKORO_V1_TTS_MODEL_ID,
  bundleId: KOKORO_V1_TTS_BUNDLE_ID,
  languages: V1_LANGUAGES,
  voices: V1_VOICES.map(([id, name]) => ({ id, name, locale: 'pt-BR', languages: V1_LANGUAGES })),
  speakerIds: new Map(V1_VOICES.map(([id, , speaker]) => [id, speaker]))
}

export function kokoroTtsSupport(environment: VoiceEnvironment) {
  if (!['darwin', 'linux', 'win32'].includes(environment.platform)) return VoiceModelSupport.UnsupportedPlatform
  return SHERPA_VOICE_SUPPORTED_PLATFORM_KEYS.some((key) => key === `${environment.platform}-${environment.arch}`)
    ? VoiceModelSupport.Supported
    : VoiceModelSupport.UnsupportedArchitecture
}

export function getKokoroTtsStatus(
  signal?: AbortSignal,
  bundleId: SherpaSpeechBundleId = KOKORO_TTS_BUNDLE_ID
): LocalVoiceStatus {
  checkAbort(signal)
  const { status } = application.get('LocalModelService').refreshStatus(bundleId)
  switch (status) {
    case 'ready':
      return { status: 'ready' }
    case 'not_downloaded':
      return { status: 'not_installed', reason: 'model_required' }
    case 'downloading':
      return {
        status: 'installing',
        reason: 'model_required',
        percent: application.get('CacheService').getShared(LOCAL_MODEL_STATUS_CACHE_KEY)?.[bundleId]?.percent ?? 0
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

export function createVariantSpeechModel(variant: SherpaSpeechVariant, options: SpeechOptions): SpeechModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'local-voice',
    modelId: variant.modelId,
    async doGenerate(input) {
      checkAbort(input.abortSignal)
      const speaker = options.voice === undefined ? undefined : variant.speakerIds.get(options.voice)
      const language = options.language ?? variant.voices.find((voice) => voice.id === options.voice)?.locale
      const speed = options.speed ?? DEFAULT_SPEECH_SPEED
      if (
        speaker === undefined ||
        !language ||
        !variant.languages.some((locale) => locale === language) ||
        !Number.isFinite(speed) ||
        speed < MIN_SPEECH_SPEED ||
        speed > MAX_SPEECH_SPEED ||
        (input.outputFormat !== undefined && input.outputFormat !== 'wav')
      )
        throw new VoiceRuntimeError('invalid_request')
      const status = getKokoroTtsStatus(input.abortSignal, variant.bundleId)
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
                variant.bundleId,
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
          return { audio, warnings: [], response: { timestamp: new Date(), modelId: variant.modelId } }
        },
        input.abortSignal,
        normalizeFailure
      )
    }
  }
}

export function createKokoroSpeechModel(options: SpeechOptions): SpeechModelV3 {
  return createVariantSpeechModel(KOKORO_V1_1, options)
}

export function createKokoroV1SpeechModel(options: SpeechOptions): SpeechModelV3 {
  return createVariantSpeechModel(KOKORO_V1, options)
}

export function createSherpaSpeechDefinition(
  variant: SherpaSpeechVariant,
  createModel: (options: SpeechOptions) => SpeechModelV3
): SpeechModelDefinition {
  return {
    id: variant.modelId,
    adapterId: 'sherpa',
    support: kokoroTtsSupport,
    describe: () => ({
      ...LOCAL_VOICE_MODELS.find((model) => model.id === variant.modelId)!,
      localeSelection: null,
      resourceOperations: [
        VoiceResourceOperation.Download,
        VoiceResourceOperation.CancelDownload,
        VoiceResourceOperation.Remove
      ]
    }),
    status: (_options, signal) => getKokoroTtsStatus(signal, variant.bundleId),
    speechOperations: [completeSpeechOperation(createModel)],
    voices: async (signal) => {
      checkAbort(signal)
      return variant.voices
    },
    getDefaultVoice: async (language, signal) => {
      checkAbort(signal)
      if (language && !variant.languages.some((locale) => locale === language)) return null
      return variant.voices.find((voice) => voice.locale === language) ?? variant.voices[0]
    },
    download: () =>
      application
        .get('LocalModelService')
        .download(variant.bundleId, async () => ((await regionService.isInChina()) ? 'china-first' : 'global-first'))
        .catch(() => {
          throw new VoiceRuntimeError('download_failed')
        }),
    cancelDownload: () => application.get('LocalModelService').cancel(variant.bundleId),
    remove: () => application.get('LocalModelService').remove(variant.bundleId)
  }
}

export const kokoroSpeechDefinition = createSherpaSpeechDefinition(KOKORO_V1_1, createKokoroSpeechModel)
export const kokoroV1SpeechDefinition = createSherpaSpeechDefinition(KOKORO_V1, createKokoroV1SpeechModel)
