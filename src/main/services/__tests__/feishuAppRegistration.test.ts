import { getEventListeners } from 'node:events'
import { gunzipSync } from 'node:zlib'

import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { registrationBegin, registrationPoll } from '../feishuAppRegistration'

function response(payload: Record<string, unknown> | string): Response {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return { ok: true, status: 200, text: async () => text } as Response
}

describe('feishu app registration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(net.fetch).mockReset()
  })

  afterEach(() => {
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

  it('adds a minimal PersonalAgent configuration to the verification URL', async () => {
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
    expect(vi.mocked(net.fetch).mock.calls[0][1]?.signal).toBe(beginController.signal)
    expect(vi.mocked(net.fetch).mock.calls[1][1]?.signal).toBe(beginController.signal)

    vi.mocked(net.fetch).mockImplementationOnce((_url, init) => {
      expect(init?.signal).toBe(beginController.signal)
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
})
