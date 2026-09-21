import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { TranscriptionModelV3 } from '@ai-sdk/provider'

import { application } from '@application'
import type { TranscriptionOptions } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { UtilityProcessError } from '@main/core/utilityProcess/UtilityProcessError'
import { FUNASR_MODEL_ID } from '@shared/ai/localVoice'
import { LOCAL_MODEL_BUNDLE_BY_CAPABILITY } from '@shared/data/presets/localModel'

import type { LocalVoiceStatus } from '../localAdapters'
import { VoiceRuntimeError } from '../VoiceRuntimeError'
import { voiceAudioProcess } from './voiceAudioProcess'

const AUDIO_DECODE_TIMEOUT_MS = 30_000
const ASR_INFERENCE_TIMEOUT_MS = 120_000
const logger = loggerService.withContext('FunAsrAdapter')

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new VoiceRuntimeError('aborted')
}

function normalizeFailure(error: unknown, signal?: AbortSignal): VoiceRuntimeError {
  if (signal?.aborted) return new VoiceRuntimeError('aborted')
  if (error instanceof VoiceRuntimeError) return error
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
    ['PROCESS_START_FAILED', 'PROCESS_EXITED', 'PROCESS_CIRCUIT_OPEN'].includes(error.code)
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
      return { status: 'installing', reason: 'model_required' }
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

export function createFunAsrTranscriptionModel(options: TranscriptionOptions): TranscriptionModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'local-voice',
    modelId: FUNASR_MODEL_ID,
    async doGenerate(input) {
      if (options.language) throw new VoiceRuntimeError('invalid_request')
      if (!(input.audio instanceof Uint8Array) || !['audio/webm', 'audio/webm;codecs=opus'].includes(input.mediaType))
        throw new VoiceRuntimeError('invalid_audio')
      await requireReady(input.abortSignal)
      return withScratch(async (directory) => {
        const timeout = AbortSignal.timeout(AUDIO_DECODE_TIMEOUT_MS)
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
          durationSeconds: decoded.durationSeconds,
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
          durationInSeconds: decoded.durationSeconds,
          warnings: [],
          response: { timestamp: new Date(), modelId: FUNASR_MODEL_ID }
        }
      }, input.abortSignal)
    }
  }
}
