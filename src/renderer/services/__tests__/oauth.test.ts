import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EventPayload } from '@shared/ipc/types'

import { oauthWithCherryIn } from '../oauth'

const deadlineMs = 10 * 60 * 1000
const state = 'active-flow'

function startFlow(setKey: (key: string) => void | Promise<void>) {
  const subscribed = Promise.withResolvers<void>()
  const listeners = new Set<(payload: unknown) => void>()
  vi.mocked(window.api.ipcApi.on).mockImplementation((event, listener) => {
    if (event === 'oauth.deep_link_result') {
      listeners.add(listener)
      subscribed.resolve()
    }
    return () => listeners.delete(listener)
  })
  const promise = oauthWithCherryIn(setKey, { oauthServer: 'https://oauth.example.com' })
  return {
    promise,
    subscribed: subscribed.promise,
    listeners,
    emit: (event: EventPayload<'oauth.deep_link_result'>) => {
      for (const listener of listeners) listener(event)
    }
  }
}

describe('CherryIN OAuth deadline', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(window, 'open').mockReturnValue(null)
    vi.mocked(window.api.ipcApi.request).mockResolvedValue({
      ok: true,
      data: { authUrl: 'https://oauth.example.com/authorize', state }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.mocked(window.api.ipcApi.request).mockReset()
    vi.mocked(window.api.ipcApi.on)
      .mockReset()
      .mockImplementation(() => () => {})
  })

  it('stops the deadline at the matching event while key persistence is still pending', async () => {
    const write = Promise.withResolvers<void>()
    const storedKeys: string[] = []
    const flow = startFlow(async (key) => {
      await write.promise
      storedKeys.push(key)
    })
    let outcome = 'pending'
    void flow.promise.then(
      () => {
        outcome = 'resolved'
      },
      () => {
        outcome = 'rejected'
      }
    )
    await flow.subscribed

    flow.emit({ state, apiKeys: 'api-key' })
    await vi.advanceTimersByTimeAsync(deadlineMs + 1)
    expect(outcome).toBe('pending')
    expect(flow.listeners.size).toBe(0)
    expect(storedKeys).toEqual([])

    write.resolve()
    await expect(flow.promise).resolves.toBe('api-key')
    expect(storedKeys).toEqual(['api-key'])
  })

  it('keeps the deadline for another flow and unsubscribes when its own flow expires', async () => {
    const storedKeys: string[] = []
    const flow = startFlow((key) => {
      storedKeys.push(key)
    })
    const rejected = expect(flow.promise).rejects.toThrow('OAuth flow timed out')
    await flow.subscribed

    flow.emit({ state: 'another-flow', apiKeys: 'unrelated-key' })
    await vi.advanceTimersByTimeAsync(deadlineMs)
    await rejected
    flow.emit({ state, apiKeys: 'late-key' })

    expect(storedKeys).toEqual([])
    expect(flow.listeners.size).toBe(0)
  })
})
