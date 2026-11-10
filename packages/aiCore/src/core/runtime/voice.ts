import type { SpeechModelV3, TranscriptionModelV3 } from '@ai-sdk/provider'
import { experimental_generateSpeech, experimental_transcribe } from 'ai'

export interface SpeechOptions {
  /** Exact voice identity; an adapter must not substitute an unavailable voice. */
  voice: string
  language?: string
  speed?: number
}

export interface SpeechResult {
  audio: Uint8Array
  mediaType: 'audio/wav'
}

export interface TranscriptionOptions {
  /** BCP-47 locale forwarded in the resolved model's provider-options namespace. */
  language?: string
}

export interface TranscriptionResult {
  text: string
  segments: Array<{ text: string; startSecond: number; endSecond: number }>
  language?: string
  durationInSeconds?: number
}

/** Runs an already-resolved model once; never resolves a global provider or retries. */
export async function generateSpeech(
  model: SpeechModelV3,
  text: string,
  options: SpeechOptions,
  abortSignal: AbortSignal
): Promise<SpeechResult> {
  abortSignal.throwIfAborted()
  if (!model || typeof model !== 'object' || model.specificationVersion !== 'v3') {
    throw new TypeError('Speech requires a resolved V3 model')
  }
  const result = await experimental_generateSpeech({
    model,
    text,
    voice: options.voice,
    language: options.language,
    speed: options.speed,
    outputFormat: 'wav',
    maxRetries: 0,
    abortSignal
  })
  abortSignal.throwIfAborted()
  if (result.audio.mediaType !== 'audio/wav') throw new Error('Speech output must be WAV')
  return { audio: result.audio.uint8Array, mediaType: 'audio/wav' }
}

/** Accepts local bytes only; URLs and implicit provider resolution are outside this contract. */
export async function transcribe(
  model: TranscriptionModelV3,
  audio: Uint8Array,
  options: TranscriptionOptions,
  abortSignal: AbortSignal
): Promise<TranscriptionResult> {
  abortSignal.throwIfAborted()
  if (!model || typeof model !== 'object' || model.specificationVersion !== 'v3') {
    throw new TypeError('Transcription requires a resolved V3 model')
  }
  if (!(audio instanceof Uint8Array)) throw new TypeError('Transcription requires audio bytes')
  const result = await experimental_transcribe({
    model,
    audio,
    ...(options.language && { providerOptions: { [model.provider]: { language: options.language } } }),
    maxRetries: 0,
    abortSignal
  })
  abortSignal.throwIfAborted()
  return {
    text: result.text,
    segments: result.segments,
    ...(result.language !== undefined && { language: result.language }),
    ...(result.durationInSeconds !== undefined && { durationInSeconds: result.durationInSeconds })
  }
}
