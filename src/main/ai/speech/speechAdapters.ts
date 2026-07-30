import '../provider/factory'

import { extensionRegistry } from '@cherrystudio/ai-core/provider'
import { loggerService } from '@logger'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import { defaultAppHeaders } from '@main/utils/http'
import type {
  PronunciationDiagnosis,
  SpeechModelSelection,
  SpeechSynthesisResult,
  SpeechTranscriptionResult
} from '@shared/ai/speech'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { formatApiHost } from '@shared/utils/api'
import { experimental_generateSpeech, experimental_transcribe } from 'ai'
import * as z from 'zod'

import { providerToAiSdkConfig } from '../provider/config'
import { customFetch } from '../utils/customFetch'
import { getBaseUrl, getExtraHeaders } from '../utils/provider'

const MAX_AUDIO_BYTES = 25 * 1024 * 1024
const logger = loggerService.withContext('SpeechAdapters')
const MIMO_PROVIDER_ID = 'mimo'
const MIMO_DEFAULT_TTS_VOICE = 'mimo_default'

interface ChatCompletionTextResponse {
  choices?: Array<{
    message?: {
      content?: unknown
      audio?: {
        data?: unknown
      }
    }
  }>
}

const PronunciationDiagnosisSchema = z.strictObject({
  source: z.literal('audio'),
  pronunciation: z.string(),
  stress: z.string(),
  intonation: z.string(),
  pace: z.string(),
  wordLevelNotes: z
    .array(
      z.strictObject({
        word: z.string(),
        issue: z.string(),
        suggestion: z.string()
      })
    )
    .max(20)
})

function parseJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return JSON.parse(fenced?.[1] ?? text)
}

function normalizeAudioBase64(value: string): { audioBase64: string; declaredMediaType?: string } {
  const dataUrl = value.match(/^data:([^;]+);base64,(.*)$/is)
  if (dataUrl) {
    return {
      declaredMediaType: dataUrl[1].trim().toLowerCase(),
      audioBase64: dataUrl[2].replace(/\s+/g, '')
    }
  }
  return { audioBase64: value.replace(/\s+/g, '') }
}

interface PlayableAudioProbe {
  mediaType: string
  description: string
}

function getWavFormatDescription(audio: Buffer): string | null {
  let offset = 12
  while (offset + 8 <= audio.length) {
    const chunkId = audio.subarray(offset, offset + 4).toString('ascii')
    const chunkSize = audio.readUInt32LE(offset + 4)
    const dataOffset = offset + 8
    if (chunkId === 'fmt ') {
      if (chunkSize < 16 || dataOffset + 16 > audio.length) return null
      const audioFormat = audio.readUInt16LE(dataOffset)
      const channelCount = audio.readUInt16LE(dataOffset + 2)
      const sampleRate = audio.readUInt32LE(dataOffset + 4)
      const bitsPerSample = audio.readUInt16LE(dataOffset + 14)
      const codec = audioFormat === 1 ? 'PCM' : audioFormat === 3 ? 'IEEE_FLOAT' : `codec_${audioFormat}`
      return `${codec}, ${channelCount} channel(s), ${sampleRate} Hz, ${bitsPerSample}-bit`
    }
    offset = dataOffset + chunkSize + (chunkSize % 2)
  }
  return null
}

function probePlayableAudio(audio: Buffer): PlayableAudioProbe | null {
  if (
    audio.length >= 12 &&
    audio.subarray(0, 4).toString('ascii') === 'RIFF' &&
    audio.subarray(8, 12).toString('ascii') === 'WAVE'
  ) {
    const wavFormat = getWavFormatDescription(audio)
    if (!wavFormat) return null
    if (!wavFormat.startsWith('PCM') && !wavFormat.startsWith('IEEE_FLOAT')) return null
    return { mediaType: 'audio/wav', description: wavFormat }
  }
  if (audio.length >= 3 && audio.subarray(0, 3).toString('ascii') === 'ID3')
    return { mediaType: 'audio/mpeg', description: 'MP3 with ID3 header' }
  if (audio.length >= 2 && audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0)
    return { mediaType: 'audio/mpeg', description: 'MP3 frame stream' }
  if (audio.length >= 4 && audio.subarray(0, 4).toString('ascii') === 'OggS')
    return { mediaType: 'audio/ogg', description: 'Ogg stream' }
  if (audio.length >= 4 && audio[0] === 0x1a && audio[1] === 0x45 && audio[2] === 0xdf && audio[3] === 0xa3)
    return { mediaType: 'audio/webm', description: 'WebM/Matroska stream' }
  if (audio.length >= 12 && audio.subarray(4, 8).toString('ascii') === 'ftyp')
    return { mediaType: 'audio/mp4', description: 'MP4 container' }
  return null
}

