import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildDmxapiHailuoVideoTransport, dmxapiUsesHailuoTransport } from '../dmxapi/dmxapiHailuoVideoTransport'

function settings(fetchMock: unknown) {
  // The transport uses the global undici `fetch` (not a settings field); stub it.
  vi.stubGlobal('fetch', fetchMock)
  return { baseURL: 'https://www.dmxapi.cn/v1', apiKey: 'sk-test' } as never
}

describe('dmxapiHailuoVideoTransport', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('recognizes MiniMax-Hailuo model ids (case-insensitive)', () => {
    expect(dmxapiUsesHailuoTransport('MiniMax-Hailuo-2.3')).toBe(true)
    expect(dmxapiUsesHailuoTransport('MiniMax-Hailuo-02')).toBe(true)
    expect(dmxapiUsesHailuoTransport('happyhorse-1.0-t2v')).toBe(false)
  })

  it('submit posts to /v1/video_generation with raw-key auth and extracts task_id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ task_id: '335492703728059', base_resp: { status_code: 0 } })))
    const transport = buildDmxapiHailuoVideoTransport(settings(fetchMock))

    const result = await transport.submit({
      modelId: 'MiniMax-Hailuo-2.3',
      prompt: 'a cat',
      firstFrame: 'data:image/png;base64,abc',
      providerParams: { resolution: '768P', duration: 6 }
    })

    expect(result).toEqual({ taskId: '335492703728059' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://www.dmxapi.cn/v1/video_generation')
    expect((init.headers as Record<string, string>).Authorization).toBe('sk-test') // raw, no Bearer
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'MiniMax-Hailuo-2.3',
      prompt: 'a cat',
      first_frame_image: 'data:image/png;base64,abc',
      resolution: '768P',
      duration: 6
    })
  })

  it('submit throws when base_resp.status_code is non-zero', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ base_resp: { status_code: 1004, status_msg: 'auth failed' } })))
    const transport = buildDmxapiHailuoVideoTransport(settings(fetchMock))
    await expect(transport.submit({ modelId: 'MiniMax-Hailuo-2.3', prompt: 'x', providerParams: {} })).rejects.toThrow(
      /auth failed/i
    )
  })

  it('poll runs the 3-step flow: query Processing → Success(file_id) → files/retrieve(download_url)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'Processing', base_resp: { status_code: 0 } })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'Success', file_id: 'file-9', base_resp: { status_code: 0 } }))
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ file: { download_url: 'https://oss/out.mp4?sig=1' }, base_resp: { status_code: 0 } })
        )
      )
    const transport = buildDmxapiHailuoVideoTransport(settings(fetchMock))

    const promise = transport.poll!('335492703728059', {})
    await vi.runAllTimersAsync()
    expect(await promise).toEqual([{ url: 'https://oss/out.mp4?sig=1' }])

    expect(fetchMock.mock.calls[0][0]).toBe('https://www.dmxapi.cn/v1/query/video_generation?task_id=335492703728059')
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
      'https://www.dmxapi.cn/v1/files/retrieve?file_id=file-9&task_id=335492703728059'
    )
  })

  it('poll throws on a Failed status', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: 'Failed', base_resp: { status_code: 0 } })))
    const transport = buildDmxapiHailuoVideoTransport(settings(fetchMock))
    await expect(transport.poll!('tk', {})).rejects.toThrow(/failed/i)
  })
})
