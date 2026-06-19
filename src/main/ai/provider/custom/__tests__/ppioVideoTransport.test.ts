import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildPpioVideoTransport } from '../ppio/ppioVideoTransport'

function settings(fetchMock: unknown) {
  return { baseURL: 'https://api.ppio.com/v3/openai', apiKey: 'sk-ppio', fetch: fetchMock } as never
}

describe('ppioVideoTransport', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('submit posts the flat body to /v3/video/create with Bearer auth and extracts task_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ task_id: 'tk-1' })))
    const transport = buildPpioVideoTransport(settings(fetchMock))

    const result = await transport.submit({
      modelId: 'minimax_hailuo2.3_i2v',
      prompt: 'a cat',
      firstFrame: 'data:image/png;base64,abc',
      providerParams: { resolution: '768P', duration: '6' }
    })

    expect(result).toEqual({ taskId: 'tk-1' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.ppio.com/v3/video/create')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-ppio')
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'minimax_hailuo2.3_i2v',
      prompt: 'a cat',
      image: 'data:image/png;base64,abc',
      resolution: '768P',
      duration: '6'
    })
  })

  it('poll GETs task-result and returns video_url on TASK_STATUS_SUCCEED', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ task: { status: 'TASK_STATUS_PROCESSING', progress_percent: 40 } }))
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ task: { status: 'TASK_STATUS_SUCCEED' }, videos: [{ video_url: 'https://v/o.mp4' }] })
        )
      )
    const transport = buildPpioVideoTransport(settings(fetchMock))

    const promise = transport.poll!('tk-1', {})
    await vi.runAllTimersAsync()
    expect(await promise).toEqual([{ url: 'https://v/o.mp4' }])
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.ppio.com/v3/async/task-result?task_id=tk-1')
  })

  it('poll throws on TASK_STATUS_FAILED', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ task: { status: 'TASK_STATUS_FAILED', reason: 'nope' } })))
    const transport = buildPpioVideoTransport(settings(fetchMock))
    await expect(transport.poll!('tk-1', {})).rejects.toThrow(/failed: nope/i)
  })
})
