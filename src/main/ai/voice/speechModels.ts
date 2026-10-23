import { generateSpeech, type SpeechOptions, type SpeechResult } from '@cherrystudio/ai-core'
import { DEFAULT_SPEECH_SPEED, isSpeechModelId } from '@shared/ai/localVoice'
import type { SpeechModelId, VoiceModelDescriptor } from '@shared/ai/speech'
import { SpeechInputKind, SpeechOutputKind } from '@shared/ai/voice'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import type { InputFor, OutputFor } from '@shared/ipc/types'

import { getProviderSpeechVoices, listProviderSpeechModels, resolveProviderSpeechModel } from '../provider/speech'
import * as local from './localAdapters'
import { VoiceRuntimeError } from './VoiceRuntimeError'

export function listSpeechModels(): VoiceModelDescriptor[] {
  return listProviderSpeechModels().map((model) => ({
    id: model.id,
    providerId: model.providerId,
    name: model.name,
    capabilities: [MODEL_CAPABILITY.AUDIO_GENERATION],
    inputModalities: ['text'],
    outputModalities: ['audio'],
    supportsStreaming: false,
    voiceCapabilities: { speech: [{ input: SpeechInputKind.Text, output: SpeechOutputKind.Audio }] },
    localeSelection: null,
    resourceOperations: []
  }))
}

export function resolveSpeechRequest(
  input: Pick<InputFor<'ai.speech.generate'>, 'modelId' | 'voice' | 'language' | 'speed'>
) {
  if (!input.modelId || isSpeechModelId(input.modelId)) return local.resolveSpeechRequest(input)
  if (input.voice && !getProviderSpeechVoices(input.modelId).includes(input.voice))
    throw new VoiceRuntimeError('voice_unavailable')
  return {
    modelId: input.modelId,
    options: { voice: input.voice, language: input.language, speed: input.speed ?? DEFAULT_SPEECH_SPEED }
  }
}

export async function resolveSpeechConfiguration(
  input: InputFor<'ai.voice.speech.resolve'>,
  signal?: AbortSignal
): Promise<OutputFor<'ai.voice.speech.resolve'>> {
  signal?.throwIfAborted()
  if (!input.modelId || isSpeechModelId(input.modelId)) return local.resolveSpeechConfiguration(input, signal)
  const selection = { ...input, speed: input.speed ?? DEFAULT_SPEECH_SPEED }
  try {
    const voices = getProviderSpeechVoices(input.modelId)
    const voice = input.voice ?? voices[0]
    if (!voices.includes(voice))
      return { ...selection, status: { status: 'not_installed', reason: 'voice_unavailable' } }
    return { ...selection, voice, status: { status: 'ready' } }
  } catch (error) {
    signal?.throwIfAborted()
    return {
      ...selection,
      status: { status: 'unsupported', reason: error instanceof VoiceRuntimeError ? error.reason : 'unsupported' }
    }
  }
}

export async function listSpeechVoices(
  modelId: SpeechModelId,
  signal?: AbortSignal
): Promise<OutputFor<'ai.speech.voices.list'>> {
  signal?.throwIfAborted()
  if (isSpeechModelId(modelId))
    return (await local.listLocalVoices(modelId, signal)).map(({ id, name, locale, languages }) => ({
      id,
      name,
      language: locale,
      ...(languages && { languages: [...languages] })
    }))
  return getProviderSpeechVoices(modelId).map((id) => ({ id, name: id }))
}

export async function generateModelSpeech(
  modelId: SpeechModelId,
  text: string,
  options: SpeechOptions,
  signal: AbortSignal
): Promise<SpeechResult & { playbackRate?: number }> {
  signal.throwIfAborted()
  if (!getProviderSpeechVoices(modelId).includes(options.voice)) throw new VoiceRuntimeError('voice_unavailable')
  const resolved = await resolveProviderSpeechModel(modelId, signal)
  const result = await generateSpeech(
    resolved.model,
    text,
    { voice: options.voice, ...(resolved.speed === 'synthesis' && { speed: options.speed }) },
    signal
  )
  return { ...result, ...(resolved.speed === 'playback' && { playbackRate: options.speed ?? DEFAULT_SPEECH_SPEED }) }
}
