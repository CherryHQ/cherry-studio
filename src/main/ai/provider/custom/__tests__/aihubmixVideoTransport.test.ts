import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildAihubmixVideoTransport } from '../aihubmix/aihubmixVideoTransport'

function settings(fetchMock: unknown) {
  return { baseURL: 'https://aihubmix.com/v1', apiKey: 'sk-aih', fetch: fetchMock } as never
}

describe('aihubmixVideoTransport', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('submit posts the Sora-shaped body to /videos and extracts id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'vid-1', status: 'queued' })))
    const transport = buildAihubmixVideoTransport(settings(fetchMock))

    const result = await transport.submit({
      modelId: 'sora-2',
      prompt: 'a cat',
      firstFrame: 'https://x/a.png',
      providerParams: { seconds: '8', size: '1280x720' }
    })

    expect(result).toEqual({ taskId: 'vid-1' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://aihubmix.com/v1/videos')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-aih')
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'sora-2',
      prompt: 'a cat',
      input_reference: 'https://x/a.png',
      seconds: '8',
      size: '1280x720'
    })
  })

  it('poll downloads the authenticated /content bytes once completed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'in_progress', progress: 30 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'completed' })))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-type': 'video/mp4' } }))
    const transport = buildAihubmixVideoTransport(settings(fetchMock))

    const promise = transport.poll!('vid-1', {})
    await vi.runAllTimersAsync()
    const artifacts = await promise

    expect(artifacts).toHaveLength(1)
    const artifact = artifacts[0]
    expect('bytes' in artifact && artifact.bytes).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect('bytes' in artifact && artifact.mediaType).toBe('video/mp4')
    // last call is the authenticated content download
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('https://aihubmix.com/v1/videos/vid-1/content')
  })

  it('poll throws on failed status', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: 'failed', error: { message: 'bad' } })))
    const transport = buildAihubmixVideoTransport(settings(fetchMock))
    await expect(transport.poll!('vid-1', {})).rejects.toThrow(/failed: bad/i)
  })
})
