import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { SpeechModelV3, TranscriptionModelV3 } from '@ai-sdk/provider'

import type { SpeechOptions, TranscriptionOptions } from '@cherrystudio/ai-core'
import { LOCAL_VOICE_MODELS, VoiceModelSupport } from '@shared/ai/localVoice'
import {
  DEFAULT_SPEECH_SPEED,
  DEFAULT_WINDOWS_ASR_LOCALE,
  MAX_SPEECH_SPEED,
  MIN_SPEECH_SPEED,
  WINDOWS_ASR_MODEL_ID,
  WINDOWS_TTS_MODEL_ID
} from '@shared/ai/localVoice'

import type { TranscriptionModelDefinition, SpeechModelDefinition } from '../voiceModelTypes'
import type { LocalVoiceStatus } from '../voiceModelTypes'
import { getVoiceEnvironment, type VoiceEnvironment } from '../voicePlatform'
import { checkAbort, VoiceRuntimeError } from '../VoiceRuntimeError'
import { inspectCanonicalWav } from './inspectCanonicalWav'
import { decodeVoiceRecording } from './recordingDecoder'
import { withScratch } from './scratch'
import { completeSpeechOperation, completeTranscriptionOperation } from './sdkOperations'
import { nativeClient, normalizeFailure } from './systemSpeech'

function supportsWindows(): boolean {
  return windowsSupport(getVoiceEnvironment()) === VoiceModelSupport.Supported
}

export async function listWindowsAsrLocales(signal?: AbortSignal) {
  checkAbort(signal)
  if (!supportsWindows()) return { supported: [], installed: [] }
  try {
    return (await nativeClient().request({ operation: 'list_asr_locales' }, { signal })).result
  } catch (error) {
    throw normalizeFailure(error, signal)
  }
}

export async function getWindowsAsrStatus(
  options: { language?: string },
  signal?: AbortSignal
): Promise<LocalVoiceStatus> {
  checkAbort(signal)
  if (!supportsWindows()) return { status: 'unsupported', reason: 'unsupported' }
  try {
    await nativeClient().request(
      { operation: 'probe_asr', locale: options.language ?? DEFAULT_WINDOWS_ASR_LOCALE },
      { signal }
    )
    return { status: 'ready' }
  } catch (error) {
    const normalized = normalizeFailure(error, signal)
    if (normalized.reason === 'aborted') throw normalized
    return { status: normalized.reason === 'unsupported' ? 'unsupported' : 'failed', reason: normalized.reason }
  }
}

export function createWindowsTranscriptionModel(options: TranscriptionOptions): TranscriptionModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'local-voice',
    modelId: WINDOWS_ASR_MODEL_ID,
    async doGenerate(input) {
      if (!(input.audio instanceof Uint8Array)) throw new VoiceRuntimeError('invalid_audio')
      const audio = input.audio
      const isWebm = ['audio/webm', 'audio/webm;codecs=opus'].includes(input.mediaType)
      const wavMetadata = input.mediaType === 'audio/wav' ? inspectCanonicalWav(audio) : undefined
      if (!isWebm && !wavMetadata) throw new VoiceRuntimeError('invalid_audio')
      const status = await getWindowsAsrStatus(options, input.abortSignal)
      if (status.status !== 'ready') throw new VoiceRuntimeError(status.reason ?? 'operation_failed')
      return withScratch(
        async (directory) => {
          const decoded = wavMetadata
            ? { wav: audio, durationSeconds: wavMetadata.durationSeconds }
            : await decodeVoiceRecording(audio, input.abortSignal)
          checkAbort(input.abortSignal)
          const inputPath = join(directory, 'input.wav')
          await writeFile(inputPath, decoded.wav, { mode: 0o600 })
          const { result } = await nativeClient().request(
            { operation: 'transcribe', locale: options.language ?? DEFAULT_WINDOWS_ASR_LOCALE, inputPath },
            { signal: input.abortSignal }
          )
          checkAbort(input.abortSignal)
          return {
            text: result.text,
            segments: [],
            language: result.locale.replace('_', '-').split('-')[0],
            durationInSeconds: decoded.durationSeconds,
            warnings: [],
            response: { timestamp: new Date(), modelId: WINDOWS_ASR_MODEL_ID }
          }
        },
        input.abortSignal,
        normalizeFailure
      )
    }
  }
}

