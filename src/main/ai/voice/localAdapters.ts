import type { SpeechModelV3, TranscriptionModelV3 } from '@ai-sdk/provider'

import type { SpeechOptions, TranscriptionOptions } from '@cherrystudio/ai-core'
import {
  APPLE_ASR_MODEL_ID,
  APPLE_TTS_MODEL_ID,
  FUNASR_MODEL_ID,
  type LocalSpeechModelId,
  type LocalTranscriptionModelId,
  type LocalVoiceModelId,
  WINDOWS_TTS_MODEL_ID
} from '@shared/ai/localVoice'
import type { VoiceErrorReason } from '@shared/ipc/errors/voice'

import {
  createAppleSpeechModel,
  createAppleTranscriptionModel,
  getAppleVoiceStatus,
  listAppleVoices
} from './localAdapters/apple'
import { createFunAsrTranscriptionModel, getFunAsrStatus } from './localAdapters/funasr'
import { createWindowsSpeechModel, getWindowsVoiceStatus, listWindowsVoices } from './localAdapters/windows'
import { VoiceRuntimeError } from './VoiceRuntimeError'

export { installAppleAsrAsset, listAppleAsrLocales } from './localAdapters/apple'
export { voiceAudioProcess } from './localAdapters/voiceAudioProcess'

export interface LocalVoiceStatus {
  status: 'unsupported' | 'not_installed' | 'installing' | 'ready' | 'failed'
  reason?: VoiceErrorReason
}

export function createLocalSpeechModel(modelId: LocalSpeechModelId, options: SpeechOptions): SpeechModelV3 {
  if (modelId === WINDOWS_TTS_MODEL_ID) return createWindowsSpeechModel(options)
  if (modelId !== APPLE_TTS_MODEL_ID) throw new VoiceRuntimeError('unsupported')
  return createAppleSpeechModel(options)
}

export function createLocalTranscriptionModel(
  modelId: LocalTranscriptionModelId,
  options: TranscriptionOptions
): TranscriptionModelV3 {
  if (modelId === FUNASR_MODEL_ID) {
    return createFunAsrTranscriptionModel(options)
  }
  if (modelId !== APPLE_ASR_MODEL_ID) throw new VoiceRuntimeError('unsupported')
  return createAppleTranscriptionModel(options)
}

export async function getLocalVoiceStatus(
  modelId: LocalVoiceModelId,
  options: { language?: string; voice?: string } = {},
  signal?: AbortSignal
): Promise<LocalVoiceStatus> {
  if (signal?.aborted) throw new VoiceRuntimeError('aborted')
  if (modelId === WINDOWS_TTS_MODEL_ID) return getWindowsVoiceStatus(options, signal)
  if (modelId === FUNASR_MODEL_ID) return getFunAsrStatus(signal)
  if (modelId !== APPLE_ASR_MODEL_ID && modelId !== APPLE_TTS_MODEL_ID) throw new VoiceRuntimeError('unsupported')
  return getAppleVoiceStatus(modelId, options, signal)
}

export function listLocalVoices(signal?: AbortSignal) {
  return process.platform === 'win32' ? listWindowsVoices(signal) : listAppleVoices(signal)
}
