import type { SpeechOptions, TranscriptionOptions } from '@cherrystudio/ai-core'
import {
  DEFAULT_SPEECH_SPEED,
  TranscriptionLanguageSource,
  VoiceModelSupport,
  VoiceResourceOperation,
  type LocalSpeechModelId,
  type LocalTranscriptionModelId,
  type LocalVoiceModelId,
  type VoiceModelLookup
} from '@shared/ai/localVoice'
import type { InputFor, OutputFor } from '@shared/ipc/types'

import { appleSpeechDefinition, appleTranscriptionDefinition } from './localAdapters/apple'
import { funAsrTranscriptionDefinition } from './localAdapters/funasr'
import { qwen3SpeechDefinition } from './localAdapters/qwen3Tts'
import { windowsSpeechDefinition, windowsTranscriptionDefinition } from './localAdapters/windows'
import type { LocalVoiceStatus, SpeechModelDefinition, TranscriptionModelDefinition } from './voiceModelTypes'
import {
  getVoiceEnvironment,
  resolveDefaultAsrModel,
  resolveDefaultSpeechModel,
  type VoiceEnvironment
} from './voicePlatform'
import { VoiceRuntimeError } from './VoiceRuntimeError'

export { voiceAudioProcess } from './localAdapters/voiceAudioProcess'
export type { LocalVoiceStatus } from './voiceModelTypes'

const transcriptionDefinitions: readonly TranscriptionModelDefinition[] = [
  appleTranscriptionDefinition,
  windowsTranscriptionDefinition,
  funAsrTranscriptionDefinition
]
const speechDefinitions: readonly SpeechModelDefinition[] = [
  appleSpeechDefinition,
  windowsSpeechDefinition,
  qwen3SpeechDefinition
]
const definitions = [...transcriptionDefinitions, ...speechDefinitions]

export function describeVoiceModel(modelId: string, environment = getVoiceEnvironment()): VoiceModelLookup {
  const definition = definitions.find((model) => model.id === modelId)
  return definition
    ? { support: definition.support(environment), model: definition.describe(environment) }
    : { support: VoiceModelSupport.UnknownModel, model: null }
}

export function listVoiceModels(environment = getVoiceEnvironment()) {
  return {
    models: definitions
      .filter((model) => model.support(environment) === VoiceModelSupport.Supported)
      .map((model) => model.describe(environment)),
    defaultAsrModelId: resolveDefaultAsrModel(environment),
    defaultSpeechModelId: resolveDefaultSpeechModel(environment)
  }
}

function transcriptionDefinition(modelId: LocalTranscriptionModelId) {
  const definition = transcriptionDefinitions.find((model) => model.id === modelId)
  if (!definition) throw new VoiceRuntimeError('unsupported')
  return definition
}

function speechDefinition(modelId: LocalSpeechModelId) {
  const definition = speechDefinitions.find((model) => model.id === modelId)
  if (!definition) throw new VoiceRuntimeError('unsupported')
  return definition
}

function requireSupport(
  definition: TranscriptionModelDefinition | SpeechModelDefinition,
  environment = getVoiceEnvironment()
) {
  if (definition.support(environment) !== VoiceModelSupport.Supported) throw new VoiceRuntimeError('unsupported')
}

export function getVoiceAdapterId(modelId: LocalVoiceModelId): string {
  const definition = definitions.find((model) => model.id === modelId)
  if (!definition) throw new VoiceRuntimeError('unsupported')
  return definition.adapterId
}

export function resolveTranscriptionRequest(
  input: Pick<InputFor<'ai.transcription.generate'>, 'modelId' | 'language'>,
  environment: VoiceEnvironment = getVoiceEnvironment()
) {
  const modelId = input.modelId ?? resolveDefaultAsrModel(environment)
  if (!modelId) throw new VoiceRuntimeError('unsupported')
  const definition = transcriptionDefinition(modelId)
  requireSupport(definition, environment)
  const { localeSelection } = definition.describe(environment)
  const selection = input.language
  if (!localeSelection && selection?.source === TranscriptionLanguageSource.Explicit)
    throw new VoiceRuntimeError('invalid_request')
  const language = localeSelection
    ? !selection || selection.source === TranscriptionLanguageSource.ModelDefault
      ? localeSelection.defaultLocale
      : selection.locale
    : undefined
  return { modelId, adapterId: definition.adapterId, options: { language } }
}

export function resolveSpeechRequest(
  input: Pick<InputFor<'ai.speech.generate'>, 'modelId' | 'voice' | 'language' | 'speed'>,
  environment = getVoiceEnvironment()
) {
  const modelId = input.modelId ?? resolveDefaultSpeechModel(environment)
  if (!modelId) throw new VoiceRuntimeError('unsupported')
  const definition = speechDefinition(modelId)
  requireSupport(definition, environment)
  return {
    modelId,
    options: { voice: input.voice, language: input.language, speed: input.speed ?? DEFAULT_SPEECH_SPEED }
  }
}

export function createLocalSpeechModel(modelId: LocalSpeechModelId, options: SpeechOptions) {
  const definition = speechDefinition(modelId)
  return definition.createModel(options)
}

export function createLocalTranscriptionModel(modelId: LocalTranscriptionModelId, options: TranscriptionOptions) {
  const definition = transcriptionDefinition(modelId)
  return definition.createModel(options)
}

