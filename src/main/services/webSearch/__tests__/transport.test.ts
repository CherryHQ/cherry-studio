import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { electronWebSearchTransport } from '../transport'

const request = {
  url: 'https://api.example.com/search',
  method: 'POST' as const,
  headers: { Authorization: 'Bearer selected-key' },
  body: '{"query":"hello"}'
}
const fetchMock = vi.mocked(net.fetch)

beforeEach(() => {
  fetchMock.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('Electron web search transport', () => {
  it('keeps HTTP statuses, serialized bodies and host headers intact', async () => {
    fetchMock.mockResolvedValueOnce(new Response('quota exceeded', { status: 429, headers: { 'Retry-After': '20' } }))
    const response = await electronWebSearchTransport.request(request)
    expect(response).toMatchObject({ status: 429, bodyText: 'quota exceeded', headers: { 'retry-after': '20' } })
    const [, init] = fetchMock.mock.calls[0]
    expect(init?.body).toBe('{"query":"hello"}')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer selected-key')
    expect(new Headers(init?.headers).get('x-title')).toBe('Cherry Studio')
  })

  it('rejects pre-cancelled calls without starting a request', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(electronWebSearchTransport.request({ ...request, signal: controller.signal })).rejects.toMatchObject({
      kind: 'cancelled'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('applies the timeout while consuming the response body and releases its timer', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementationOnce(async (_url, init) => {
      return new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener('abort', () => controller.error(init?.signal?.reason), { once: true })
          }
        })
      )
    })
    const pending = electronWebSearchTransport.request({ ...request, timeoutMs: 25 })
    const assertion = expect(pending).rejects.toMatchObject({ kind: 'timeout' })
    await vi.advanceTimersByTimeAsync(25)
    await assertion
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves caller cancellation when a deadline is also configured', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init?.signal?.reason), { once: true })
        })
    )
    const pending = electronWebSearchTransport.request({ ...request, signal: controller.signal, timeoutMs: 25 })
    const assertion = expect(pending).rejects.toMatchObject({ kind: 'cancelled' })
    controller.abort()
    await assertion
    expect(vi.getTimerCount()).toBe(0)
  })
})
