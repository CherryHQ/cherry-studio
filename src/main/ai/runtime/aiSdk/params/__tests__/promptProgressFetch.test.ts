import { describe, expect, it, vi } from 'vitest'

import { createPromptProgressFetch } from '../promptProgressFetch'

describe('prompt progress fetch', () => {
  it('consumes progress-only events and reports the prefill estimate before content', async () => {
    const sink = vi.fn()
    const event = 'data: {"prompt_progress":{"total":1000,"processed":620,"cache":0,"time_ms":10000}}\n\n'
    const content = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'
    const fetch = createPromptProgressFetch(async () => new Response(event + content), sink)
    const response = await fetch('https://example.com/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ stream: true, messages: [] })
    })
    expect(await response.text()).not.toContain('prompt_progress')
    expect(sink).toHaveBeenCalledWith({ percent: 62, etaMs: expect.closeTo(6129.032, 2) })
    expect(sink).toHaveBeenLastCalledWith(null)
  })
})

describe('prompt progress validation and negotiation', () => {
  const url = 'https://example.com/v1/chat/completions'
  const init = { method: 'POST', body: JSON.stringify({ stream: true, messages: [] }) }
  const sample = { total: 1000, processed: 620, cache: 0, time_ms: 10000 }
  const responseFor = (value: unknown) => new Response(`data: ${JSON.stringify({ prompt_progress: value })}\n\n`)

  it.each([
    [{ ...sample, cache: 200 }, 62, 9047.619],
    [{ ...sample, processed: 1000 }, 100, 0]
  ])('derives valid reports', async (value, percent, eta) => {
    const sink = vi.fn()
    const response = await createPromptProgressFetch(async () => responseFor(value), sink)(url, init)
    await response.text()
    expect(sink).toHaveBeenCalledWith({ percent, etaMs: expect.closeTo(eta, 2) })
  })

  it.each([
    null,
    [],
    {},
    { ...sample, total: 0 },
    { ...sample, processed: -1 },
    { ...sample, processed: 1001 },
    { ...sample, cache: 620 },
    { ...sample, time_ms: '1' },
    { ...sample, total: Infinity }
  ])('clears invalid reports', async (value) => {
    const sink = vi.fn()
    const events = `data: ${JSON.stringify({ prompt_progress: sample })}\n\ndata: ${JSON.stringify({ prompt_progress: value })}\n\n`
    const response = await createPromptProgressFetch(async () => new Response(events), sink)(url, init)
    await response.text()
    expect(sink).toHaveBeenCalledWith(null)
    expect(sink.mock.calls.filter(([data]) => data !== null)).toHaveLength(1)
  })

  it.each([400, 422])('retries a %i rejected opt-in once without losing custom parameters', async (status) => {
    const calls: Record<string, unknown>[] = []
    const transport: typeof fetch = async (_input, request) => {
      calls.push(JSON.parse(request!.body as string))
      return calls.length === 1 ? new Response('unsupported', { status }) : new Response('data: [DONE]\n\n')
    }
    const fetch = createPromptProgressFetch(transport, vi.fn())
    const response = await fetch(url, { ...init, body: JSON.stringify({ stream: true, messages: [], custom: 42 }) })
    await response.text()
    expect(calls).toEqual([
      { stream: true, messages: [], custom: 42, return_progress: true },
      { stream: true, messages: [], custom: 42 }
    ])
  })

  it('leaves non-streaming requests and responses untouched', async () => {
    const original = new Response('plain response')
    const transport = vi.fn<typeof fetch>(async () => original)
    const request = { method: 'POST', body: JSON.stringify({ stream: false, messages: [] }) }
    const response = await createPromptProgressFetch(transport, vi.fn())(url, request)
    expect(transport).toHaveBeenCalledWith(url, request)
    expect(response).toBe(original)
  })

  it('does not publish anything when no progress is reported', async () => {
    const sink = vi.fn()
    const response = await createPromptProgressFetch(async () => new Response('data: [DONE]\n\n'), sink)(url, init)
    await response.text()
    expect(sink).not.toHaveBeenCalled()
  })

  it.each(['/v1/responses', '/v1/messages', '/api/chat', '/v1/embeddings'])(
    'leaves unrelated endpoints untouched',
    async (path) => {
      const transport = vi.fn<typeof fetch>(async () => new Response())
      await createPromptProgressFetch(transport, vi.fn())(`https://example.com${path}`, init)
      expect(transport).toHaveBeenCalledWith(`https://example.com${path}`, init)
    }
  )
})

