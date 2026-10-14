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
import { FUNASR_MODEL_ID } from '@shared/ai/localVoice'
import { LOCAL_MODEL_STATUS_CACHE_KEY } from '@shared/data/presets/localModel'
import { LOCAL_MODEL_BUNDLE_BY_CAPABILITY } from '@shared/data/presets/localModel'

import type { TranscriptionModelDefinition } from '../voiceModelTypes'
import type { LocalVoiceStatus } from '../voiceModelTypes'
import type { VoiceEnvironment } from '../voicePlatform'
import { VoiceRuntimeError } from '../VoiceRuntimeError'
import { withScratch } from './nativeSupport'
import { voiceAudioProcess } from './voiceAudioProcess'

const AUDIO_DECODE_TIMEOUT_MS = 30_000
const ASR_INFERENCE_TIMEOUT_MS = 120_000
const MAX_CANONICAL_WAV_BYTES = 32 * 1024 * 1024
const logger = loggerService.withContext('FunAsrAdapter')

function inspectCanonicalWav(audio: Uint8Array): { durationSeconds: number } {
  const hasTag = (offset: number, tag: string): boolean =>
    audio[offset] === tag.charCodeAt(0) &&
    audio[offset + 1] === tag.charCodeAt(1) &&
    audio[offset + 2] === tag.charCodeAt(2) &&
    audio[offset + 3] === tag.charCodeAt(3)

  if (audio.byteLength < 12 || audio.byteLength > MAX_CANONICAL_WAV_BYTES || !hasTag(0, 'RIFF') || !hasTag(8, 'WAVE'))
    throw new VoiceRuntimeError('invalid_audio')

  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength)
  if (view.getUint32(4, true) !== audio.byteLength - 8) throw new VoiceRuntimeError('invalid_audio')

  let offset = 12
  let hasFmt = false
  let dataSize: number | undefined
  while (offset < audio.byteLength) {
    if (audio.byteLength - offset < 8) throw new VoiceRuntimeError('invalid_audio')
    const chunkSize = view.getUint32(offset + 4, true)
    const payloadOffset = offset + 8
    const nextOffset = payloadOffset + chunkSize + (chunkSize % 2)
    if (nextOffset > audio.byteLength) throw new VoiceRuntimeError('invalid_audio')

    if (hasTag(offset, 'fmt ')) {
      if (
        hasFmt ||
        (chunkSize !== 16 && chunkSize !== 18) ||
        (chunkSize === 18 && view.getUint16(payloadOffset + 16, true) !== 0) ||
        view.getUint16(payloadOffset, true) !== 1 ||
        view.getUint16(payloadOffset + 2, true) !== 1 ||
        view.getUint32(payloadOffset + 4, true) !== 16_000 ||
        view.getUint32(payloadOffset + 8, true) !== 32_000 ||
        view.getUint16(payloadOffset + 12, true) !== 2 ||
        view.getUint16(payloadOffset + 14, true) !== 16
      )
        throw new VoiceRuntimeError('invalid_audio')
      hasFmt = true
    } else if (hasTag(offset, 'data')) {
      if (dataSize !== undefined || chunkSize === 0 || chunkSize % 2 !== 0) throw new VoiceRuntimeError('invalid_audio')
      dataSize = chunkSize
    }
    offset = nextOffset
  }
  if (!hasFmt || dataSize === undefined) throw new VoiceRuntimeError('invalid_audio')
  return { durationSeconds: dataSize / 32_000 }
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new VoiceRuntimeError('aborted')
}

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

export function getFunAsrStatus(signal?: AbortSignal): LocalVoiceStatus {
  checkAbort(signal)
  const { status } = application.get('LocalModelService').refreshStatus(LOCAL_MODEL_BUNDLE_BY_CAPABILITY.asr)
  switch (status) {
    case 'not_downloaded':
      return { status: 'not_installed', reason: 'model_required' }
    case 'downloading':
      return {
        status: 'installing',
        reason: 'model_required',
        percent:
          application.get('CacheService').getShared(LOCAL_MODEL_STATUS_CACHE_KEY)?.[
            LOCAL_MODEL_BUNDLE_BY_CAPABILITY.asr
          ]?.percent ?? 0
      }
    case 'ready':
      return { status: 'ready' }
    case 'error':
      return { status: 'failed', reason: 'download_failed' }
    case 'unsupported':
      return { status: 'unsupported', reason: 'unsupported' }
  }
}