export async function getLocalVoiceStatus(
  modelId: LocalVoiceModelId,
  options: { language?: string; voice?: string } = {},
  signal?: AbortSignal
): Promise<LocalVoiceStatus> {
  if (signal?.aborted) throw new VoiceRuntimeError('aborted')
  const definition = definitions.find((model) => model.id === modelId)
  if (!definition) throw new VoiceRuntimeError('unsupported')
  if (definition.support(getVoiceEnvironment()) !== VoiceModelSupport.Supported)
    return { status: 'unsupported', reason: 'unsupported' }
  return definition.status(options, signal)
}

export function listLocalVoices(modelId: LocalSpeechModelId, signal?: AbortSignal) {
  const definition = speechDefinition(modelId)
  requireSupport(definition)
  return definition.voices(signal)
}

export function listLocalAsrLocales(modelId: LocalTranscriptionModelId, signal?: AbortSignal) {
  const definition = transcriptionDefinition(modelId)
  requireSupport(definition)
  return definition.locales(signal)
}

export function installVoiceLocale(modelId: LocalTranscriptionModelId, language: string, signal?: AbortSignal) {
  const definition = transcriptionDefinition(modelId)
  requireSupport(definition)
  if (
    !definition.installLocale ||
    !definition.describe(getVoiceEnvironment()).resourceOperations.includes(VoiceResourceOperation.InstallLocale)
  )
    throw new VoiceRuntimeError('unsupported')
  return definition.installLocale(language, signal)
}

export function downloadVoiceModel(modelId: LocalVoiceModelId) {
  const definition = definitions.find((model) => model.id === modelId)
  if (!definition) throw new VoiceRuntimeError('unsupported')
  requireSupport(definition)
  if (!definition.download) throw new VoiceRuntimeError('unsupported')
  return definition.download()
}

export function cancelVoiceModelDownload(modelId: LocalVoiceModelId) {
  const definition = definitions.find((model) => model.id === modelId)
  if (!definition) throw new VoiceRuntimeError('unsupported')
  requireSupport(definition)
  if (!definition.cancelDownload) throw new VoiceRuntimeError('unsupported')
  return definition.cancelDownload()
}

export function removeVoiceModel(modelId: LocalVoiceModelId) {
  const definition = definitions.find((model) => model.id === modelId)
  if (!definition) throw new VoiceRuntimeError('unsupported')
  requireSupport(definition)
  if (!definition.remove) throw new VoiceRuntimeError('unsupported')
  return definition.remove()
}

/** Resolve automatic selection without downloading or replacing an explicit choice. */
export async function resolveTranscriptionConfiguration(
  input: InputFor<'ai.voice.transcription.resolve'>,
  signal?: AbortSignal,
  environment = getVoiceEnvironment()
): Promise<OutputFor<'ai.voice.transcription.resolve'>> {
  const candidates = input.modelId
    ? [input.modelId]
    : transcriptionDefinitions
        .filter((model) => model.support(environment) === VoiceModelSupport.Supported)
        .map((model) => model.id)
  let fallback: OutputFor<'ai.voice.transcription.resolve'> | undefined
  for (const modelId of candidates) {
    signal?.throwIfAborted()
    try {
      const plan = resolveTranscriptionRequest({ ...input, modelId }, environment)
      const status = await transcriptionDefinition(modelId).status(plan.options, signal)
      const selection = {
        modelId,
        language: plan.options.language
          ? { source: TranscriptionLanguageSource.Explicit, locale: plan.options.language }
          : { source: TranscriptionLanguageSource.ModelDefault },
        status
      }
      fallback ??= selection
      if (status.status === 'ready' || input.modelId) return selection
    } catch (error) {
      if (signal?.aborted) throw error
      const reason = error instanceof VoiceRuntimeError ? error.reason : 'operation_failed'
      const status: LocalVoiceStatus = {
        status: reason === 'unsupported' ? 'unsupported' : 'failed',
        reason
      }
      fallback ??= { modelId, language: input.language, status }
      if (input.modelId) return fallback
    }
  }
  return fallback ?? { status: { status: 'unsupported', reason: 'unsupported' } }
}

export async function resolveSpeechConfiguration(
  input: InputFor<'ai.voice.speech.resolve'>,
  signal?: AbortSignal,
  environment = getVoiceEnvironment()
): Promise<OutputFor<'ai.voice.speech.resolve'>> {
  const modelId = input.modelId ?? resolveDefaultSpeechModel(environment)
  const selection = { ...input, modelId, speed: input.speed ?? DEFAULT_SPEECH_SPEED }
  if (!modelId || speechDefinition(modelId).support(environment) !== VoiceModelSupport.Supported)
    return { ...selection, status: { status: 'unsupported', reason: 'unsupported' } }
  const definition = speechDefinition(modelId)
  const voice = input.voice
    ? (await definition.voices(signal)).find((voice) => voice.id === input.voice)
    : await definition.getDefaultVoice(input.language, signal)
  signal?.throwIfAborted()
  const language = input.language
    ? (voice?.languages ?? (voice ? [voice.locale] : [])).find(
        (locale) => locale.toLowerCase() === input.language!.toLowerCase()
      )
    : voice?.locale
  if (!voice || !language) return { ...selection, status: { status: 'not_installed', reason: 'voice_unavailable' } }
  const resolved = { ...selection, voice: voice.id, language }
  return { ...resolved, status: await definition.status(resolved, signal) }
}
