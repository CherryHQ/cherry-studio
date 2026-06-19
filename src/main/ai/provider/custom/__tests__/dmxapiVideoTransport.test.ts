import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildDmxapiVideoTransport, dmxapiUsesVideoTransport } from '../dmxapi/dmxapiVideoTransport'

/** Wrap a parsed object into the DMXAPI OpenAI-Responses envelope (doubly-encoded text). */
function envelope(obj: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ output: [{ content: [{ text: JSON.stringify(obj) }] }] }), { status: 200 })
}

function settings(fetchMock: unknown) {
  return { baseURL: 'https://www.dmxapi.cn/v1', apiKey: 'sk-test', fetch: fetchMock } as never
}

describe('dmxapiVideoTransport (HappyHorse family)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('recognizes only HappyHorse model ids', () => {
    expect(dmxapiUsesVideoTransport('happyhorse-1.0-t2v')).toBe(true)
    expect(dmxapiUsesVideoTransport('happyhorse-1.0-i2v')).toBe(true)
    expect(dmxapiUsesVideoTransport('seedance-1-5-pro-251215')).toBe(false)
  })

  it('submit posts to /v1/responses with raw-key auth and the HappyHorse t2v body, extracting task_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(envelope({ task_id: 'tk-1', task_status: 'PENDING' }))
    const transport = buildDmxapiVideoTransport(settings(fetchMock), 'happyhorse-1.0-t2v')

    const result = await transport.submit({
      modelId: 'happyhorse-1.0-t2v',
      prompt: 'a cat',
      providerParams: { resolution: '1080P', ratio: '16:9', duration: 5 }
    })

    expect(result).toEqual({ taskId: 'tk-1' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://www.dmxapi.cn/v1/responses')
    expect((init.headers as Record<string, string>).Authorization).toBe('sk-test') // raw key, NO Bearer
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('happyhorse-1.0-t2v')
    expect(body.input).toEqual([{ prompt: 'a cat' }])
    expect(body.parameters).toEqual({ resolution: '1080P', ratio: '16:9', duration: 5 })
  })

  it('submit embeds the first frame under input[].media for i2v', async () => {
    const fetchMock = vi.fn().mockResolvedValue(envelope({ task_id: 'tk-2', task_status: 'PENDING' }))
    const transport = buildDmxapiVideoTransport(settings(fetchMock), 'happyhorse-1.0-i2v')

    await transport.submit({
      modelId: 'happyhorse-1.0-i2v',
      prompt: 'make it move',
      firstFrame: 'data:image/png;base64,abc',
      providerParams: {}
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.input).toEqual([
      { prompt: 'make it move', media: [{ type: 'first_frame', url: 'data:image/png;base64,abc' }] }
    ])
  })

  it('poll queries with the family query model and returns video_url on SUCCEEDED', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(envelope({ task_status: 'RUNNING' }))
      .mockResolvedValueOnce(envelope({ task_status: 'SUCCEEDED', video_url: 'https://v/out.mp4' }))
    const transport = buildDmxapiVideoTransport(settings(fetchMock), 'happyhorse-1.0-t2v')

    const promise = transport.poll!('tk-1', {})
    await vi.runAllTimersAsync() // drive the poll loop past the inter-poll wait
    expect(await promise).toEqual([{ url: 'https://v/out.mp4' }])

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ model: 'happyhorse-get', input: 'tk-1' })
  })

  it('poll throws on a terminal FAILED status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(envelope({ task_status: 'FAILED', message: 'boom' }))
    const transport = buildDmxapiVideoTransport(settings(fetchMock), 'happyhorse-1.0-t2v')

    await expect(transport.poll!('tk-1', {})).rejects.toThrow(/failed/i)
  })

  it('throws for an unsupported DMXAPI video model', () => {
    expect(() => buildDmxapiVideoTransport(settings(vi.fn()), 'seedance-1-5-pro-251215')).toThrow(
      /no transport family/i
    )
  })

  describe('Vidu family', () => {
    it('recognizes vidu models', () => {
      expect(dmxapiUsesVideoTransport('viduq3-pro')).toBe(true)
    })

    it('submit parses the FLAT task_id and uses input=prompt for t2v', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ task_id: 'v-1', state: 'created' })))
      const transport = buildDmxapiVideoTransport(settings(fetchMock), 'viduq3-pro')
      const result = await transport.submit({ modelId: 'viduq3-pro', prompt: 'a cat', providerParams: { duration: 5 } })
      expect(result).toEqual({ taskId: 'v-1' })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body).toMatchObject({ model: 'viduq3-pro', input: 'a cat', duration: 5 })
    })

    it('submit uses images[]+input for i2v and input[2]+prompt for keyframe', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ task_id: 'v-2' })))
      const i2v = buildDmxapiVideoTransport(settings(fetchMock), 'viduq3-pro')
      await i2v.submit({ modelId: 'viduq3-pro', prompt: 'go', firstFrame: 'data:img,a', providerParams: {} })
      expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({
        images: ['data:img,a'],
        input: 'go'
      })

      const fetchMock2 = vi.fn().mockResolvedValue(new Response(JSON.stringify({ task_id: 'v-3' })))
      const kf = buildDmxapiVideoTransport(settings(fetchMock2), 'viduq3-pro')
      await kf.submit({
        modelId: 'viduq3-pro',
        prompt: 'go',
        firstFrame: 'data:a',
        lastFrame: 'data:b',
        providerParams: {}
      })
      expect(JSON.parse(fetchMock2.mock.calls[0][1].body as string)).toMatchObject({
        input: ['data:a', 'data:b'],
        prompt: 'go'
      })
    })

    it('poll extracts the video URL from the 视频URL: free-text envelope', async () => {
      const text =
        '[████] 100%\n✅ 视频生成完成！\n视频URL: https://prod-ss-vidu.s3/out.mp4?X-Amz=1\n封面URL: https://x/cover.jpeg'
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output: [{ content: [{ text }] }] })))
      const transport = buildDmxapiVideoTransport(settings(fetchMock), 'viduq3-pro')
      const promise = transport.poll!('v-1', {})
      await vi.runAllTimersAsync()
      expect(await promise).toEqual([{ url: 'https://prod-ss-vidu.s3/out.mp4?X-Amz=1' }])
    })
  })
})
