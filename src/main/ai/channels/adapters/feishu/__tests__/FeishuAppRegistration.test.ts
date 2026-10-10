import { getEventListeners } from 'node:events'

import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { registrationPoll } from '../FeishuAppRegistration'

function jsonResponse(payload: Record<string, unknown>): Response {
  return { text: async () => JSON.stringify(payload) } as Response
}

describe('registrationPoll', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(net.fetch).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('removes the abort listener after a completed polling delay', async () => {
    let resolveFetch!: (response: Response) => void
    vi.mocked(net.fetch).mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve
      })
    )
    const controller = new AbortController()

    const polling = registrationPoll('feishu', 'device-code', {
      interval: 0.001,
      expiresIn: 10,
      signal: controller.signal
    })
    await vi.advanceTimersByTimeAsync(1)
    const listenersAfterDelay = getEventListeners(controller.signal, 'abort')

    resolveFetch(jsonResponse({ client_id: 'app-id', client_secret: 'app-secret' }))
    await polling

    expect(listenersAfterDelay).toHaveLength(0)
  })
})