async function requireReady(signal?: AbortSignal): Promise<void> {
  const status = getFunAsrStatus(signal)
  if (status.status !== 'ready') throw new VoiceRuntimeError(status.reason ?? 'operation_failed')
}

export function createFunAsrTranscriptionModel(options: TranscriptionOptions): TranscriptionModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'local-voice',
    modelId: FUNASR_MODEL_ID,
    async doGenerate(input) {
      if (options.language) throw new VoiceRuntimeError('invalid_request')
      const audio = input.audio
      if (
        !(audio instanceof Uint8Array) ||
        !['audio/webm', 'audio/webm;codecs=opus', 'audio/wav'].includes(input.mediaType)
      )
        throw new VoiceRuntimeError('invalid_audio')
      const wavInspection = input.mediaType === 'audio/wav' ? inspectCanonicalWav(audio) : undefined
      await requireReady(input.abortSignal)
      return withScratch(
        async (directory) => {
          const inputPath = join(directory, 'input.wav')
          let durationSeconds: number
          if (wavInspection) {
            await writeFile(inputPath, audio, { mode: 0o600 })
            durationSeconds = wavInspection.durationSeconds
          } else {
            const timeout = AbortSignal.timeout(AUDIO_DECODE_TIMEOUT_MS)
            const signal = input.abortSignal ? AbortSignal.any([input.abortSignal, timeout]) : timeout
            const decoded = await application
              .get('UtilityProcessManager')
              .client(voiceAudioProcess)
              .request('decode', { audio, mimeType: 'audio/webm;codecs=opus' }, { signal })
              .catch((error: unknown) => {
                if (timeout.aborted && !input.abortSignal?.aborted) throw new VoiceRuntimeError('timeout')
                throw error
              })
            checkAbort(input.abortSignal)
            await writeFile(inputPath, decoded.wav, { mode: 0o600 })
            durationSeconds = decoded.durationSeconds
          }
          const inferenceTimeout = AbortSignal.timeout(ASR_INFERENCE_TIMEOUT_MS)
          const inferenceSignal = input.abortSignal
            ? AbortSignal.any([input.abortSignal, inferenceTimeout])
            : inferenceTimeout
          const transcript = await application
            .get('AsrInferenceService')
            .transcribe({ kind: 'wav', filePath: inputPath }, inferenceSignal)
            .catch((error: unknown) => {
              if (inferenceTimeout.aborted && !input.abortSignal?.aborted) throw new VoiceRuntimeError('timeout')
              throw error
            })
          checkAbort(input.abortSignal)
          logger.debug('Local transcription completed', {
            modelId: FUNASR_MODEL_ID,
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
            response: { timestamp: new Date(), modelId: FUNASR_MODEL_ID }
          }
        },
        input.abortSignal,
        normalizeFailure
      )
    }
  }
}

export const funAsrTranscriptionDefinition: TranscriptionModelDefinition = {
  id: FUNASR_MODEL_ID,
  adapterId: 'funasr',
  support: (environment: VoiceEnvironment) =>
    FUNASR_SUPPORTED_PLATFORM_KEYS.some((key) => key === `${environment.platform}-${environment.arch}`)
      ? VoiceModelSupport.Supported
      : ['darwin', 'win32', 'linux'].includes(environment.platform)
        ? VoiceModelSupport.UnsupportedArchitecture
        : VoiceModelSupport.UnsupportedPlatform,
  describe: () => ({
    ...LOCAL_VOICE_MODELS.find((model) => model.id === FUNASR_MODEL_ID)!,
    localeSelection: null,
    resourceOperations: [
      VoiceResourceOperation.Download,
      VoiceResourceOperation.CancelDownload,
      VoiceResourceOperation.Remove
    ]
  }),
  status: (_options, signal) => getFunAsrStatus(signal),
  locales: async () => ({ supported: [], installed: [] }),
  createModel: createFunAsrTranscriptionModel,
  download: () =>
    application
      .get('LocalModelService')
      .download(LOCAL_MODEL_BUNDLE_BY_CAPABILITY.asr, async () =>
        (await regionService.isInChina()) ? 'china-first' : 'global-first'
      )
      .catch(() => {
        throw new VoiceRuntimeError('download_failed')
      }),
  cancelDownload: () => application.get('LocalModelService').cancel(LOCAL_MODEL_BUNDLE_BY_CAPABILITY.asr),
  remove: () => application.get('LocalModelService').remove(LOCAL_MODEL_BUNDLE_BY_CAPABILITY.asr)
}
