import type { SpeechModelSelection } from '@shared/ai/speech'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { customFetchMock, getByProviderIdMock, getByKeyMock, getRotatedApiKeyMock } = vi.hoisted(() => ({
  customFetchMock: vi.fn(),
  getByProviderIdMock: vi.fn(),
  getByKeyMock: vi.fn(),
  getRotatedApiKeyMock: vi.fn()
}))

vi.mock('@cherrystudio/ai-core/provider', () => ({
  extensionRegistry: {
    createProvider: vi.fn()
  }
}))

vi.mock('../../provider/factory', () => ({}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@main/data/services/ModelService', () => ({
  modelService: {
    getByKey: getByKeyMock
  }
}))

vi.mock('@main/data/services/ProviderService', () => ({
  providerService: {
    getByProviderId: getByProviderIdMock,
    getRotatedApiKey: getRotatedApiKeyMock
  }
}))

vi.mock('../../provider/config', () => ({
  providerToAiSdkConfig: vi.fn()
}))

vi.mock('../../utils/customFetch', () => ({
  customFetch: customFetchMock
}))

vi.mock('ai', () => ({
  experimental_generateSpeech: vi.fn(),
  experimental_transcribe: vi.fn()
}))

const { diagnosePronunciationFromAudio, synthesizeSpeech, transcribeAudio } = await import('../speechAdapters')

const selection: SpeechModelSelection = {
  uniqueModelId: 'mimo::mimo-v2.5-asr',
  providerId: 'mimo',
  modelId: 'mimo-v2.5-asr',
  name: 'mimo-v2.5-asr'
}

function mockMimoProvider() {
  getByProviderIdMock.mockReturnValue({
    id: 'mimo',
    defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    endpointConfigs: {
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
        baseUrl: 'https://api.xiaomimimo.com'
      }
    },
    settings: {
      extraHeaders: {
        'X-Test': 'yes'
      }
    }
  })
  getRotatedApiKeyMock.mockReturnValue('sk-mimo-test')
}

function mockJsonResponse(value: unknown) {
  customFetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: () => Promise.resolve(JSON.stringify(value))
  })
}

function makePcmWavBase64(): string {
  const bytes = Buffer.alloc(44)
  bytes.write('RIFF', 0, 'ascii')
  bytes.writeUInt32LE(36, 4)
  bytes.write('WAVE', 8, 'ascii')
  bytes.write('fmt ', 12, 'ascii')
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(24_000, 24)
  bytes.writeUInt32LE(48_000, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36, 'ascii')
  bytes.writeUInt32LE(0, 40)
  return bytes.toString('base64')
}

beforeEach(() => {
  vi.clearAllMocks()
  mockMimoProvider()
})

