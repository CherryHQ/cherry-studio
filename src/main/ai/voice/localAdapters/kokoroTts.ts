import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { SpeechModelV3 } from '@ai-sdk/provider'

import { application } from '@application'
import type { SpeechOptions } from '@cherrystudio/ai-core'
import { UtilityProcessError } from '@main/core/utilityProcess/UtilityProcessError'
import { regionService } from '@main/services/RegionService'
import {
  DEFAULT_SPEECH_SPEED,
  SHERPA_VOICE_SUPPORTED_PLATFORM_KEYS,
  KOKORO_TTS_BUNDLE_ID,
  KOKORO_TTS_MODEL_ID,
  LOCAL_VOICE_MODELS,
  MAX_SPEECH_SPEED,
  MIN_SPEECH_SPEED,
  VoiceModelSupport,
  VoiceResourceOperation,
  type LocalSpeechVoice
} from '@shared/ai/localVoice'
import { LOCAL_MODEL_STATUS_CACHE_KEY } from '@shared/data/presets/localModel'

import type { LocalVoiceStatus, SpeechModelDefinition } from '../voiceModelTypes'
import type { VoiceEnvironment } from '../voicePlatform'
import { checkAbort, VoiceRuntimeError } from '../VoiceRuntimeError'
import { withScratch } from './scratch'
import { completeSpeechOperation } from './sdkOperations'

const LANGUAGES = ['zh-CN', 'en-US', 'en-GB'] as const

/** English voices are English-only; the v1.1-zh voices are Chinese-only. */
function voiceLanguages(id: string): readonly string[] {
  if (id.startsWith('af_')) return ['en-US']
  if (id.startsWith('bf_')) return ['en-GB']
  return ['zh-CN']
}

const VOICES: LocalSpeechVoice[] = [
  'af_maple',
  'af_sol',
  'bf_vale',
  ...Array.from({ length: 55 }, (_, index) => `zf_${String(index + 1).padStart(3, '0')}`),
  ...Array.from({ length: 45 }, (_, index) => `zm_${String(index + 1).padStart(3, '0')}`)
].map((id) => ({
  id,
  name: id,
  locale: id.startsWith('z') ? 'zh-CN' : id.startsWith('b') ? 'en-GB' : 'en-US',
  languages: voiceLanguages(id)
}))

/**
 * Explicit defaults instead of the array's first entry. `zf_001` ("晴岚") is
 * the vendor's natural, clear female voice; the rest are only fallbacks.
 */
const DEFAULT_VOICE_ORDER: Readonly<Record<string, readonly string[]>> = {
  'zh-CN': ['zf_001'],
  'en-US': ['af_maple', 'af_sol'],
  'en-GB': ['bf_vale']
}
const DEFAULT_ENGLISH_VOICE: Readonly<Record<string, string>> = { 'en-US': 'af_maple', 'en-GB': 'bf_vale' }
const DEFAULT_CHINESE_VOICE = 'zf_001'

type KokoroSpeechSegment = { text: string; voice: string }
type KokoroLanguageRun = { text: string; language: 'zh' | 'en' }

const HAN_CHARACTER = /^\p{Script=Han}$/u
const LATIN_LETTER = /^[A-Za-z]$/

/**
 * Splits text into runs of one script. Punctuation, digits and spaces stick to
 * the run before them, so a full stop stays with the sentence it closes.
 */
export function splitKokoroLanguageRuns(text: string): KokoroLanguageRun[] {
  const runs: KokoroLanguageRun[] = []
  let buffer = ''
  let language: 'zh' | 'en' | undefined
  const flush = () => {
    const value = buffer.trim()
    if (value && language) runs.push({ text: value, language })
    buffer = ''
    language = undefined
  }
  for (const character of Array.from(text)) {
    const script = HAN_CHARACTER.test(character) ? 'zh' : LATIN_LETTER.test(character) ? 'en' : undefined
    if (!script) {
      buffer += character
      continue
    }
    if (language && language !== script) flush()
    language = script
    buffer += character
  }
  flush()
  return runs
}

/**
 * Every run is synthesized with a voice trained on its own language: Chinese
 * characters with the Chinese voice, Latin words with the English one. This
 * includes terms embedded in a Chinese sentence, because a Chinese speaker
 * reading English carries an accent and its frontend may not cover the word.
 */
export function planKokoroSpeechSegments(
  text: string,
  primaryVoice: string,
  englishVoice: string
): KokoroSpeechSegment[] {
  const primaryIsChinese = VOICES.find((voice) => voice.id === primaryVoice)?.locale === 'zh-CN'
  const chineseVoice = primaryIsChinese ? primaryVoice : DEFAULT_CHINESE_VOICE
  const englishVoiceForRun = primaryIsChinese ? englishVoice : primaryVoice
  const segments: KokoroSpeechSegment[] = []
  for (const run of splitKokoroLanguageRuns(text)) {
    const voice = run.language === 'zh' ? chineseVoice : englishVoiceForRun
    const last = segments.at(-1)
    if (last && last.voice === voice) last.text += `\n${run.text}`
    else segments.push({ text: run.text, voice })
  }
  return segments.length > 0 ? segments : [{ text, voice: primaryVoice }]
}

export function kokoroTtsSupport(environment: VoiceEnvironment) {
  if (!['darwin', 'linux', 'win32'].includes(environment.platform)) return VoiceModelSupport.UnsupportedPlatform
  return SHERPA_VOICE_SUPPORTED_PLATFORM_KEYS.some((key) => key === `${environment.platform}-${environment.arch}`)
    ? VoiceModelSupport.Supported
    : VoiceModelSupport.UnsupportedArchitecture
}