describe('SSE framing', () => {
  it('consumes multiline CRLF progress and forwards split UTF-8 content', async () => {
    const source = new TextEncoder().encode(
      'data: {"prompt_progress":\r\ndata: {"total":1000,"processed":620,"cache":0,"time_ms":10000}}\r\n\r\ndata: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: [DONE]\r\n\r\n'
    )
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of source) controller.enqueue(Uint8Array.of(byte))
        controller.close()
      }
    })
    const sink = vi.fn()
    const response = await createPromptProgressFetch(async () => new Response(stream), sink)(
      'https://example.com/chat/completions',
      { method: 'POST', body: '{"stream":true,"messages":[]}' }
    )
    const output = await response.text()
    expect(output).toContain('你好')
    expect(output).toContain('[DONE]')
    expect(output).not.toContain('prompt_progress')
    expect(sink).toHaveBeenCalledWith({ percent: 62, etaMs: expect.closeTo(6129.032, 2) })
  })

  it('forwards mixed progress and content while clearing the progress', async () => {
    const mixed = {
      prompt_progress: { total: 10, processed: 5, cache: 0, time_ms: 100 },
      choices: [{ delta: { content: 'answer' } }]
    }
    const sink = vi.fn()
    const response = await createPromptProgressFetch(
      async () =>
        new Response(
          `data: ${JSON.stringify({ prompt_progress: mixed.prompt_progress })}\n\ndata: ${JSON.stringify(mixed)}\n\n`
        ),
      sink
    )('https://example.com/chat/completions', { method: 'POST', body: '{"stream":true,"messages":[]}' })
    expect(await response.text()).toContain(JSON.stringify(mixed))
    expect(sink).toHaveBeenCalledWith(null)
  })
})

describe('progress lifecycle', () => {
  it('does not publish an older pending value after a newer immediate value', async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        source = controller
      }
    })
    const sink = vi.fn()
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
    try {
      const response = await createPromptProgressFetch(async () => new Response(stream), sink)(
        'https://example.com/chat/completions',
        { method: 'POST', body: '{"stream":true,"messages":[]}' }
      )
      const output = response.text()
      const send = (processed: number) =>
        source.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({ prompt_progress: { total: 100, processed, cache: 0, time_ms: 100 } })}\n\n`
          )
        )
      send(10)
      await vi.waitFor(() => expect(sink).toHaveBeenCalledTimes(1))
      send(20)
      await new Promise((resolve) => setTimeout(resolve, 20))
      now.mockReturnValue(1200)
      send(30)
      await vi.waitFor(() => expect(sink).toHaveBeenCalledTimes(2))
      await new Promise((resolve) => setTimeout(resolve, 250))
      expect(sink.mock.calls.map(([value]) => value?.percent)).toEqual([10, 30])
      source.close()
      await output
    } finally {
      now.mockRestore()
    }
  })

  it('publishes the latest burst value and clears immediately on content', async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        source = controller
      }
    })
    const sink = vi.fn()
    const response = await createPromptProgressFetch(async () => new Response(stream), sink)(
      'https://example.com/chat/completions',
      { method: 'POST', body: '{"stream":true,"messages":[]}' }
    )
    const output = response.text()
    const send = (data: unknown) => source.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`))
    const report = (processed: number) => ({ prompt_progress: { total: 100, processed, cache: 0, time_ms: 100 } })
    send(report(10))
    await vi.waitFor(() => expect(sink).toHaveBeenCalledWith({ percent: 10, etaMs: 900 }))
    send(report(20))
    send(report(30))
    await vi.waitFor(() => expect(sink).toHaveBeenCalledWith({ percent: 30, etaMs: expect.closeTo(233.333, 2) }), {
      timeout: 1000
    })
    expect(sink.mock.calls.map(([value]) => value?.percent)).toEqual([10, 30])
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(sink.mock.calls.map(([value]) => value?.percent)).toEqual([10, 30])
    expect(sink).not.toHaveBeenCalledWith({ percent: 20, etaMs: 400 })
    send(report(40))
    send({ choices: [{ delta: { content: 'answer' } }] })
    await vi.waitFor(() => expect(sink).toHaveBeenLastCalledWith(null))
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(sink).toHaveBeenLastCalledWith(null)
    source.close()
    expect(await output).toContain('answer')
  })
})