function normalizeSynthesizedAudio(
  value: string,
  fallbackMediaType: string
): { audioBase64: string; mediaType: string; description: string } {
  const normalized = normalizeAudioBase64(value)
  const audio = Buffer.from(normalized.audioBase64, 'base64')
  const probe = probePlayableAudio(audio)
  if (!probe) {
    const prefix = audio.subarray(0, Math.min(audio.length, 16)).toString('hex')
    throw new Error(
      `Speech synthesis returned unsupported audio bytes (declared media type: ${normalized.declaredMediaType || fallbackMediaType}; bytes: ${audio.length}; prefix: ${prefix})`
    )
  }
  return {
    audioBase64: normalized.audioBase64,
    mediaType: probe.mediaType,
    description: probe.description
  }
}

async function createSdkProvider(selection: SpeechModelSelection) {
  const provider = providerService.getByProviderId(selection.providerId)
  const model = modelService.getByKey(selection.providerId, selection.modelId)
  const config = await providerToAiSdkConfig(provider, model)
  const sdkProvider = await extensionRegistry.createProvider(config.providerId, config.providerSettings)
  return { sdkProvider, apiModelId: model.apiModelId ?? selection.modelId }
}

function getApiModelId(selection: SpeechModelSelection): string {
  const model = modelService.getByKey(selection.providerId, selection.modelId)
  return model.apiModelId ?? selection.modelId
}

function isMimoSpeechSelection(selection: SpeechModelSelection, apiModelId: string): boolean {
  return selection.providerId === MIMO_PROVIDER_ID || apiModelId.startsWith('mimo-v2.5-')
}

function getOpenAICompatibleChatCompletionsUrl(providerId: string): { url: string; headers: Record<string, string> } {
  const provider = providerService.getByProviderId(providerId)
  const apiKey = providerService.getRotatedApiKey(providerId)
  const baseUrl = formatApiHost(
    getBaseUrl(provider, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS) || 'https://api.xiaomimimo.com'
  )

  return {
    url: `${baseUrl}/chat/completions`,
    headers: {
      ...defaultAppHeaders(),
      ...(apiKey ? { Authorization: `Bearer ${apiKey}`, 'X-Api-Key': apiKey, 'api-key': apiKey } : {}),
      ...getExtraHeaders(provider),
      'Content-Type': 'application/json'
    }
  }
}

