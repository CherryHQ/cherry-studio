import { getEventListeners } from 'node:events'

import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { registrationBegin, registrationPoll } from '../FeishuAppRegistration'

function jsonResponse(payload: Record<string, unknown>): Response {
  return { text: async () => JSON.stringify(payload) } as Response
}

describe('Feishu app registration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(net.fetch).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the verification link with default polling limits when the server omits them', async () => {
    vi.mocked(net.fetch)
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(
        jsonResponse({ device_code: 'device-code', verification_uri_complete: 'https://verify.test' })
      )

    await expect(registrationBegin('feishu')).resolves.toEqual({
      deviceCode: 'device-code',
      verificationUri: 'https://verify.test',
      interval: 5,
      expiresIn: 600
    })
  })

  it.each([
    { device_code: 42, verification_uri_complete: 'https://verify.test' },
    { device_code: 'device-code', verification_uri_complete: 'https://verify.test', interval: '5' }
  ])('rejects malformed device-flow fields before returning a polling configuration: %j', async (payload) => {
    vi.mocked(net.fetch).mockResolvedValueOnce(jsonResponse({})).mockResolvedValueOnce(jsonResponse(payload))

    await expect(registrationBegin('feishu')).rejects.toMatchObject({
      message: 'Invalid Feishu registration API response'
    })
  })

  it.each([
    { client_id: 42, client_secret: 'secret-to-hide' },
    { client_id: 'app-id', client_secret: { value: 'secret-to-hide' } }
  ])('rejects non-string credentials without exposing their values: %j', async (payload) => {
    vi.mocked(net.fetch).mockResolvedValue(jsonResponse(payload))
    const polling = registrationPoll('feishu', 'device-code', { interval: 0.001, expiresIn: 10 })
    const rejected = expect(polling).rejects.toMatchObject({ message: 'Invalid Feishu registration API response' })

    await vi.advanceTimersByTimeAsync(1)
    await rejected
  })

  it('continues pending and slowed polling until valid credentials arrive', async () => {
    vi.mocked(net.fetch)
      .mockResolvedValueOnce(jsonResponse({ error: 'authorization_pending' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'slow_down' }))
      .mockResolvedValueOnce(
        jsonResponse({ client_id: 'app-id', client_secret: 'app-secret', user_info: { open_id: 'user-id' } })
      )
    const polling = registrationPoll('feishu', 'device-code', { interval: 0.001, expiresIn: 10 })
    const resolved = expect(polling).resolves.toEqual({ appId: 'app-id', appSecret: 'app-secret', openId: 'user-id' })

    await vi.advanceTimersByTimeAsync(5003)
    await resolved
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