describe('MiMo speech adapter', () => {
  it('transcribes WAV audio through MiMo chat completions input_audio', async () => {
    getByKeyMock.mockReturnValue({ apiModelId: 'mimo-v2.5-asr' })
    mockJsonResponse({ choices: [{ message: { content: 'hello world' } }] })

    const audioBase64 = Buffer.from([1, 2, 3]).toString('base64')
    const result = await transcribeAudio(selection, audioBase64, 'audio/wav', new AbortController().signal)

    expect(result.text).toBe('hello world')
    expect(customFetchMock).toHaveBeenCalledTimes(1)
    const [url, request] = customFetchMock.mock.calls[0]
    expect(url).toBe('https://api.xiaomimimo.com/v1/chat/completions')
    expect(request.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Test': 'yes',
      'api-key': 'sk-mimo-test'
    })
    const body = JSON.parse(request.body)
    expect(body).toMatchObject({
      model: 'mimo-v2.5-asr',
      asr_options: { language: 'auto' }
    })
    expect(body.messages[0].content[0]).toEqual({
      type: 'input_audio',
      input_audio: {
        data: `data:audio/wav;base64,${audioBase64}`
      }
    })
  })

  it('rejects WebM audio before sending it to MiMo recognition', async () => {
    getByKeyMock.mockReturnValue({ apiModelId: 'mimo-v2.5-asr' })

    await expect(
      transcribeAudio(selection, 'AQID', 'audio/webm;codecs=opus', new AbortController().signal)
    ).rejects.toThrow("MiMo speech recognition requires WAV or MP3 audio, but received 'audio/webm;codecs=opus'")
    expect(customFetchMock).not.toHaveBeenCalled()
  })

  it('synthesizes speech through MiMo chat completions assistant audio output', async () => {
    getByKeyMock.mockReturnValue({ apiModelId: 'mimo-v2.5-tts' })
    const audioBase64 = makePcmWavBase64()
    mockJsonResponse({ choices: [{ message: { audio: { data: audioBase64 } } }] })

    const result = await synthesizeSpeech(
      {
        uniqueModelId: 'mimo::mimo-v2.5-tts',
        providerId: 'mimo',
        modelId: 'mimo-v2.5-tts',
        name: 'mimo-v2.5-tts'
      },
      'Could you say that again?',
      new AbortController().signal
    )

    expect(result).toMatchObject({
      audioBase64,
      mediaType: 'audio/wav',
      format: 'wav'
    })
    expect(customFetchMock).toHaveBeenCalledTimes(1)
    const [, request] = customFetchMock.mock.calls[0]
    const body = JSON.parse(request.body)
    expect(body).toEqual({
      model: 'mimo-v2.5-tts',
      messages: [{ role: 'assistant', content: 'Could you say that again?' }],
      audio: {
        format: 'wav',
        voice: 'mimo_default'
      }
    })
  })

  it('rejects MiMo synthesis responses that are not playable audio', async () => {
    getByKeyMock.mockReturnValue({ apiModelId: 'mimo-v2.5-tts' })
    mockJsonResponse({ choices: [{ message: { audio: { data: Buffer.from('not audio').toString('base64') } } }] })

    await expect(
      synthesizeSpeech(
        {
          uniqueModelId: 'mimo::mimo-v2.5-tts',
          providerId: 'mimo',
          modelId: 'mimo-v2.5-tts',
          name: 'mimo-v2.5-tts'
        },
        'Could you say that again?',
        new AbortController().signal
      )
    ).rejects.toThrow('Speech synthesis returned unsupported audio bytes')
  })

  it('rejects WAV-like MiMo synthesis responses without a supported fmt chunk', async () => {
    getByKeyMock.mockReturnValue({ apiModelId: 'mimo-v2.5-tts' })
    mockJsonResponse({ choices: [{ message: { audio: { data: Buffer.from('RIFF----WAVE').toString('base64') } } }] })

    await expect(
      synthesizeSpeech(
        {
          uniqueModelId: 'mimo::mimo-v2.5-tts',
          providerId: 'mimo',
          modelId: 'mimo-v2.5-tts',
          name: 'mimo-v2.5-tts'
        },
        'Could you say that again?',
        new AbortController().signal
      )
    ).rejects.toThrow('Speech synthesis returned unsupported audio bytes')
  })
})

describe('audio pronunciation diagnosis adapter', () => {
  it('evaluates pronunciation with OpenAI-compatible chat completions input_audio', async () => {
    getByProviderIdMock.mockReturnValue({
      id: 'openai',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: 'https://api.openai.com'
        }
      },
      settings: {
        extraHeaders: {}
      }
    })
    getRotatedApiKeyMock.mockReturnValue('sk-openai-test')
    getByKeyMock.mockReturnValue({ apiModelId: 'gpt-audio-1.5' })
    mockJsonResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              source: 'audio',
              pronunciation: 'The /th/ sound is unclear.',
              stress: 'Sentence stress is mostly natural.',
              intonation: 'Rising tone at the end sounds like a question.',
              pace: 'Pace is a little fast.',
              wordLevelNotes: [
                { word: 'that', issue: 'TH sounded like D', suggestion: 'Place tongue lightly between teeth.' }
              ]
            })
          }
        }
      ]
    })

    const audioBase64 = Buffer.from([1, 2, 3]).toString('base64')
    const result = await diagnosePronunciationFromAudio(
      {
        uniqueModelId: 'openai::gpt-audio-1.5',
        providerId: 'openai',
        modelId: 'gpt-audio-1.5',
        name: 'gpt-audio-1.5'
      },
      {
        audioBase64,
        mediaType: 'audio/wav',
        target: 'Could you say that again?',
        transcript: 'Could you say that again',
        mode: 'shadowing'
      },
      new AbortController().signal
    )

    expect(result.source).toBe('audio')
    expect(result.wordLevelNotes[0]).toMatchObject({ word: 'that' })
    expect(customFetchMock).toHaveBeenCalledTimes(1)
    const [url, request] = customFetchMock.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(request.headers).toMatchObject({
      Authorization: 'Bearer sk-openai-test',
      'Content-Type': 'application/json'
    })
    const body = JSON.parse(request.body)
    expect(body).toMatchObject({
      model: 'gpt-audio-1.5',
      modalities: ['text'],
      response_format: { type: 'json_object' }
    })
    expect(body.messages[1].content[1]).toEqual({
      type: 'input_audio',
      input_audio: {
        data: audioBase64,
        format: 'wav'
      }
    })
  })
})