async function getDefaultWindowsVoice(language: string | undefined, signal?: AbortSignal) {
  checkAbort(signal)
  if (!supportsWindows()) return null
  try {
    return (await nativeClient().request({ operation: 'resolve_voice', locale: language }, { signal })).result.voice
  } catch (error) {
    throw normalizeFailure(error, signal)
  }
}

export async function listWindowsVoices(signal?: AbortSignal) {
  checkAbort(signal)
  if (!supportsWindows()) return []
  try {
    return (await nativeClient().request({ operation: 'capabilities', locale: 'en-US' }, { signal })).result.voices
  } catch (error) {
    throw normalizeFailure(error, signal)
  }
}

export async function getWindowsVoiceStatus(
  options: { language?: string; voice?: string },
  signal?: AbortSignal
): Promise<LocalVoiceStatus> {
  checkAbort(signal)
  if (!supportsWindows()) return { status: 'unsupported', reason: 'unsupported' }
  try {
    const voices = await listWindowsVoices(signal)
    const matchingVoice = voices.some(
      (voice) =>
        (!options.voice || voice.id === options.voice) &&
        (!options.language || voice.locale.replaceAll('_', '-').toLowerCase() === options.language.toLowerCase())
    )
    return matchingVoice ? { status: 'ready' } : { status: 'not_installed', reason: 'voice_unavailable' }
  } catch (error) {
    const normalized = normalizeFailure(error, signal)
    if (normalized.reason === 'aborted') throw normalized
    return { status: 'failed', reason: normalized.reason }
  }
}

export function createWindowsSpeechModel(options: SpeechOptions): SpeechModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'local-voice',
    modelId: WINDOWS_TTS_MODEL_ID,
    async doGenerate(input) {
      const speed = options.speed ?? DEFAULT_SPEECH_SPEED
      if (
        !Number.isFinite(speed) ||
        speed < MIN_SPEECH_SPEED ||
        speed > MAX_SPEECH_SPEED ||
        (input.outputFormat !== undefined && input.outputFormat !== 'wav')
      )
        throw new VoiceRuntimeError('invalid_request')
      const status = await getWindowsVoiceStatus(options, input.abortSignal)
      if (status.status !== 'ready') throw new VoiceRuntimeError(status.reason ?? 'operation_failed')
      return withScratch(
        async (directory) => {
          const outputPath = join(directory, 'output.wav')
          await nativeClient().request(
            { operation: 'synthesize', voiceId: options.voice, text: input.text, outputPath, speed },
            { signal: input.abortSignal }
          )
          checkAbort(input.abortSignal)
          const audio = new Uint8Array(await readFile(outputPath))
          checkAbort(input.abortSignal)
          return { audio, warnings: [], response: { timestamp: new Date(), modelId: WINDOWS_TTS_MODEL_ID } }
        },
        input.abortSignal,
        normalizeFailure
      )
    }
  }
}

function windowsSupport(environment: VoiceEnvironment) {
  if (environment.platform !== 'win32') return VoiceModelSupport.UnsupportedPlatform
  return environment.arch === 'x64' ? VoiceModelSupport.Supported : VoiceModelSupport.UnsupportedArchitecture
}

export const windowsTranscriptionDefinition: TranscriptionModelDefinition = {
  id: WINDOWS_ASR_MODEL_ID,
  adapterId: 'windows',
  support: windowsSupport,
  describe: () => ({
    ...LOCAL_VOICE_MODELS.find((model) => model.id === WINDOWS_ASR_MODEL_ID)!,
    localeSelection: { defaultLocale: DEFAULT_WINDOWS_ASR_LOCALE },
    resourceOperations: []
  }),
  status: getWindowsAsrStatus,
  locales: listWindowsAsrLocales,
  transcriptionOperations: [completeTranscriptionOperation(createWindowsTranscriptionModel)]
}

export const windowsSpeechDefinition: SpeechModelDefinition = {
  id: WINDOWS_TTS_MODEL_ID,
  adapterId: 'windows',
  support: windowsSupport,
  describe: () => ({
    ...LOCAL_VOICE_MODELS.find((model) => model.id === WINDOWS_TTS_MODEL_ID)!,
    localeSelection: null,
    resourceOperations: []
  }),
  status: getWindowsVoiceStatus,
  voices: listWindowsVoices,
  getDefaultVoice: getDefaultWindowsVoice,
  speechOperations: [completeSpeechOperation(createWindowsSpeechModel)]
}
