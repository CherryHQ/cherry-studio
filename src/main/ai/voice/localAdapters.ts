import type { SpeechModelV3, TranscriptionModelV3 } from '@ai-sdk/provider'

import type { SpeechOptions, TranscriptionOptions } from '@cherrystudio/ai-core'
import {
  APPLE_ASR_MODEL_ID,
  APPLE_TTS_MODEL_ID,
  FUNASR_MODEL_ID,
  type LocalSpeechModelId,
  type LocalTranscriptionModelId,
  type LocalVoiceModelId
} from '@shared/ai/localVoice'
import type { VoiceErrorReason } from '@shared/ipc/errors/voice'

import { createAppleSpeechModel, createAppleTranscriptionModel, getAppleVoiceStatus } from './localAdapters/apple'
import { VoiceRuntimeError } from './VoiceRuntimeError'

export { installAppleAsrAsset, listAppleAsrLocales, listLocalVoices } from './localAdapters/apple'
export { voiceAudioProcess } from './localAdapters/voiceAudioProcess'

export interface LocalVoiceStatus {
  status: 'unsupported' | 'not_installed' | 'installing' | 'ready' | 'failed'
  reason?: VoiceErrorReason
}

export function createLocalSpeechModel(modelId: LocalSpeechModelId, options: SpeechOptions): SpeechModelV3 {
  if (modelId !== APPLE_TTS_MODEL_ID) throw new VoiceRuntimeError('unsupported')
  return createAppleSpeechModel(options)
}

export function createLocalTranscriptionModel(
  modelId: LocalTranscriptionModelId,
  options: TranscriptionOptions
): TranscriptionModelV3 {
  if (modelId === FUNASR_MODEL_ID) {
    throw new VoiceRuntimeError('license_unverified')
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
  if (modelId === FUNASR_MODEL_ID) return { status: 'failed', reason: 'license_unverified' }
  if (modelId !== APPLE_ASR_MODEL_ID && modelId !== APPLE_TTS_MODEL_ID) throw new VoiceRuntimeError('unsupported')
  return getAppleVoiceStatus(modelId, options, signal)
}
