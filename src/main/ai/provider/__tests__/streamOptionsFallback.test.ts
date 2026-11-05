import { describe, expect, it, vi } from 'vitest'

import {
  isStreamOptionsRejection,
  readErrorPrefix,
  STREAM_OPTIONS_ERROR_PREFIX_LIMIT,
  stripStreamOptionsBody,
  withStreamOptionsFallback,
  withStreamOptionsOmitted
} from '../streamOptionsFallback'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe('isStreamOptionsRejection', () => {
  it('matches the reported Unknown parameter 400', () => {
    expect(isStreamOptionsRejection(400, "Unknown parameter: 'stream_options.include_usage'. (request id: abc)")).toBe(
      true
    )
  })

  it('rejects non-400 statuses', () => {
    expect(isStreamOptionsRejection(500, 'Unknown parameter: stream_options.include_usage')).toBe(false)
  })

  it('rejects 400s that do not mention stream options', () => {
    expect(isStreamOptionsRejection(400, 'Unknown parameter: foo')).toBe(false)
  })

  it('rejects stream_options mentions without an error signal', () => {
    expect(isStreamOptionsRejection(400, '{"stream_options":{"include_usage":true}}')).toBe(false)
  })
})

describe('stripStreamOptionsBody', () => {
  it('removes stream_options and keeps the rest of the payload', () => {
    const stripped = stripStreamOptionsBody(
      JSON.stringify({ model: 'm', stream: true, stream_options: { include_usage: true } })
    )
    expect(stripped).toBeDefined()
    expect(JSON.parse(stripped!)).toEqual({ model: 'm', stream: true })
  })

  it('returns undefined when there is nothing to strip', () => {
    expect(stripStreamOptionsBody(JSON.stringify({ model: 'm' }))).toBeUndefined()
    expect(stripStreamOptionsBody(undefined)).toBeUndefined()
    expect(stripStreamOptionsBody('not-json')).toBeUndefined()
  })
})

describe('withStreamOptionsFallback', () => {
  it('retries once without stream_options on a matching 400', async () => {
    const inner = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string)
      if ('stream_options' in body) {
        return jsonResponse(400, { error: { message: "Unknown parameter: 'stream_options.include_usage'." } })
      }
      return jsonResponse(200, { ok: true })
    })
    const fetchWithFallback = withStreamOptionsFallback(inner)
    const firstBody = JSON.stringify({ model: 'm', stream_options: { include_usage: true } })

    const response = await fetchWithFallback('https://example.invalid/v1/chat/completions', {
      method: 'POST',
      body: firstBody
    })

    expect(response.status).toBe(200)
    expect(inner).toHaveBeenCalledTimes(2)
    expect(JSON.parse(inner.mock.calls[1][1]?.body as string)).not.toHaveProperty('stream_options')
  })

  it('does not retry unrelated 400s', async () => {
    const inner = vi.fn<typeof fetch>(async () => jsonResponse(400, { error: { message: 'Unknown parameter: foo' } }))
    const response = await withStreamOptionsFallback(inner)('https://example.invalid/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'm', stream_options: { include_usage: true } })
    })
    expect(response.status).toBe(400)
    expect(inner).toHaveBeenCalledTimes(1)
  })

  it('does not retry when the request has no stream_options', async () => {
    const inner = vi.fn<typeof fetch>(async () =>
      jsonResponse(400, { error: { message: "Unknown parameter: 'stream_options.include_usage'." } })
    )
    const response = await withStreamOptionsFallback(inner)('https://example.invalid/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'm' })
    })
    expect(inner).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(400)
  })

  it('passes through non-400 responses untouched', async () => {
    const inner = vi.fn<typeof fetch>(async () => jsonResponse(200, { ok: true }))
    const response = await withStreamOptionsFallback(inner)('https://example.invalid/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'm', stream_options: { include_usage: true } })
    })
    expect(response.status).toBe(200)
    expect(inner).toHaveBeenCalledTimes(1)
  })

  it('retries when a large 400 carries the match within the inspected prefix', async () => {
    const prefix = "Unknown parameter: 'stream_options.include_usage'."
    const inner = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string)
      if ('stream_options' in body) {
        return new Response(prefix + 'x'.repeat(STREAM_OPTIONS_ERROR_PREFIX_LIMIT), { status: 400 })
      }
      return jsonResponse(200, { ok: true })
    })
    const response = await withStreamOptionsFallback(inner)('https://example.invalid/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'm', stream_options: { include_usage: true } })
    })
    expect(response.status).toBe(200)
    expect(inner).toHaveBeenCalledTimes(2)
  })

  it('does not retry when the match lies beyond the inspected prefix', async () => {
    const padding = 'x'.repeat(STREAM_OPTIONS_ERROR_PREFIX_LIMIT + 1024)
    const inner = vi.fn<typeof fetch>(
      async () => new Response(padding + 'Unknown parameter: stream_options.include_usage', { status: 400 })
    )
    const response = await withStreamOptionsFallback(inner)('https://example.invalid/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'm', stream_options: { include_usage: true } })
    })
    expect(response.status).toBe(400)
    expect(inner).toHaveBeenCalledTimes(1)
    // The original stays readable so the SDK size guard still applies downstream.
    expect(await response.text()).toContain('stream_options')
  })

  it('leaves the original 400 body readable when no retry happens', async () => {
    const inner = vi.fn<typeof fetch>(async () => jsonResponse(400, { error: { message: 'boom' } }))
    const response = await withStreamOptionsFallback(inner)('https://example.invalid/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'm' })
    })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('boom')
  })
})

