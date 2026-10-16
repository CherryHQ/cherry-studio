import { afterEach, describe, expect, it, vi } from 'vitest'

import { WebSearchTransportError } from '@cherrystudio/web-search'

import { electronWebSearchTransport } from '../electronWebSearchTransport'

const { fetch } = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('electron', () => ({ net: { fetch } }))

const request = { url: 'https://search.example', method: 'GET' as const, headers: {} }

afterEach(() => {
  fetch.mockReset()
  vi.useRealTimers()
})

describe('Electron web search transport', () => {
  it('returns complete error bodies and lowercase headers with case-insensitive request overrides', async () => {
    fetch.mockResolvedValue(new Response('secret-body', { status: 429, headers: { 'X-Request-ID': 'id' } }))
    const response = await electronWebSearchTransport.request({
      ...request,
      headers: { 'http-referer': 'https://custom.example', 'X-TITLE': 'Custom' }
    })
    expect(response).toMatchObject({ status: 429, bodyText: 'secret-body', headers: { 'x-request-id': 'id' } })
    expect(fetch.mock.calls[0][1].headers).toEqual({ 'http-referer': 'https://custom.example', 'x-title': 'Custom' })
  })

  it('keeps the deadline active after headers arrive until the body finishes, then clears it', async () => {
    vi.useFakeTimers()
    let finish!: (body: string) => void
    fetch.mockResolvedValue({
      status: 200,
      headers: new Headers(),
      text: () =>
        new Promise<string>((resolve) => {
          finish = resolve
        })
    })
    const pending = electronWebSearchTransport.request({ ...request, timeoutMs: 100 })
    await vi.advanceTimersByTimeAsync(90)
    expect(vi.getTimerCount()).toBe(1)
    finish('complete')
    await expect(pending).resolves.toMatchObject({ bodyText: 'complete' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('times out during body consumption and clears the deadline', async () => {
    vi.useFakeTimers()
    fetch.mockImplementation(async (_url, { signal }) => ({
      status: 200,
      headers: new Headers(),
      text: () =>
        new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    }))
    const pending = expect(electronWebSearchTransport.request({ ...request, timeoutMs: 100 })).rejects.toMatchObject({
      name: 'WebSearchTransportError',
      kind: 'timeout'
    })
    await vi.advanceTimersByTimeAsync(100)
    await pending
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves the caller reason when the caller and deadline have both aborted', async () => {
    vi.useFakeTimers()
    const caller = new AbortController()
    const reason = new Error('caller cancellation')
    let rejectBody!: (error: unknown) => void
    fetch.mockResolvedValue({
      status: 200,
      headers: new Headers(),
      text: () =>
        new Promise((_resolve, reject) => {
          rejectBody = reject
        })
    })
    const pending = expect(
      electronWebSearchTransport.request({ ...request, signal: caller.signal, timeoutMs: 100 })
    ).rejects.toBe(reason)
    await vi.advanceTimersByTimeAsync(100)
    caller.abort(reason)
    rejectBody(new Error('native failure'))
    await pending
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not start a request for an already aborted caller', async () => {
    vi.useFakeTimers()
    const caller = new AbortController()
    const reason = new DOMException('cancelled', 'AbortError')
    caller.abort(reason)
    await expect(
      electronWebSearchTransport.request({ ...request, signal: caller.signal, timeoutMs: 100 })
    ).rejects.toBe(reason)
    expect(fetch).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('classifies socket failures by state and clears a pending deadline', async () => {
    vi.useFakeTimers()
    fetch.mockRejectedValue(new Error('timeout in a misleading native message'))
    const error = await electronWebSearchTransport.request({ ...request, timeoutMs: 100 }).catch((error) => error)
    expect(error).toBeInstanceOf(WebSearchTransportError)
    expect(error.kind).toBe('network')
    expect(vi.getTimerCount()).toBe(0)
  })
})
