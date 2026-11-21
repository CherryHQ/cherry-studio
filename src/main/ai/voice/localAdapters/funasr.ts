import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { TranscriptionModelV3 } from '@ai-sdk/provider'

import { application } from '@application'
import type { TranscriptionOptions } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { UtilityProcessError } from '@main/core/utilityProcess/UtilityProcessError'
import { regionService } from '@main/services/RegionService'
import { FUNASR_SUPPORTED_PLATFORM_KEYS } from '@shared/ai/localVoice'
import { LOCAL_VOICE_MODELS, VoiceModelSupport, VoiceResourceOperation } from '@shared/ai/localVoice'
import { FUNASR_BUNDLE_ID, FUNASR_MODEL_ID, PARAKEET_BUNDLE_ID, PARAKEET_MODEL_ID } from '@shared/ai/localVoice'
import { LOCAL_MODEL_STATUS_CACHE_KEY } from '@shared/data/presets/localModel'

import type { TranscriptionModelDefinition } from '../voiceModelTypes'
import type { LocalVoiceStatus } from '../voiceModelTypes'
import type { VoiceEnvironment } from '../voicePlatform'
import { checkAbort, VoiceRuntimeError } from '../VoiceRuntimeError'
import { inspectCanonicalWav } from './inspectCanonicalWav'
import { decodeVoiceRecording } from './recordingDecoder'
import { withScratch } from './scratch'
import { completeTranscriptionOperation } from './sdkOperations'

const ASR_INFERENCE_TIMEOUT_MS = 120_000
// Deadline ceiling for recordings longer than the fixed floor: twice the audio
// duration, so a slow machine still finishes instead of failing with a retry
// that can never succeed.
const ASR_INFERENCE_REALTIME_FACTOR = 2
const logger = loggerService.withContext('FunAsrAdapter')

/** A downloadable sherpa-onnx recognizer: FunASR Nano or Parakeet. Both detect the language themselves. */
interface SherpaAsrVariant {
  modelId: typeof FUNASR_MODEL_ID | typeof PARAKEET_MODEL_ID
  bundleId: typeof FUNASR_BUNDLE_ID | typeof PARAKEET_BUNDLE_ID
}

const FUNASR: SherpaAsrVariant = { modelId: FUNASR_MODEL_ID, bundleId: FUNASR_BUNDLE_ID }
const PARAKEET: SherpaAsrVariant = { modelId: PARAKEET_MODEL_ID, bundleId: PARAKEET_BUNDLE_ID }

function normalizeFailure(error: unknown, signal?: AbortSignal): VoiceRuntimeError {
  if (signal?.aborted) return new VoiceRuntimeError('aborted')
  if (error instanceof VoiceRuntimeError) return error
  if (error instanceof UtilityProcessError && error.code === 'PROCESS_BLOCKED') return new VoiceRuntimeError('busy')
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ASR_MODEL_LOAD_FAILED')
    return new VoiceRuntimeError('model_load_failed')
  if (
    error instanceof UtilityProcessError &&
    typeof error.remote?.code === 'string' &&
    ['VOICE_AUDIO_INVALID', 'VOICE_AUDIO_UNSUPPORTED', 'VOICE_AUDIO_LIMIT'].includes(error.remote.code)
  )
    return new VoiceRuntimeError('invalid_audio')
  if (error instanceof UtilityProcessError && error.remote?.code === 'ASR_MODEL_LOAD_FAILED')
    return new VoiceRuntimeError('model_load_failed')
  if (
    error instanceof UtilityProcessError &&
    ['PROCESS_START_FAILED', 'PROCESS_EXITED', 'PROCESS_PROTOCOL_ERROR', 'PROCESS_CIRCUIT_OPEN'].includes(error.code)
  )
    return new VoiceRuntimeError('worker_crashed')
  return new VoiceRuntimeError('operation_failed')
}

export function getFunAsrStatus(
  signal?: AbortSignal,
  bundleId: SherpaAsrVariant['bundleId'] = FUNASR_BUNDLE_ID
): LocalVoiceStatus {
  checkAbort(signal)
  const { status } = application.get('LocalModelService').refreshStatus(bundleId)
  switch (status) {
    case 'not_downloaded':
      return { status: 'not_installed', reason: 'model_required' }
    case 'downloading':
      return {
        status: 'installing',
        reason: 'model_required',
        percent: application.get('CacheService').getShared(LOCAL_MODEL_STATUS_CACHE_KEY)?.[bundleId]?.percent ?? 0
      }
    case 'ready':
      return { status: 'ready' }
    case 'error':
      return { status: 'failed', reason: 'download_failed' }
    case 'unsupported':
      return { status: 'unsupported', reason: 'unsupported' }
  }
}