describe('readErrorPrefix', () => {
  it('bounds the inspected prefix without consuming the original', async () => {
    const original = new Response('a'.repeat(STREAM_OPTIONS_ERROR_PREFIX_LIMIT + 100), { status: 400 })
    const prefix = await readErrorPrefix(original)
    expect(prefix?.length).toBe(STREAM_OPTIONS_ERROR_PREFIX_LIMIT)
    expect(await original.text()).toHaveLength(STREAM_OPTIONS_ERROR_PREFIX_LIMIT + 100)
  })

  it('keeps the original promptly cancellable after inspecting a large open 400', async () => {
    // A malformed/hostile endpoint can leave a >=prefix body open. The
    // inspection clone is tee'd off the original, so dropping it without
    // cancelling stalls `original.body.cancel()` (which the SDK relies on
    // for oversized 400s). The inspection branch must be cancelled
    // fire-and-forget: awaiting it hangs on undici.
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(STREAM_OPTIONS_ERROR_PREFIX_LIMIT))
          // Intentionally never close: reproduces the stalled-cancel trigger.
        }
      }),
      { status: 400 }
    )

    const prefix = await readErrorPrefix(response)
    expect(prefix?.length).toBe(STREAM_OPTIONS_ERROR_PREFIX_LIMIT)

    const cancel = response.body?.cancel()
    expect(cancel).toBeDefined()
    await expect(
      Promise.race([
        cancel!,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('original cancel stalled after prefix inspection')), 1000)
        )
      ])
    ).resolves.toBeUndefined()
  })
})

describe('withStreamOptionsOmitted', () => {
  it('strips stream_options before the first request', async () => {
    const inner = vi.fn<typeof fetch>(async () => jsonResponse(200, { ok: true }))
    const response = await withStreamOptionsOmitted(inner)('https://example.invalid/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'm', stream: true, stream_options: { include_usage: true } })
    })
    expect(response.status).toBe(200)
    expect(inner).toHaveBeenCalledTimes(1)
    expect(JSON.parse(inner.mock.calls[0][1]?.body as string)).not.toHaveProperty('stream_options')
  })

  it('passes through bodies without stream_options untouched', async () => {
    const inner = vi.fn<typeof fetch>(async () => jsonResponse(200, { ok: true }))
    const body = JSON.stringify({ model: 'm' })
    await withStreamOptionsOmitted(inner)('https://example.invalid/v1/chat/completions', {
      method: 'POST',
      body
    })
    expect(inner.mock.calls[0][1]?.body).toBe(body)
  })
})
