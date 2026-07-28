import '../provider/factory'

import { extensionRegistry } from '@cherrystudio/ai-core/provider'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import type { SpeechModelSelection, SpeechSynthesisResult, SpeechTranscriptionResult } from '@shared/ai/speech'
import { experimental_generateSpeech, experimental_transcribe } from 'ai'

import { providerToAiSdkConfig } from '../provider/config'

const MAX_AUDIO_BYTES = 25 * 1024 * 1024

async function createSdkProvider(selection: SpeechModelSelection) {
  const provider = providerService.getByProviderId(selection.providerId)
  const model = modelService.getByKey(selection.providerId, selection.modelId)
  const config = await providerToAiSdkConfig(provider, model)
  const sdkProvider = await extensionRegistry.createProvider(config.providerId, config.providerSettings)
  return { sdkProvider, apiModelId: model.apiModelId ?? selection.modelId }
}

export async function transcribeAudio(
  selection: SpeechModelSelection,
  audioBase64: string,
  signal: AbortSignal
): Promise<SpeechTranscriptionResult> {
  const audio = Buffer.from(audioBase64, 'base64')
  if (audio.byteLength === 0 || audio.byteLength > MAX_AUDIO_BYTES) {
    throw new Error('Speech audio must be between 1 byte and 25 MiB')
  }

  const { sdkProvider, apiModelId } = await createSdkProvider(selection)
  if (!sdkProvider.transcriptionModel) {
    throw new Error(`Configured provider does not expose transcription for model '${selection.name}'`)
  }
  const result = await experimental_transcribe({
    model: sdkProvider.transcriptionModel(apiModelId),
    audio,
    abortSignal: signal
  })
  return {
    text: result.text,
    segments: result.segments.map((segment) => ({ ...segment })),
    language: result.language ?? null,
    durationInSeconds: result.durationInSeconds ?? null,
    model: selection
  }
}

export async function synthesizeSpeech(
  selection: SpeechModelSelection,
  text: string,
  signal: AbortSignal,
  options?: { voice?: string; speed?: number }
): Promise<SpeechSynthesisResult> {
  const { sdkProvider, apiModelId } = await createSdkProvider(selection)
  if (!sdkProvider.speechModel) {
    throw new Error(`Configured provider does not expose speech synthesis for model '${selection.name}'`)
  }
  const result = await experimental_generateSpeech({
    model: sdkProvider.speechModel(apiModelId),
    text,
    voice: options?.voice,
    speed: options?.speed,
    abortSignal: signal
  })
  return {
    audioBase64: result.audio.base64,
    mediaType: result.audio.mediaType,
    format: result.audio.format,
    model: selection
  }
}