async function requireReady(bundleId: SherpaAsrVariant['bundleId'], signal?: AbortSignal): Promise<void> {
  const status = getFunAsrStatus(signal, bundleId)
  if (status.status !== 'ready') throw new VoiceRuntimeError(status.reason ?? 'operation_failed')
}

function createSherpaTranscriptionModel(
  variant: SherpaAsrVariant,
  options: TranscriptionOptions
): TranscriptionModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'local-voice',
    modelId: variant.modelId,
    async doGenerate(input) {
      if (options.language) throw new VoiceRuntimeError('invalid_request')
      if (!(input.audio instanceof Uint8Array)) throw new VoiceRuntimeError('invalid_audio')
      const audio = input.audio
      const isWebm = ['audio/webm', 'audio/webm;codecs=opus'].includes(input.mediaType)
      const wavMetadata = input.mediaType === 'audio/wav' ? inspectCanonicalWav(audio) : undefined
      if (!isWebm && !wavMetadata) throw new VoiceRuntimeError('invalid_audio')
      await requireReady(variant.bundleId, input.abortSignal)
      return withScratch(
        async (directory) => {
          let wavBytes: Uint8Array
          let durationSeconds: number
          if (wavMetadata) {
            wavBytes = audio
            durationSeconds = wavMetadata.durationSeconds
          } else {
            const decoded = await decodeVoiceRecording(audio, input.abortSignal)
            wavBytes = decoded.wav
            durationSeconds = decoded.durationSeconds
          }
          checkAbort(input.abortSignal)
          const inputPath = join(directory, 'input.wav')
          await writeFile(inputPath, wavBytes, { mode: 0o600 })
          // Inference is chunked CPU work whose cost scales with the recording;
          // the fixed floor only covers short clips, so longer recordings get
          // realtime-factor headroom instead of a deadline they cannot meet.
          // AbortSignal.timeout rejects fractional milliseconds.
          const inferenceTimeout = AbortSignal.timeout(
            Math.max(ASR_INFERENCE_TIMEOUT_MS, Math.ceil(durationSeconds * 1_000 * ASR_INFERENCE_REALTIME_FACTOR))
          )
          const inferenceSignal = input.abortSignal
            ? AbortSignal.any([input.abortSignal, inferenceTimeout])
            : inferenceTimeout
          const transcript = await application
            .get('AsrInferenceService')
            .transcribe(variant.bundleId, { kind: 'wav', filePath: inputPath }, inferenceSignal)
            .catch((error: unknown) => {
              if (inferenceTimeout.aborted && !input.abortSignal?.aborted) throw new VoiceRuntimeError('timeout')
              throw error
            })
          checkAbort(input.abortSignal)
          logger.debug('Local transcription completed', {
            modelId: variant.modelId,
            status: 'completed',
            durationSeconds,
            segmentCount: transcript.segments.length,
            transcriptNonEmpty: transcript.text.length > 0
          })
          return {
            text: transcript.text,
            segments: transcript.segments.map((segment) => ({
              text: segment.text,
              startSecond: segment.start,
              endSecond: segment.end
            })),
            language: undefined,
            durationInSeconds: durationSeconds,
            warnings: [],
            response: { timestamp: new Date(), modelId: variant.modelId }
          }
        },
        input.abortSignal,
        normalizeFailure
      )
    }
  }
}

export function createFunAsrTranscriptionModel(options: TranscriptionOptions): TranscriptionModelV3 {
  return createSherpaTranscriptionModel(FUNASR, options)
}

function createSherpaTranscriptionDefinition(variant: SherpaAsrVariant): TranscriptionModelDefinition {
  return {
    id: variant.modelId,
    adapterId: 'funasr',
    support: (environment: VoiceEnvironment) =>
      FUNASR_SUPPORTED_PLATFORM_KEYS.some((key) => key === `${environment.platform}-${environment.arch}`)
        ? VoiceModelSupport.Supported
        : ['darwin', 'win32', 'linux'].includes(environment.platform)
          ? VoiceModelSupport.UnsupportedArchitecture
          : VoiceModelSupport.UnsupportedPlatform,
    describe: () => ({
      ...LOCAL_VOICE_MODELS.find((model) => model.id === variant.modelId)!,
      localeSelection: null,
      resourceOperations: [
        VoiceResourceOperation.Download,
        VoiceResourceOperation.CancelDownload,
        VoiceResourceOperation.Remove
      ]
    }),
    status: (_options, signal) => getFunAsrStatus(signal, variant.bundleId),
    locales: async () => ({ supported: [], installed: [] }),
    transcriptionOperations: [
      completeTranscriptionOperation((options) => createSherpaTranscriptionModel(variant, options))
    ],
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

export const funAsrTranscriptionDefinition = createSherpaTranscriptionDefinition(FUNASR)
export const parakeetTranscriptionDefinition = createSherpaTranscriptionDefinition(PARAKEET)
