import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { userModelTable } from '@main/data/db/schemas/userModel'
import { userProviderTable } from '@main/data/db/schemas/userProvider'
import { ENDPOINT_TYPE, MODEL_CAPABILITY, type EndpointType } from '@shared/data/types/model'

import { startSpeech } from '../execution'
import type { SpeechRequest } from '../executionTypes'
import { listSpeechModels, listSpeechVoices, resolveSpeechConfiguration } from '../speechModels'

async function generateModelSpeech(
  modelId: SpeechRequest['modelId'],
  text: string,
  options: SpeechRequest['options'],
  signal: AbortSignal
) {
  const execution = startSpeech({ modelId, input: { kind: 'text', text }, output: 'audio', options }, signal)
  const result = await execution.output
  await execution.closed
  if (result.kind !== 'audio') throw new Error('Cloud speech must return complete audio')
  return result
}

const pcm = Buffer.from([0, 0, 255, 127, 0, 128, 1, 0])
function geminiResponse(mimeType = 'audio/L16;codec=pcm;rate=24000', finishReason = 'STOP') {
  return Response.json({
    candidates: [{ finishReason, content: { parts: [{ inlineData: { mimeType, data: pcm.toString('base64') } }] } }]
  })
}

const dbh = setupTestDatabase()
function addModel(providerId: string, modelId: string, endpoint: EndpointType) {
  dbh.db
    .insert(userProviderTable)
    .values({
      providerId,
      name: providerId,
      isEnabled: true,
      orderKey: 'a0',
      apiKeys: [{ id: 'test', key: 'test-key', isEnabled: true }],
      endpointConfigs: {
        [endpoint]: {
          baseUrl: 'https://speech.example/api',
          adapterFamily: endpoint === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT ? 'google' : 'openai'
        }
      },
      defaultChatEndpoint: endpoint,
      providerSettings: { extraHeaders: { 'X-Test': 'speech' } }
    })
    .run()
  dbh.db
    .insert(userModelTable)
    .values({
      id: `${providerId}::${modelId}`,
      providerId,
      modelId,
      name: modelId,
      orderKey: 'a0',
      capabilities: [MODEL_CAPABILITY.AUDIO_GENERATION],
      inputModalities: ['text'],
      outputModalities: ['audio'],
      endpointTypes: [endpoint],
      supportsStreaming: false,
      isEnabled: true,
      isHidden: false,
      isDeprecated: false
    })
    .run()
}

beforeEach(() => {
  const getPath = vi.mocked(application.getPath).getMockImplementation()!
  vi.spyOn(application, 'getPath').mockImplementation((key, filename) =>
    key === 'feature.provider_registry.data'
      ? resolve('packages/provider-registry/data', filename ?? '')
      : key === 'app.root'
        ? resolve(filename ?? '')
        : getPath(key, filename)
  )
  addModel('speech-openai', 'tts-1', ENDPOINT_TYPE.OPENAI_TEXT_TO_SPEECH)
  addModel('speech-google', 'gemini-2.5-flash-preview-tts', ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT)
  dbh.db
    .update(userProviderTable)
    .set({ presetProviderId: 'gemini' })
    .where(eq(userProviderTable.providerId, 'speech-google'))
    .run()
  dbh.db
    .update(userModelTable)
    .set({ presetModelId: 'gemini-2-5-flash-preview-tts', endpointTypes: null })
    .where(eq(userModelTable.providerId, 'speech-google'))
    .run()
})
afterEach(() => vi.restoreAllMocks())

