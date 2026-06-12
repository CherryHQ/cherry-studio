import type { Span, Tracer } from '@opentelemetry/api'
import { SpanStatusCode } from '@opentelemetry/api'
import { describe, expect, it, vi } from 'vitest'

import { createHttpTraceFetch } from '../httpTraceFetch'

/** A fake tracer that records the single span's attributes, status, and end. */
function fakeTracer() {
  const attributes: Record<string, unknown> = {}
  const state = { ended: false, status: undefined as { code: SpanStatusCode; message?: string } | undefined }
  const span = {
    setAttribute: (key: string, value: unknown) => {
      attributes[key] = value
    },
    setStatus: (status: { code: SpanStatusCode; message?: string }) => {
      state.status = status
    },
    recordException: vi.fn(),
    end: () => {
      state.ended = true
    }
  } as unknown as Span
  const tracer = { startSpan: () => span } as unknown as Tracer
  return { tracer, attributes, state }
}

describe('createHttpTraceFetch', () => {
  it('records url/method/status + redacted headers as dedicated attributes, body-only inputs/outputs', async () => {
    const { tracer, attributes, state } = fakeTracer()
    const innerFetch = vi.fn(
      async () =>
        new Response('{"choices":[{"text":"hi"}]}', {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json', 'set-cookie': 'session=secret' }
        })
    )

    const f = createHttpTraceFetch(innerFetch as never, { topicId: 't1', modelName: 'gpt-x', tracer })
    const res = await f('https://api.example.com/v1/chat', {
      method: 'POST',
      headers: { authorization: 'Bearer sk-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-x', messages: [{ role: 'user', content: 'hello' }] })
    })

    // The SDK's copy of the body is the FULL, untruncated stream — tee must not corrupt it.
    expect(await res.text()).toBe('{"choices":[{"text":"hi"}]}')
    await vi.waitFor(() => expect(state.ended).toBe(true))

    expect(attributes['trace.topicId']).toBe('t1')
    expect(attributes['trace.modelName']).toBe('gpt-x')
    expect(attributes.tags).toBe('HTTP')
    expect(attributes['http.method']).toBe('POST')
    expect(attributes['http.url']).toBe('https://api.example.com/v1/chat')
    expect(attributes['http.status']).toBe(200)
    expect(attributes['http.statusText']).toBe('OK')

    // Headers live on their own attributes (their own tabs), redacted.
    const requestHeaders = JSON.parse(attributes['http.request.headers'] as string)
    expect(requestHeaders.authorization).toBe('***')
    expect(requestHeaders['content-type']).toBe('application/json')
    const responseHeaders = JSON.parse(attributes['http.response.headers'] as string)
    expect(responseHeaders['set-cookie']).toBe('***')

    // inputs/outputs carry the body only — no url/method/headers wrapper.
    expect(JSON.parse(attributes.inputs as string)).toEqual({
      model: 'gpt-x',
      messages: [{ role: 'user', content: 'hello' }]
    })
    expect(attributes.outputs).toBe('{"choices":[{"text":"hi"}]}')
  })

  it('truncates a request body larger than maxBodyBytes', async () => {
    const { tracer, attributes, state } = fakeTracer()
    const innerFetch = vi.fn(async () => new Response(null, { status: 204 }))
    const big = 'x'.repeat(100)

    const f = createHttpTraceFetch(innerFetch as never, { topicId: 't1', tracer, maxBodyBytes: 10 })
    await f('https://api.example.com', { method: 'POST', body: big })
    await vi.waitFor(() => expect(state.ended).toBe(true))

    expect(attributes.inputs).toBe('xxxxxxxxxx…[truncated 90 chars]')
  })

  it('truncates a response body larger than maxBodyBytes while keeping the SDK copy whole', async () => {
    const { tracer, attributes, state } = fakeTracer()
    const big = 'y'.repeat(100)
    const innerFetch = vi.fn(async () => new Response(big, { status: 200 }))

    const f = createHttpTraceFetch(innerFetch as never, { topicId: 't1', tracer, maxBodyBytes: 10 })
    const res = await f('https://api.example.com', {})

    expect(await res.text()).toBe(big)
    await vi.waitFor(() => expect(state.ended).toBe(true))
    expect(attributes.outputs).toBe('yyyyyyyyyy…[truncated 90 chars]')
  })

  it('ends the span with an error status when the inner fetch rejects', async () => {
    const { tracer, state } = fakeTracer()
    const innerFetch = vi.fn(async () => {
      throw new Error('network down')
    })

    const f = createHttpTraceFetch(innerFetch as never, { topicId: 't1', tracer })
    await expect(f('https://api.example.com', {})).rejects.toThrow('network down')
    expect(state.ended).toBe(true)
    expect(state.status?.code).toBe(SpanStatusCode.ERROR)
    expect(state.status?.message).toBe('network down')
  })

  it('settles the span immediately for a body-less response', async () => {
    const { tracer, attributes, state } = fakeTracer()
    const innerFetch = vi.fn(async () => new Response(null, { status: 204, statusText: 'No Content' }))

    const f = createHttpTraceFetch(innerFetch as never, { topicId: 't1', tracer })
    await f('https://api.example.com', { method: 'GET' })

    expect(state.ended).toBe(true)
    expect(attributes['http.status']).toBe(204)
    expect(attributes['http.statusText']).toBe('No Content')
    expect(attributes.outputs).toBeUndefined()
  })

  // Real providers send `Authorization` capitalized, sometimes as a Headers instance or tuple init.
  // A future loss of `.toLowerCase()` in redaction must fail tests instead of writing API keys to disk.
  it.each([
    ['plain object, capitalized key', { Authorization: 'Bearer sk-secret', 'Content-Type': 'application/json' }],
    ['Headers instance', new Headers({ Authorization: 'Bearer sk-secret' })],
    ['tuple-array init', [['Authorization', 'Bearer sk-secret']] as [string, string][]]
  ])('redacts the Authorization header regardless of init form (%s)', async (_label, headers) => {
    const { tracer, attributes, state } = fakeTracer()
    const innerFetch = vi.fn(async () => new Response(null, { status: 204 }))

    const f = createHttpTraceFetch(innerFetch as never, { topicId: 't1', tracer })
    await f('https://api.example.com', { method: 'POST', headers: headers as HeadersInit, body: '{}' })
    await vi.waitFor(() => expect(state.ended).toBe(true))

    const requestHeaders = JSON.parse(attributes['http.request.headers'] as string)
    const authKey = Object.keys(requestHeaders).find((k) => k.toLowerCase() === 'authorization')!
    expect(requestHeaders[authKey]).toBe('***')
  })

  it('redacts sensitive query-string secrets from http.url', async () => {
    const { tracer, attributes, state } = fakeTracer()
    const innerFetch = vi.fn(async () => new Response(null, { status: 204 }))

    const f = createHttpTraceFetch(innerFetch as never, { topicId: 't1', tracer })
    await f('https://generativelanguage.googleapis.com/v1/models/gemini:generateContent?key=AIzaSECRET&alt=sse', {
      method: 'POST',
      body: '{}'
    })
    await vi.waitFor(() => expect(state.ended).toBe(true))

    const url = attributes['http.url'] as string
    expect(url).not.toContain('AIzaSECRET')
    const parsed = new URL(url)
    expect(parsed.searchParams.get('key')).toBe('***')
    expect(parsed.searchParams.get('alt')).toBe('sse')
  })

  it('strips user:pass@ userinfo from http.url (proxy credentials)', async () => {
    const { tracer, attributes, state } = fakeTracer()
    const innerFetch = vi.fn(async () => new Response(null, { status: 204 }))

    const f = createHttpTraceFetch(innerFetch as never, { topicId: 't1', tracer })
    await f('https://user:s3cret@proxy.internal/v1/chat?key=AIzaSECRET', { method: 'POST', body: '{}' })
    await vi.waitFor(() => expect(state.ended).toBe(true))

    const url = attributes['http.url'] as string
    expect(url).not.toContain('s3cret')
    expect(url).not.toContain('AIzaSECRET')
    const parsed = new URL(url)
    expect(parsed.username).toBe('')
    expect(parsed.password).toBe('')
    expect(parsed.searchParams.get('key')).toBe('***')
  })

  // ── Guard paths: capturing the body MUST NEVER break the real fetch ──

  it('passthrough: falls back to the untraced fetch when request-span setup throws', async () => {
    const innerFetch = vi.fn(async () => new Response('inner', { status: 200 }))
    const ended = vi.fn()
    // A span whose setAttribute throws drives the setup try/catch → passthrough.
    const span = {
      setAttribute: () => {
        throw new Error('attr boom')
      },
      setStatus: () => {},
      recordException: vi.fn(),
      end: ended
    } as unknown as Span
    const tracer = { startSpan: () => span } as unknown as Tracer

    const f = createHttpTraceFetch(innerFetch as never, { topicId: 't1', tracer })
    const res = await f('https://api.example.com/v1', { method: 'POST', body: '{}' })

    expect(await res.text()).toBe('inner') // the untraced inner response, intact
    expect(innerFetch).toHaveBeenCalledTimes(1)
    expect(ended).toHaveBeenCalled() // span settled, not leaked
  })

  it('tee failure: returns the original response untouched when body.tee() throws', async () => {
    const { tracer, attributes, state } = fakeTracer()
    const real = new Response('real-body', { status: 200 })
    // A custom-fetch body without a working tee() — keep `body` truthy but throw on tee().
    Object.defineProperty(real, 'body', {
      get: () => ({
        tee: () => {
          throw new Error('no tee')
        }
      })
    })
    const innerFetch = vi.fn(async () => real)

    const f = createHttpTraceFetch(innerFetch as never, { topicId: 't1', tracer })
    const res = await f('https://api.example.com/v1', { method: 'POST', body: '{}' })

    expect(res).toBe(real) // original handed back untouched — real streaming path preserved
    expect(attributes['http.trace.captureError']).toContain('no tee')
    expect(state.ended).toBe(true)
  })

  it('post-tee constructor failure: hands the SDK a minimal Response over the SDK branch', async () => {
    const { tracer, attributes, state } = fakeTracer()
    const real = new Response('body-x', { status: 200 })
    // tee() works, but an out-of-range status makes the SECOND `new Response(sdkBranch, {status})` throw.
    Object.defineProperty(real, 'status', { get: () => 199 })
    const innerFetch = vi.fn(async () => real)

    const f = createHttpTraceFetch(innerFetch as never, { topicId: 't1', tracer })
    const res = await f('https://api.example.com/v1', { method: 'POST', body: '{}' })

    expect(await res.text()).toBe('body-x') // SDK still gets the body via the minimal Response
    expect(attributes['http.trace.captureError']).toBeDefined()
    await vi.waitFor(() => expect(state.ended).toBe(true))
  })

  it('mid-stream error: marks the span ERROR when the captured response body errors', async () => {
    const { tracer, state } = fakeTracer()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('partial'))
        controller.error(new Error('stream boom'))
      }
    })
    const innerFetch = vi.fn(
      async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
    )

    const f = createHttpTraceFetch(innerFetch as never, { topicId: 't1', tracer })
    const res = await f('https://api.example.com/v1', { method: 'POST', body: '{}' })
    // The SDK branch reads the same tee'd source and also errors — we only assert the span.
    await res.text().catch(() => {})
    await vi.waitFor(() => expect(state.ended).toBe(true))

    expect(state.status?.code).toBe(SpanStatusCode.ERROR)
  })
})
