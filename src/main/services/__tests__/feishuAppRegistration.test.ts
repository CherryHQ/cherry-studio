import { getEventListeners } from 'node:events'
import { gunzipSync } from 'node:zlib'

import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { registrationBegin, registrationPoll } from '../feishuAppRegistration'

function response(payload: unknown, status = 200): Response {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return { ok: status >= 200 && status < 300, status, text: async () => text } as Response
}

describe('feishu app registration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(net.fetch).mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('preserves the Channel begin protocol when no app configuration is requested', async () => {
    vi.mocked(net.fetch)
      .mockResolvedValueOnce(response({ supported_auth_methods: ['client_secret'] }))
      .mockResolvedValueOnce(
        response({
          device_code: 'device-code',
          verification_uri_complete: 'https://accounts.feishu.cn/oauth/v1/app/verify?code=abc',
          interval: 3,
          expires_in: 600
        })
      )

    const result = await registrationBegin('feishu')

    expect(result).toEqual({
      deviceCode: 'device-code',
      verificationUri: 'https://accounts.feishu.cn/oauth/v1/app/verify?code=abc',
      interval: 3,
      expiresIn: 600
    })
    expect(vi.mocked(net.fetch)).toHaveBeenNthCalledWith(
      1,
      'https://accounts.feishu.cn/oauth/v1/app/registration',
      expect.objectContaining({ body: 'action=init' })
    )
    expect(vi.mocked(net.fetch)).toHaveBeenNthCalledWith(
      2,
      'https://accounts.feishu.cn/oauth/v1/app/registration',
      expect.objectContaining({
        body: 'action=begin&archetype=PersonalAgent&auth_method=client_secret&request_user_info=open_id'
      })
    )
  })

  it('encodes only the requested PersonalAgent user scopes', async () => {
    vi.mocked(net.fetch)
      .mockResolvedValueOnce(response({ supported_auth_methods: ['client_secret'] }))
      .mockResolvedValueOnce(
        response({
          device_code: 'device-code',
          verification_uri_complete: 'https://accounts.feishu.cn/oauth/v1/app/verify?code=abc'
        })
      )

    const result = await registrationBegin('feishu', {
      verification: {
        source: 'cherry-knowledge',
        createOnly: true,
        name: 'Cherry Knowledge',
        description: 'Read Feishu knowledge',
        addons: {
          preset: false,
          userScopes: ['wiki:node:read', 'offline_access']
        }
      }
    })

    const url = new URL(result.verificationUri)
    expect(url.searchParams.get('from')).toBe('sdk')
    expect(url.searchParams.get('source')).toBe('node-sdk/cherry-knowledge')
    expect(url.searchParams.get('tp')).toBe('sdk')
    expect(url.searchParams.get('createOnly')).toBe('true')
    expect(url.searchParams.get('name')).toBe('Cherry Knowledge')
    expect(url.searchParams.get('desc')).toBe('Read Feishu knowledge')

    const encodedAddons = url.searchParams.get('addons')
    expect(encodedAddons).not.toBeNull()
    const addons = JSON.parse(gunzipSync(Buffer.from(encodedAddons!, 'base64url')).toString('utf8'))
    expect(addons).toEqual({
      preset: false,
      scopes: { user: ['wiki:node:read', 'offline_access'] }
    })
    expect(addons.scopes).not.toHaveProperty('tenant')
  })

  it('prefers canonical expire_in and accepts expires_in only as a compatibility fallback', async () => {
    vi.mocked(net.fetch)
      .mockResolvedValueOnce(response({ supported_auth_methods: ['client_secret'] }))
      .mockResolvedValueOnce(
        response({
          device_code: 'canonical-code',
          verification_uri_complete: 'https://accounts.feishu.cn/oauth/v1/app/verify?code=canonical',
          expire_in: 120,
          expires_in: 600
        })
      )
      .mockResolvedValueOnce(response({ supported_auth_methods: ['client_secret'] }))
      .mockResolvedValueOnce(
        response({
          device_code: 'compatibility-code',
          verification_uri_complete: 'https://accounts.feishu.cn/oauth/v1/app/verify?code=compatibility',
          expires_in: 300
        })
      )

    await expect(registrationBegin('feishu')).resolves.toMatchObject({ expiresIn: 120 })
    await expect(registrationBegin('feishu')).resolves.toMatchObject({ expiresIn: 300 })
  })

  it('rejects failed and malformed registration responses without exposing provider payloads', async () => {
    vi.mocked(net.fetch).mockResolvedValueOnce(
      response({ error: 'server_error', error_description: 'secret-failed-sentinel' }, 503)
    )
    const failed = await registrationBegin('feishu').catch((cause: unknown) => cause)
    expect(failed).toMatchObject({ message: 'Feishu app registration request failed' })
    expect(JSON.stringify(failed)).not.toContain('secret-failed-sentinel')

    vi.mocked(net.fetch).mockReset().mockResolvedValueOnce(response([]))
    const malformed = await registrationBegin('feishu').catch((cause: unknown) => cause)
    expect(malformed).toMatchObject({ message: 'Invalid response from Feishu app registration' })

    vi.mocked(net.fetch)
      .mockReset()
      .mockResolvedValueOnce(response({ supported_auth_methods: ['client_secret'] }))
      .mockResolvedValueOnce(response({ error: 'unknown', error_description: 'secret-malformed-sentinel' }))
    const incomplete = await registrationBegin('feishu').catch((cause: unknown) => cause)
    expect(incomplete).toMatchObject({ message: 'Feishu app registration could not be started' })
    expect(JSON.stringify(incomplete)).not.toContain('secret-malformed-sentinel')
  })

  it('continues HTTP 400 pending and slow-down polling until credentials arrive', async () => {
    vi.mocked(net.fetch)
      .mockResolvedValueOnce(response({ error: 'authorization_pending' }, 400))
      .mockResolvedValueOnce(response({ error: 'slow_down' }, 400))
      .mockResolvedValueOnce(response({ client_id: 'app-id', client_secret: 'app-secret' }))
    const polling = registrationPoll('feishu', 'device-code', { interval: 1, expiresIn: 60 })
    const result = polling.catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(net.fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5_999)
    expect(net.fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toEqual({ appId: 'app-id', appSecret: 'app-secret' })
  })

  it.each([
    ['access_denied', 'User denied the Feishu app registration'],
    ['expired_token', 'Feishu app registration QR code expired'],
    ['unknown', 'Feishu app registration request failed']
  ])('handles HTTP 400 %s without leaking provider details', async (error, message) => {
    vi.mocked(net.fetch).mockResolvedValueOnce(response({ error, error_description: 'secret-sentinel' }, 400))
    const polling = registrationPoll('feishu', 'device-code', { interval: 1, expiresIn: 60 })
    const result = polling.catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(result).resolves.toMatchObject({ message })
  })

  it.each([400, 500])('rejects credentials returned with HTTP %s', async (status) => {
    vi.mocked(net.fetch).mockResolvedValueOnce(response({ client_id: 'app-id', client_secret: 'secret' }, status))
    const polling = registrationPoll('feishu', 'device-code', { interval: 1, expiresIn: 60 })
    const result = expect(polling).rejects.toThrow('Feishu app registration request failed')
    await vi.advanceTimersByTimeAsync(1_000)
    await result
  })

  it('passes cancellation to begin and in-flight poll requests', async () => {
    const beginController = new AbortController()
    vi.mocked(net.fetch)
      .mockResolvedValueOnce(response({ supported_auth_methods: ['client_secret'] }))
      .mockResolvedValueOnce(
        response({
          device_code: 'device-code',
          verification_uri_complete: 'https://accounts.feishu.cn/oauth/v1/app/verify?code=abc'
        })
      )

    await registrationBegin('feishu', { signal: beginController.signal })
    expect(vi.mocked(net.fetch).mock.calls[0][1]?.signal).toEqual(expect.any(AbortSignal))
    expect(vi.mocked(net.fetch).mock.calls[1][1]?.signal).toEqual(expect.any(AbortSignal))

    vi.mocked(net.fetch).mockImplementationOnce((_url, init) => {
      expect(init?.signal).toEqual(expect.any(AbortSignal))
      return Promise.resolve(response({ client_id: 'app-id', client_secret: 'app-secret' }))
    })
    const polling = registrationPoll('feishu', 'device-code', {
      interval: 0.001,
      expiresIn: 10,
      signal: beginController.signal
    })
    await vi.advanceTimersByTimeAsync(1)
    await expect(polling).resolves.toMatchObject({ appId: 'app-id' })
  })

  it('aborts an in-flight poll when the registration deadline expires', async () => {
    const deadline = new AbortController()
    const requestTimeout = new AbortController()
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValueOnce(deadline.signal)
      .mockReturnValueOnce(requestTimeout.signal)
    vi.mocked(net.fetch).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          deadline.signal.addEventListener('abort', () => reject(deadline.signal.reason), { once: true })
        })
    )
    const polling = registrationPoll('feishu', 'device-code', { interval: 0.001, expiresIn: 10 })
    const assertion = expect(polling).rejects.toThrow('Feishu app registration timed out')
    await vi.advanceTimersByTimeAsync(1)

    deadline.abort(new DOMException('deadline', 'TimeoutError'))

    await assertion
    expect(timeout).toHaveBeenNthCalledWith(1, 10_000)
  })

  it('retries a timed-out poll request within the registration deadline', async () => {
    const deadline = new AbortController()
    const firstRequest = new AbortController()
    const secondRequest = new AbortController()
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValueOnce(deadline.signal)
      .mockReturnValueOnce(firstRequest.signal)
      .mockReturnValueOnce(secondRequest.signal)
    vi.mocked(net.fetch)
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            firstRequest.signal.addEventListener('abort', () => reject(firstRequest.signal.reason), { once: true })
          })
      )
      .mockResolvedValueOnce(response({ client_id: 'app-id', client_secret: 'app-secret' }))
    const polling = registrationPoll('feishu', 'device-code', { interval: 0.001, expiresIn: 120 })
    const result = polling.catch((error) => error)
    await vi.advanceTimersByTimeAsync(1)

    firstRequest.abort(new DOMException('request timeout', 'TimeoutError'))
    await vi.advanceTimersByTimeAsync(1)

    await expect(result).resolves.toMatchObject({ appId: 'app-id' })
    expect(net.fetch).toHaveBeenCalledTimes(2)
    expect(timeout).toHaveBeenNthCalledWith(1, 120_000)
    expect(timeout).toHaveBeenNthCalledWith(2, 30_000)
  })

  it('preserves caller cancellation instead of classifying it as a request timeout', async () => {
    const caller = new AbortController()
    const deadline = new AbortController()
    const requestTimeout = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(deadline.signal).mockReturnValueOnce(requestTimeout.signal)
    vi.mocked(net.fetch).mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        })
    )
    const polling = registrationPoll('feishu', 'device-code', {
      interval: 0.001,
      expiresIn: 120,
      signal: caller.signal
    })
    const assertion = expect(polling).rejects.toThrow('Registration polling aborted')
    await vi.advanceTimersByTimeAsync(1)

    caller.abort(new DOMException('caller cancelled', 'AbortError'))

    await assertion
  })

  it('removes the abort listener after a completed polling delay', async () => {
    let resolveFetch!: (value: Response) => void
    vi.mocked(net.fetch).mockReturnValueOnce(new Promise((resolve) => (resolveFetch = resolve)))
    const controller = new AbortController()

    const polling = registrationPoll('feishu', 'device-code', {
      interval: 0.001,
      expiresIn: 10,
      signal: controller.signal
    })
    await vi.advanceTimersByTimeAsync(1)
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)

    resolveFetch(response({ client_id: 'app-id', client_secret: 'app-secret' }))
    await polling
  })

  it('does not expose provider response bodies in errors', async () => {
    vi.mocked(net.fetch).mockResolvedValueOnce(response('secret-sentinel'))

    const error = await registrationBegin('feishu').catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Invalid response from Feishu app registration')
    expect((error as Error).message).not.toContain('secret-sentinel')
  })
  it('reports response body network failures without exposing their details', async () => {
    const failed = new Response()
    vi.spyOn(failed, 'text').mockRejectedValueOnce(new TypeError('secret-body-error'))
    vi.mocked(net.fetch).mockResolvedValueOnce(failed)

    const error = await registrationBegin('feishu').catch((cause: unknown) => cause)

    expect(error).toMatchObject({ message: 'Feishu app registration request failed' })
    expect(String(error)).not.toContain('secret-body-error')
  })

  it.each(['timeout', 'caller', 'deadline'] as const)(
    'handles %s during poll response body consumption',
    async (reason) => {
      const caller = new AbortController()
      const deadline = new AbortController()
      const timeout = new AbortController()
      vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(deadline.signal).mockReturnValueOnce(timeout.signal)
      vi.mocked(net.fetch)
        .mockImplementationOnce(async (_url, init) => {
          const result = new Response()
          vi.spyOn(result, 'text').mockImplementation(
            () =>
              new Promise((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
              })
          )
          return result
        })
        .mockResolvedValueOnce(response({ client_id: 'app-id', client_secret: 'app-secret' }))
      const polling = registrationPoll('feishu', 'device-code', {
        interval: 0.001,
        expiresIn: 120,
        signal: caller.signal
      }).catch((cause: unknown) => cause)
      await vi.advanceTimersByTimeAsync(1)
      const controller = reason === 'caller' ? caller : reason === 'deadline' ? deadline : timeout
      controller.abort(new DOMException('stopped', reason === 'caller' ? 'AbortError' : 'TimeoutError'))
      await vi.advanceTimersByTimeAsync(1)

      if (reason === 'timeout')
        await expect(polling).resolves.toMatchObject({ appId: 'app-id', appSecret: 'app-secret' })
      else
        await expect(polling).resolves.toMatchObject({
          message: reason === 'caller' ? 'Registration polling aborted' : 'Feishu app registration timed out'
        })
    }
  )
})
