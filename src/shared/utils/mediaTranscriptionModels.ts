/**
 * Model-list predicates for audio_to_text processors.
 * Keep these aligned with the corresponding FileProcessing handlers.
 */

import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isAudioModel, isSpeechToTextModel } from '@shared/utils/model'
import { supportsGenerateTextAudioInput } from '@shared/utils/nativeFileSupport'

/**
 * OpenAI Transcription (Whisper-compatible) requires a dedicated speech-to-text
 * model. Multimodal chat LLMs with incidental audio input are excluded.
 */
export function isOpenAiTranscriptionModel(model: Model): boolean {
  return isSpeechToTextModel(model)
}

/**
 * provider-media feeds audio as a generateText file part. Dedicated STT-only
 * models (AUDIO_TRANSCRIPT / audio-in without text chat) must use
 * openai-transcription instead. Provider-aware converter gate excludes
 * force-text and known no-audio first-party hosts.
 */
export function isProviderMediaTranscriptionModel(
  model: Model,
  provider?: Pick<Provider, 'id' | 'presetProviderId'> | null
): boolean {
  if (!isAudioModel(model) || isSpeechToTextModel(model)) return false
  if (!provider) return false
  return supportsGenerateTextAudioInput(provider)
}
