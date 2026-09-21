import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FILE_TYPE, FileInfoSchema } from '@shared/types/file'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }
}))

const { fetchMock, openAsBlobMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  openAsBlobMock: vi.fn()
}))

vi.mock('electron', () => ({
  net: { fetch: fetchMock }
}))

vi.mock('node:fs', () => ({
  openAsBlob: openAsBlobMock
}))

import { openaiTranscriptionAudioToTextHandler } from '../handler'

const audioFile = FileInfoSchema.parse({
  path: '/tmp/talk.mp3',
  name: 'talk',
  size: 2048,
  ext: 'mp3',
  mime: 'audio/mpeg',
  type: FILE_TYPE.AUDIO,
  createdAt: 1,
  modifiedAt: 1
})

const config = {
  id: 'openai-transcription' as const,
  type: 'api' as const,
  apiKeys: ['sk-test'],
  capabilities: [
    {
      feature: 'audio_to_text' as const,
      inputs: ['audio' as const],
      output: 'text' as const,
      apiHost: 'https://api.openai.com',
      modelId: 'whisper-1'
    }
  ]
}

async function execute(preparedConfig = config) {
  const prepared = await openaiTranscriptionAudioToTextHandler.prepare(audioFile, preparedConfig)
  if (prepared.mode !== 'background') throw new Error('expected background handler')
  return prepared.execute({
    signal: new AbortController().signal,
    reportProgress: () => {}
  })
}

describe('openaiTranscriptionAudioToTextHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    openAsBlobMock.mockResolvedValue(new Blob(['audio']))
  })

  it('requests verbose_json + segment granularity for whisper-1', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        text: 'hello world',
        segments: [
          { start: 0, end: 1.25, text: ' hello' },
          { start: 1.25, end: 2.5, text: ' world' }
        ]
      })
    })

    const result = await execute()
    expect(result).toEqual({
      kind: 'text',
      text: 'hello world',
      segments: [
        { startMs: 0, endMs: 1250, text: 'hello' },
        { startMs: 1250, endMs: 2500, text: 'world' }
      ]
    })

    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData
    expect(body.get('response_format')).toBe('verbose_json')
    expect(body.get('timestamp_granularities[]')).toBe('segment')
  })

  it('uses json without timestamp granularities for non-whisper models', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'plain' })
    })
    const nonWhisper = {
      ...config,
      capabilities: [{ ...config.capabilities[0], modelId: 'gpt-4o-mini-transcribe' }]
    }
    const result = await execute(nonWhisper)
    expect(result).toEqual({ kind: 'text', text: 'plain' })
    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData
    expect(body.get('response_format')).toBe('json')
    expect(body.get('timestamp_granularities[]')).toBeNull()
  })

  it('retries 429 but not 401', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests', text: async () => 'slow' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ text: 'recovered' }) })
    await expect(execute()).resolves.toEqual({ kind: 'text', text: 'recovered' })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fetchMock.mockReset()
    openAsBlobMock.mockResolvedValue(new Blob(['audio']))
    fetchMock.mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized', text: async () => 'nope' })
    await expect(execute()).rejects.toThrow(/401/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects oversized uploads before fetch', async () => {
    const huge = FileInfoSchema.parse({ ...audioFile, size: 25_000_001 })
    expect(() => openaiTranscriptionAudioToTextHandler.prepare(huge, config)).toThrow(/25_000_000|25000000/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('propagates cancellation without retrying', async () => {
    vi.clearAllMocks()
    openAsBlobMock.mockResolvedValue(new Blob(['audio']))
    const controller = new AbortController()
    fetchMock.mockImplementation(async (_url: string, init?: { signal?: AbortSignal }) => {
      init?.signal?.throwIfAborted()
      controller.abort(new Error('cancel-me'))
      init?.signal?.throwIfAborted()
      throw controller.signal.reason
    })
    const prepared = await openaiTranscriptionAudioToTextHandler.prepare(audioFile, config)
    if (prepared.mode !== 'background') throw new Error('expected background handler')
    // Abort before execute so the loop hits throwIfAborted / fetch abort path once.
    controller.abort(new Error('cancel-me'))
    await expect(prepared.execute({ signal: controller.signal, reportProgress: () => {} })).rejects.toThrow(/cancel-me/)
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('rejects when no API key is configured', () => {
    expect(() => openaiTranscriptionAudioToTextHandler.prepare(audioFile, { ...config, apiKeys: [] })).toThrow(
      'API key is required'
    )
  })
})