describe('configured cloud speech', () => {
  it('lists only finite speech models and keeps unavailable explicit selections', async () => {
    addModel('live-google', 'gemini-live-audio', ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT)
    dbh.db
      .update(userModelTable)
      .set({ inputModalities: ['text', 'audio'] })
      .where(eq(userModelTable.providerId, 'live-google'))
      .run()
    expect(
      listSpeechModels()
        .map(({ id }) => id)
        .sort()
    ).toEqual(['speech-google::gemini-2.5-flash-preview-tts', 'speech-openai::tts-1'])
    expect(await resolveSpeechConfiguration({ modelId: 'missing::tts-1' })).toMatchObject({
      modelId: 'missing::tts-1',
      status: { status: 'unsupported' }
    })
    expect(await resolveSpeechConfiguration({ modelId: 'speech-openai::tts-1', voice: 'Kore' })).toMatchObject({
      status: { reason: 'voice_unavailable' }
    })
    expect(await listSpeechVoices('speech-openai::tts-1')).not.toContainEqual({ id: 'marin', name: 'marin' })
  })

  it('uses declared speech metadata for opaque model IDs and does not guess from names', () => {
    addModel('opaque', 'deployment-42', ENDPOINT_TYPE.OPENAI_TEXT_TO_SPEECH)
    dbh.db
      .update(userModelTable)
      .set({ capabilities: [], endpointTypes: null })
      .where(eq(userModelTable.providerId, 'opaque'))
      .run()
    addModel('chat', 'custom-tts', ENDPOINT_TYPE.OPENAI_RESPONSES)
    const ids = listSpeechModels().map(({ id }) => id)
    expect(ids).toContain('opaque::deployment-42')
    expect(listSpeechModels().find(({ id }) => id === 'opaque::deployment-42')?.capabilities).toContain(
      MODEL_CAPABILITY.AUDIO_GENERATION
    )
    expect(ids).not.toContain('chat::custom-tts')
  })

  it.each([
    [ENDPOINT_TYPE.OPENAI_TEXT_TO_SPEECH, 'https://speech.example/api'],
    [ENDPOINT_TYPE.OPENAI_RESPONSES, 'https://speech.example/api'],
    [ENDPOINT_TYPE.OPENAI_TEXT_TO_SPEECH, 'https://speech.example/api/v1/audio/speech#']
  ] as const)('uses the configured OpenAI host with endpoint %s', async (endpoint, baseUrl) => {
    dbh.db
      .update(userProviderTable)
      .set({
        presetProviderId: 'openai',
        endpointConfigs: { [ENDPOINT_TYPE.OPENAI_TEXT_TO_SPEECH]: { baseUrl, adapterFamily: 'openai' } },
        defaultChatEndpoint: endpoint
      })
      .where(eq(userProviderTable.providerId, 'speech-openai'))
      .run()
    dbh.db
      .update(userModelTable)
      .set(
        endpoint === ENDPOINT_TYPE.OPENAI_RESPONSES
          ? { presetModelId: 'tts-1', endpointTypes: null }
          : { endpointTypes: [endpoint] }
      )
      .where(eq(userModelTable.id, 'speech-openai::tts-1'))
      .run()

    const wav = Buffer.alloc(46)
    wav.write('RIFF')
    wav.writeUInt32LE(38, 4)
    wav.write('WAVE', 8)
    vi.spyOn(net, 'fetch').mockImplementation(async (url, init) => {
      expect(String(url)).toBe('https://speech.example/api/v1/audio/speech')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-key')
      expect(new Headers(init?.headers).get('X-Test')).toBe('speech')
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: 'tts-1',
        input: 'Hello',
        voice: 'nova',
        speed: 1.25,
        response_format: 'wav'
      })
      return new Response(wav)
    })
    const result = await generateModelSpeech(
      'speech-openai::tts-1',
      'Hello',
      { voice: 'nova', speed: 1.25 },
      new AbortController().signal
    )
    expect(result.audio).toEqual(new Uint8Array(wav))
    expect(result.playbackRate).toBeUndefined()
  })

  it('preserves Gemini PCM samples and sample rate in a complete WAV and applies speed at playback', async () => {
    vi.spyOn(net, 'fetch').mockImplementation(async (url, init) => {
      expect(String(url)).toBe('https://speech.example/api/v1beta/models/gemini-2.5-flash-preview-tts:generateContent')
      expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('test-key')
      expect(JSON.parse(String(init?.body))).toEqual({
        contents: [{ role: 'user', parts: [{ text: '你好' }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
        }
      })
      return geminiResponse()
    })
    const result = await generateModelSpeech(
      'speech-google::gemini-2.5-flash-preview-tts',
      '你好',
      { voice: 'Kore', speed: 1.5 },
      new AbortController().signal
    )
    const wav = Buffer.from(result.audio)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.readUInt32LE(4) + 8).toBe(wav.length)
    const fmt = wav.indexOf('fmt ')
    expect(wav.readUInt32LE(fmt + 12)).toBe(24000)
    const data = wav.indexOf('data')
    expect(wav.subarray(data + 8)).toEqual(pcm)
    expect(result.playbackRate).toBe(1.5)
  })

  it.each([
    ['audio/mpeg', 'STOP'],
    ['audio/L16;codec=pcm;rate=24000', 'MAX_TOKENS']
  ])('rejects unsupported or truncated Gemini audio (%s, %s)', async (mime, reason) => {
    vi.spyOn(net, 'fetch').mockResolvedValue(geminiResponse(mime, reason))
    await expect(
      generateModelSpeech(
        'speech-google::gemini-2.5-flash-preview-tts',
        'Hello',
        { voice: 'Kore' },
        new AbortController().signal
      )
    ).rejects.toThrow()
  })

  it.each([
    ['tts-1', 'tts-1', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, 'nova', 'v1/audio/speech'],
    [
      'gemini-2.5-flash-preview-tts',
      'gemini-2-5-flash-preview-tts',
      ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
      'Kore',
      'v1beta/models/gemini-2.5-flash-preview-tts:generateContent'
    ]
  ] as const)(
    'reads %s through a New API relay using its advertised protocol',
    async (modelId, presetModelId, endpointType, voice, path) => {
      addModel('speech-relay', modelId, endpointType)
      dbh.db
        .update(userProviderTable)
        .set({
          presetProviderId: 'new-api',
          defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
          endpointConfigs: {
            [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
              baseUrl: 'https://relay.example/proxy/v1',
              adapterFamily: 'newapi'
            }
          }
        })
        .where(eq(userProviderTable.providerId, 'speech-relay'))
        .run()
      dbh.db.update(userModelTable).set({ presetModelId }).where(eq(userModelTable.providerId, 'speech-relay')).run()
      expect(listSpeechModels().map(({ id }) => id)).toContain(`speech-relay::${modelId}`)
      const wav = Buffer.alloc(46)
      wav.write('RIFF')
      wav.writeUInt32LE(38, 4)
      wav.write('WAVE', 8)
      vi.spyOn(net, 'fetch').mockImplementation(async (url, init) => {
        expect(String(url)).toBe(`https://relay.example/proxy/${path}`)
        const headers = new Headers(init?.headers)
        if (endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT) {
          expect(headers.get('x-goog-api-key')).toBe('test-key')
          expect(
            JSON.parse(String(init?.body)).generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName
          ).toBe('Kore')
          return geminiResponse()
        }
        expect(headers.get('authorization')).toBe('Bearer test-key')
        expect(JSON.parse(String(init?.body))).toMatchObject({
          model: modelId,
          input: 'Hello',
          voice: 'nova',
          response_format: 'wav'
        })
        return new Response(wav)
      })
      const result = await generateModelSpeech(
        `speech-relay::${modelId}`,
        'Hello',
        { voice },
        new AbortController().signal
      )
      expect(Buffer.from(result.audio).toString('ascii', 0, 4)).toBe('RIFF')
    }
  )

  it('rejects streaming for finite cloud models before making a request', () => {
    expect(() =>
      startSpeech({
        modelId: 'speech-openai::tts-1',
        input: { kind: 'text', text: 'Hello' },
        output: 'pcm-stream',
        options: { voice: 'nova' }
      })
    ).toThrow('unsupported')
    expect(listSpeechModels().find(({ id }) => id === 'speech-openai::tts-1')?.voiceCapabilities).toEqual({
      speech: [{ input: 'text', output: 'audio' }]
    })
  })

  it('cancels an in-flight cloud execution and waits for the request to settle', async () => {
    const started = Promise.withResolvers<AbortSignal>()
    vi.spyOn(net, 'fetch').mockImplementation(async (_url, init) => {
      const signal = init?.signal
      if (!signal) throw new Error('Cloud synthesis requires an abort signal')
      started.resolve(signal)
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    const execution = startSpeech({
      modelId: 'speech-openai::tts-1',
      input: { kind: 'text', text: 'Hello' },
      output: 'audio',
      options: { voice: 'nova' }
    })
    const rejected = expect(execution.output).rejects.toBeDefined()
    const signal = await started.promise
    await execution.cancel()
    await rejected
    expect(signal.aborted).toBe(true)
    await expect(execution.closed).resolves.toBeUndefined()
  })

  it('discards a cloud response arriving after cancellation', async () => {
    const controller = new AbortController()
    vi.spyOn(net, 'fetch').mockImplementation(async () => {
      controller.abort()
      return geminiResponse()
    })
    await expect(
      generateModelSpeech('speech-google::gemini-2.5-flash-preview-tts', 'Hello', { voice: 'Kore' }, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