async function postOpenAICompatibleChatCompletions(
  providerId: string,
  body: unknown,
  signal: AbortSignal
): Promise<ChatCompletionTextResponse> {
  const { url, headers } = getOpenAICompatibleChatCompletionsUrl(providerId)
  const response = await customFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal
  })
  const responseText = await response.text()

  if (!response.ok) {
    throw new Error(
      `OpenAI-compatible speech API failed: HTTP ${response.status} ${response.statusText} - ${responseText.slice(0, 500)}`
    )
  }

  try {
    return JSON.parse(responseText) as ChatCompletionTextResponse
  } catch (error) {
    throw new Error(
      `OpenAI-compatible speech API returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

async function postMimoChatCompletions(
  providerId: string,
  body: unknown,
  signal: AbortSignal
): Promise<ChatCompletionTextResponse> {
  return postOpenAICompatibleChatCompletions(providerId, body, signal)
}

async function transcribeMimoAudio(
  selection: SpeechModelSelection,
  audioBase64: string,
  mediaType: string,
  apiModelId: string,
  audioBytes: number,
  signal: AbortSignal
): Promise<SpeechTranscriptionResult> {
  if (mediaType !== 'audio/wav' && mediaType !== 'audio/mpeg' && mediaType !== 'audio/mp3') {
    throw new Error(`MiMo speech recognition requires WAV or MP3 audio, but received '${mediaType}'`)
  }

  logger.info('Calling MiMo speech recognition model', {
    providerId: selection.providerId,
    modelId: apiModelId,
    mediaType,
    audioBytes
  })
  const result = await postMimoChatCompletions(
    selection.providerId,
    {
      model: apiModelId,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'input_audio',
              input_audio: {
                data: `data:${mediaType};base64,${audioBase64}`
              }
            }
          ]
        }
      ],
      asr_options: {
        language: 'auto'
      }
    },
    signal
  ).catch((error) => {
    logger.error('MiMo speech recognition model call failed', error, {
      providerId: selection.providerId,
      modelId: apiModelId,
      mediaType,
      audioBytes
    })
    throw error
  })

  const text = result.choices?.[0]?.message?.content
  if (typeof text !== 'string') {
    throw new Error('MiMo speech recognition response did not include transcript text')
  }

  logger.info('MiMo speech recognition model call completed', {
    providerId: selection.providerId,
    modelId: apiModelId,
    textLength: text.length
  })
  return {
    text,
    segments: [],
    language: null,
    durationInSeconds: null,
    model: selection
  }
}

async function synthesizeMimoSpeech(
  selection: SpeechModelSelection,
  text: string,
  apiModelId: string,
  signal: AbortSignal,
  options?: { voice?: string; speed?: number }
): Promise<SpeechSynthesisResult> {
  logger.info('Calling MiMo speech synthesis model', {
    providerId: selection.providerId,
    modelId: apiModelId,
    textLength: text.length
  })
  const result = await postMimoChatCompletions(
    selection.providerId,
    {
      model: apiModelId,
      messages: [
        {
          role: 'assistant',
          content: text
        }
      ],
      audio: {
        format: 'wav',
        voice: options?.voice || MIMO_DEFAULT_TTS_VOICE
      }
    },
    signal
  ).catch((error) => {
    logger.error('MiMo speech synthesis model call failed', error, {
      providerId: selection.providerId,
      modelId: apiModelId,
      textLength: text.length
    })
    throw error
  })

  const audioData = result.choices?.[0]?.message?.audio?.data
  if (typeof audioData !== 'string' || !audioData) {
    throw new Error('MiMo speech synthesis response did not include audio data')
  }
  const audio = normalizeSynthesizedAudio(audioData, 'audio/wav')

  logger.info('MiMo speech synthesis model call completed', {
    providerId: selection.providerId,
    modelId: apiModelId,
    mediaType: audio.mediaType,
    audioDescription: audio.description,
    format: 'wav',
    audioBase64Length: audio.audioBase64.length
  })
  return {
    audioBase64: audio.audioBase64,
    mediaType: audio.mediaType,
    format: 'wav',
    model: selection
  }
}

export async function transcribeAudio(
  selection: SpeechModelSelection,
  audioBase64: string,
  mediaType: string,
  signal: AbortSignal
): Promise<SpeechTranscriptionResult> {
  const audio = Buffer.from(audioBase64, 'base64')
  if (audio.byteLength === 0 || audio.byteLength > MAX_AUDIO_BYTES) {
    throw new Error('Speech audio must be between 1 byte and 25 MiB')
  }

  const apiModelId = getApiModelId(selection)
  if (isMimoSpeechSelection(selection, apiModelId)) {
    return transcribeMimoAudio(selection, audioBase64, mediaType, apiModelId, audio.byteLength, signal)
  }

  const { sdkProvider } = await createSdkProvider(selection)
  if (!sdkProvider.transcriptionModel) {
    throw new Error(`Configured provider does not expose transcription for model '${selection.name}'`)
  }
  logger.info('Calling transcription model', {
    providerId: selection.providerId,
    modelId: apiModelId,
    mediaType,
    audioBytes: audio.byteLength
  })
  const result = await experimental_transcribe({
    model: sdkProvider.transcriptionModel(apiModelId),
    audio,
    abortSignal: signal
  }).catch((error) => {
    logger.error('Transcription model call failed', error, {
      providerId: selection.providerId,
      modelId: apiModelId,
      mediaType,
      audioBytes: audio.byteLength
    })
    throw error
  })
  logger.info('Transcription model call completed', {
    providerId: selection.providerId,
    modelId: apiModelId,
    textLength: result.text.length,
    segmentCount: result.segments.length,
    language: result.language ?? null
  })
  return {
    text: result.text,
    segments: result.segments.map((segment) => ({ ...segment })),
    language: result.language ?? null,
    durationInSeconds: result.durationInSeconds ?? null,
    model: selection
  }
}

function getAudioInputFormat(mediaType: string): 'mp3' | 'wav' {
  if (mediaType === 'audio/wav' || mediaType === 'audio/x-wav') return 'wav'
  if (mediaType === 'audio/mpeg' || mediaType === 'audio/mp3') return 'mp3'
  throw new Error(`Audio pronunciation evaluation requires WAV or MP3 audio, but received '${mediaType}'`)
}

export async function diagnosePronunciationFromAudio(
  selection: SpeechModelSelection,
  input: {
    audioBase64: string
    mediaType: string
    target: string
    meaning?: string
    cefr?: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'
    taskInstruction?: string
    transcript: string
    mode: 'shadowing' | 'spoken_recall'
  },
  signal: AbortSignal
): Promise<PronunciationDiagnosis> {
  const audio = Buffer.from(input.audioBase64, 'base64')
  if (audio.byteLength === 0 || audio.byteLength > MAX_AUDIO_BYTES) {
    throw new Error('Speech audio must be between 1 byte and 25 MiB')
  }

  const apiModelId = getApiModelId(selection)
  const format = getAudioInputFormat(input.mediaType)
  logger.info('Calling audio pronunciation evaluation model', {
    providerId: selection.providerId,
    modelId: apiModelId,
    mediaType: input.mediaType,
    audioBytes: audio.byteLength
  })

  const result = await postOpenAICompatibleChatCompletions(
    selection.providerId,
    {
      model: apiModelId,
      modalities: ['text'],
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You are an English pronunciation coach.',
            'Inspect the learner audio directly. Compare it with the target sentence and transcript.',
            'Return JSON only with source, pronunciation, stress, intonation, pace, wordLevelNotes.',
            'Set source to audio. Be concrete and concise. If a dimension is not judgeable from the audio, say so.'
          ].join(' ')
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                task: input.mode,
                target: input.target,
                meaning: input.meaning,
                cefr: input.cefr,
                taskInstruction: input.taskInstruction,
                transcript: input.transcript,
                requiredJsonShape: {
                  source: 'audio',
                  pronunciation: 'overall pronunciation diagnosis',
                  stress: 'sentence and word stress diagnosis',
                  intonation: 'intonation diagnosis',
                  pace: 'pace and rhythm diagnosis',
                  wordLevelNotes: [{ word: 'word or phrase', issue: 'issue heard', suggestion: 'specific fix' }]
                }
              })
            },
            {
              type: 'input_audio',
              input_audio: {
                data: input.audioBase64,
                format
              }
            }
          ]
        }
      ]
    },
    signal
  ).catch((error) => {
    logger.error('Audio pronunciation evaluation model call failed', error, {
      providerId: selection.providerId,
      modelId: apiModelId,
      mediaType: input.mediaType,
      audioBytes: audio.byteLength
    })
    throw error
  })

  const content = result.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('Audio pronunciation evaluation response did not include text content')
  }

  const parsed = PronunciationDiagnosisSchema.parse(parseJsonObject(content))
  logger.info('Audio pronunciation evaluation model call completed', {
    providerId: selection.providerId,
    modelId: apiModelId,
    wordLevelNoteCount: parsed.wordLevelNotes.length
  })
  return parsed
}

export async function synthesizeSpeech(
  selection: SpeechModelSelection,
  text: string,
  signal: AbortSignal,
  options?: { voice?: string; speed?: number }
): Promise<SpeechSynthesisResult> {
  const apiModelId = getApiModelId(selection)
  if (isMimoSpeechSelection(selection, apiModelId)) {
    return synthesizeMimoSpeech(selection, text, apiModelId, signal, options)
  }

  const { sdkProvider } = await createSdkProvider(selection)
  if (!sdkProvider.speechModel) {
    throw new Error(`Configured provider does not expose speech synthesis for model '${selection.name}'`)
  }
  logger.info('Calling speech synthesis model', {
    providerId: selection.providerId,
    modelId: apiModelId,
    textLength: text.length
  })
  const result = await experimental_generateSpeech({
    model: sdkProvider.speechModel(apiModelId),
    text,
    voice: options?.voice,
    outputFormat: 'mp3',
    speed: options?.speed,
    abortSignal: signal
  }).catch((error) => {
    logger.error('Speech synthesis model call failed', error, {
      providerId: selection.providerId,
      modelId: apiModelId,
      textLength: text.length
    })
    throw error
  })
  const audio = normalizeSynthesizedAudio(result.audio.base64, result.audio.mediaType)
  logger.info('Speech synthesis model call completed', {
    providerId: selection.providerId,
    modelId: apiModelId,
    mediaType: audio.mediaType,
    audioDescription: audio.description,
    format: result.audio.format,
    audioBase64Length: audio.audioBase64.length
  })
  return {
    audioBase64: audio.audioBase64,
    mediaType: audio.mediaType,
    format: result.audio.format,
    model: selection
  }
}