export function getKokoroTtsStatus(signal?: AbortSignal): LocalVoiceStatus {
  checkAbort(signal)
  const { status } = application.get('LocalModelService').refreshStatus(KOKORO_TTS_BUNDLE_ID)
  switch (status) {
    case 'ready':
      return { status: 'ready' }
    case 'not_downloaded':
      return { status: 'not_installed', reason: 'model_required' }
    case 'downloading':
      return {
        status: 'installing',
        reason: 'model_required',
        percent:
          application.get('CacheService').getShared(LOCAL_MODEL_STATUS_CACHE_KEY)?.[KOKORO_TTS_BUNDLE_ID]?.percent ?? 0
      }
    case 'error':
      return { status: 'failed', reason: 'download_failed' }
    case 'unsupported':
      return { status: 'unsupported', reason: 'unsupported' }
  }
}

function normalizeFailure(error: unknown, signal?: AbortSignal): VoiceRuntimeError {
  if (signal?.aborted) return new VoiceRuntimeError('aborted')
  if (error instanceof VoiceRuntimeError) return error
  if (error instanceof UtilityProcessError) {
    if (error.code === 'PROCESS_BLOCKED') return new VoiceRuntimeError('busy')
    if (error.remote?.code === 'TTS_MODEL_LOAD_FAILED') return new VoiceRuntimeError('model_load_failed')
    if (
      ['PROCESS_START_FAILED', 'PROCESS_EXITED', 'PROCESS_PROTOCOL_ERROR', 'PROCESS_CIRCUIT_OPEN'].includes(error.code)
    )
      return new VoiceRuntimeError('worker_crashed')
  }
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'TTS_MODEL_LOAD_FAILED')
    return new VoiceRuntimeError('model_load_failed')
  return new VoiceRuntimeError('operation_failed')
}

export function createKokoroSpeechModel(options: SpeechOptions): SpeechModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'local-voice',
    modelId: KOKORO_TTS_MODEL_ID,
    async doGenerate(input) {
      checkAbort(input.abortSignal)
      const speaker = VOICES.findIndex((voice) => voice.id === options.voice)
      const language = options.language ?? VOICES[speaker]?.locale
      const speed = options.speed ?? DEFAULT_SPEECH_SPEED
      if (
        speaker < 0 ||
        !VOICES[speaker]?.languages?.includes(language) ||
        !Number.isFinite(speed) ||
        speed < MIN_SPEECH_SPEED ||
        speed > MAX_SPEECH_SPEED ||
        (input.outputFormat !== undefined && input.outputFormat !== 'wav')
      )
        throw new VoiceRuntimeError('invalid_request')
      const status = getKokoroTtsStatus(input.abortSignal)
      if (status.status !== 'ready') throw new VoiceRuntimeError(status.reason ?? 'model_required')
      const primaryVoice = VOICES[speaker].id
      const englishVoice = DEFAULT_ENGLISH_VOICE[language] ?? 'af_maple'
      const segments = planKokoroSpeechSegments(input.text, primaryVoice, englishVoice).map((segment) => ({
        text: segment.text,
        voice: String(VOICES.findIndex((voice) => voice.id === segment.voice))
      }))
      return withScratch(
        async (directory) => {
          const outputPath = join(directory, 'speech.wav')
          const timeout = AbortSignal.timeout(120_000)
          const signal = input.abortSignal ? AbortSignal.any([timeout, input.abortSignal]) : timeout
          try {
            await application
              .get('TtsInferenceService')
              .synthesize(
                KOKORO_TTS_BUNDLE_ID,
                { text: input.text, voice: String(speaker), language, speed, outputPath, segments },
                signal
              )
          } catch (error) {
            if (timeout.aborted && !input.abortSignal?.aborted) throw new VoiceRuntimeError('timeout')
            throw error
          }
          checkAbort(input.abortSignal)
          const audio = new Uint8Array(await readFile(outputPath))
          checkAbort(input.abortSignal)
          return { audio, warnings: [], response: { timestamp: new Date(), modelId: KOKORO_TTS_MODEL_ID } }
        },
        input.abortSignal,
        normalizeFailure
      )
    }
  }
}

export const kokoroSpeechDefinition: SpeechModelDefinition = {
  id: KOKORO_TTS_MODEL_ID,
  adapterId: 'sherpa',
  support: kokoroTtsSupport,
  describe: () => ({
    ...LOCAL_VOICE_MODELS.find((model) => model.id === KOKORO_TTS_MODEL_ID)!,
    localeSelection: null,
    resourceOperations: [
      VoiceResourceOperation.Download,
      VoiceResourceOperation.CancelDownload,
      VoiceResourceOperation.Remove
    ]
  }),
  status: (_options, signal) => getKokoroTtsStatus(signal),
  speechOperations: [completeSpeechOperation(createKokoroSpeechModel)],
  voices: async (signal) => {
    checkAbort(signal)
    return VOICES
  },
  getDefaultVoice: async (language, signal) => {
    checkAbort(signal)
    if (language && !LANGUAGES.some((locale) => locale === language)) return null
    const preferred = language
      ? DEFAULT_VOICE_ORDER[language]?.map((id) => VOICES.find((voice) => voice.id === id)).find(Boolean)
      : undefined
    return preferred ?? VOICES.find((voice) => !language || voice.languages?.includes(language)) ?? VOICES[0]
  },
  download: () =>
    application
      .get('LocalModelService')
      .download(KOKORO_TTS_BUNDLE_ID, async () => ((await regionService.isInChina()) ? 'china-first' : 'global-first'))
      .catch(() => {
        throw new VoiceRuntimeError('download_failed')
      }),
  cancelDownload: () => application.get('LocalModelService').cancel(KOKORO_TTS_BUNDLE_ID),
  remove: () => application.get('LocalModelService').remove(KOKORO_TTS_BUNDLE_ID)
}
