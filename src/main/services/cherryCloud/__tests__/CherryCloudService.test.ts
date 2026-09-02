import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appEdition: 'global' as 'cn' | 'global',
  appIsPackaged: false,
  broadcast: vi.fn(),
  gatewayStart: vi.fn(),
  loopbackOpen: vi.fn(),
  loopbackReceiver: {
    dispose: vi.fn(),
    port: 49152,
    setExpiresAt: vi.fn()
  },
  modelList: vi.fn(),
  modelReconcile: vi.fn(),
  netFetch: vi.fn(),
  openExternal: vi.fn(),
  savedSession: null as Record<string, unknown> | null,
  sessionClear: vi.fn(),
  sessionReplace: vi.fn()
}))

vi.mock('@data/services/ModelService', () => ({
  createManagedModelWriter: () => ({ reconcile: mocks.modelReconcile }),
  modelService: {
    list: mocks.modelList
  }
}))

vi.mock('@data/services/CherryCloudSessionService', () => ({
  cherryCloudSessionService: {
    get: () => mocks.savedSession,
    replace: (session: Record<string, unknown>) => {
      mocks.sessionReplace(session)
      mocks.savedSession = structuredClone(session)
    },
    clear: () => {
      mocks.sessionClear()
      mocks.savedSession = null
    }
  }
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'ApiGatewayService') return { start: mocks.gatewayStart }
      if (name === 'IpcApiService') return { broadcast: mocks.broadcast }
      throw new Error(`Unexpected service: ${name}`)
    }
  }
}))

vi.mock('@main/utils/appEdition', () => ({
  getAppEdition: () => mocks.appEdition
}))

vi.mock('electron', () => ({
  app: {
    getVersion: () => '2.1.0',
    get isPackaged() {
      return mocks.appIsPackaged
    }
  },
  net: { fetch: mocks.netFetch },
  shell: { openExternal: mocks.openExternal }
}))

vi.mock('../CherryCloudLoopbackCallback', () => ({
  CherryCloudLoopbackCallback: { open: mocks.loopbackOpen }
}))

import { CherryCloudLoginUnavailableError, CherryCloudService } from '../CherryCloudService'

const authorizationId = '00000000-0000-4000-8000-000000000001'
const sessionId = '00000000-0000-4000-8000-000000000010'
const accountId = '00000000-0000-4000-8000-000000000020'
const deviceId = '00000000-0000-4000-8000-000000000030'
const token = (character: string) => character.repeat(42) + 'A'
const accountSnapshot = {
  account: { id: accountId },
  session: { id: sessionId, expires_at: '2030-02-01T03:04:05Z' },
  device: { id: deviceId },
  entitlements: [
    {
      plan_id: '00000000-0000-4000-8000-000000000040',
      plan_name: '免费套餐',
      is_free: true,
      status: 'active',
      model_ids: ['deepseek-free']
    },
    {
      plan_id: '00000000-0000-4000-8000-000000000041',
      plan_name: 'GO 套餐',
      is_free: false,
      status: 'active',
      model_ids: ['deepseek-go']
    },
    {
      plan_id: '00000000-0000-4000-8000-000000000042',
      plan_name: '已过期套餐',
      is_free: false,
      status: 'inactive',
      model_ids: ['deepseek-inactive']
    }
  ]
}
const cloudModelCatalog = {
  data: [
    {
      id: 'deepseek-free',
      display_name: 'DeepSeek Free',
      endpoint_type: 'anthropic-messages',
      context_window: 128_000,
      max_output_tokens: 8_192,
      available_features: ['agent']
    },
    {
      id: 'deepseek-go',
      display_name: 'DeepSeek GO',
      endpoint_type: 'anthropic-messages',
      context_window: 256_000,
      max_output_tokens: 16_384,
      available_features: ['agent', 'chat', 'translate']
    },
    {
      id: 'deepseek-inactive',
      display_name: 'DeepSeek Inactive',
      endpoint_type: 'anthropic-messages',
      context_window: 64_000,
      max_output_tokens: 4_096,
      available_features: ['agent']
    }
  ]
}
const cloudFeaturesByModelId = {
  'cherryai-subscription::deepseek-free': ['agent'],
  'cherryai-subscription::deepseek-go': ['agent', 'chat', 'translate']
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function refreshedTokenSet() {
  return {
    token_set: {
      token_type: 'Bearer',
      access_token: token('H'),
      expires_in: 600,
      refresh_token: token('I'),
      session_id: sessionId,
      session_expires_at: '2030-02-01T03:04:05Z'
    }
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}

function exchangeResponse(expiresIn = 600, sessionExpiresAt = '2030-02-01T03:04:05Z') {
  return {
    token_set: {
      token_type: 'Bearer',
      access_token: token('F'),
      expires_in: expiresIn,
      refresh_token: token('G'),
      session_id: sessionId,
      session_expires_at: sessionExpiresAt
    },
    account: {
      measured_at: '2030-01-02T03:04:05Z',
      account: { id: accountId, status: 'active', display_name: 'Sora' },
      session: { id: sessionId, status: 'active', expires_at: '2030-02-01T03:04:05Z' },
      device: { id: deviceId, status: 'active' },
      entitlement: { key: 'free-model', status: 'active' },
      quota_pools: []
    }
  }
}

function authorizationResponse(expiresAt = '2030-01-02T03:14:05Z') {
  return {
    authorization_id: authorizationId,
    authorization_url: `http://localhost:8084/desktop/authorize?authorization_id=${authorizationId}`,
    expires_at: expiresAt
  }
}

async function createSignedInService(): Promise<CherryCloudService> {
  mocks.netFetch
    .mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
    .mockResolvedValueOnce(jsonResponse(exchangeResponse()))
    .mockResolvedValueOnce(jsonResponse({ ...accountSnapshot, entitlements: [] }))
    .mockResolvedValueOnce(jsonResponse({ data: [] }))

  const service = new CherryCloudService()
  await service._doInit()
  await service.startLogin()
  const createBody = JSON.parse(mocks.netFetch.mock.calls[0][1].body as string)
  await service['handleCallback'](
    new URL(
      `http://127.0.0.1/cloud-auth/callback?authorization_id=${authorizationId}&handoff_code=${token('D')}&state=${createBody.state}`
    )
  )
  await service['syncEntitledModels']()
  mocks.netFetch.mockReset()
  mocks.broadcast.mockClear()
  mocks.modelReconcile.mockClear()
  return service
}

describe('CherryCloudService', () => {
  beforeEach(() => {
    vi.stubEnv('MAIN_VITE_CHERRY_CLOUD_API_ORIGIN', '')
    CherryCloudService.resetInstances()
    vi.clearAllMocks()
    mocks.appEdition = 'global'
    mocks.appIsPackaged = false
    mocks.savedSession = null
    mocks.modelList.mockReturnValue([])
    mocks.modelReconcile.mockReturnValue([])
    mocks.gatewayStart.mockResolvedValue(undefined)
    mocks.openExternal.mockResolvedValue(undefined)
    mocks.loopbackOpen.mockResolvedValue(mocks.loopbackReceiver)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('persists the signed-in account across service restarts', async () => {
    mocks.netFetch
      .mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
      .mockResolvedValueOnce(jsonResponse(exchangeResponse()))
      .mockResolvedValueOnce(jsonResponse({ ...accountSnapshot, entitlements: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))

    const service = new CherryCloudService()
    await service._doInit()
    expect(await service.getStatus()).toEqual({ phase: 'signed-out', displayName: null })

    expect(await service.startLogin()).toEqual({ phase: 'authorizing', displayName: null })
    expect(mocks.savedSession).toBeNull()
    expect(mocks.openExternal).toHaveBeenCalledWith(
      `http://localhost:8084/desktop/authorize?authorization_id=${authorizationId}`
    )

    const createRequest = mocks.netFetch.mock.calls[0]
    expect(createRequest[0]).toBe('http://127.0.0.1:8084/api/v1/desktop/authorizations')
    const createBody = JSON.parse(createRequest[1].body as string)
    expect(createBody).toMatchObject({
      code_challenge_method: 'S256',
      platform: process.platform === 'win32' ? 'windows' : process.platform,
      client_version: '2.1.0'
    })
    expect(createBody.state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(createBody.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(createBody.device_public_key).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(createBody.callback_port).toBe(49152)

    const callback = mocks.loopbackOpen.mock.calls[0][0] as (url: URL) => Promise<void>
    await callback(
      new URL(
        `http://127.0.0.1/cloud-auth/callback?authorization_id=${authorizationId}&handoff_code=${token('D')}&state=${createBody.state}`
      )
    )
    expect(await service.getStatus()).toEqual({ phase: 'signed-in', displayName: 'Sora' })

    const exchangeRequest = mocks.netFetch.mock.calls[1]
    expect(exchangeRequest[0]).toBe(`http://127.0.0.1:8084/api/v1/desktop/authorizations/${authorizationId}/exchange`)
    const exchangeBody = JSON.parse(exchangeRequest[1].body as string)
    expect(exchangeBody).toMatchObject({ state: createBody.state, handoff_code: token('D') })
    expect(exchangeBody.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    await service['syncEntitledModels']()

    mocks.netFetch.mockReset()
    mocks.netFetch
      .mockResolvedValueOnce(jsonResponse({ ...accountSnapshot, entitlements: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
    CherryCloudService.resetInstances()
    const restarted = new CherryCloudService()
    await restarted._doInit()
    expect(await restarted.getStatus()).toEqual({ phase: 'signed-in', displayName: 'Sora' })
    await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(2))
    expect(mocks.netFetch.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:8084/api/v1/account',
      'http://127.0.0.1:8084/v1/models?limit=1000'
    ])
  })

  it('starts the API Gateway after a successful login', async () => {
    const service = await createSignedInService()

    expect(mocks.gatewayStart).toHaveBeenCalledOnce()
    expect(await service.getStatus()).toEqual({ phase: 'signed-in', displayName: 'Sora' })
  })

  it('keeps the Session when automatic Gateway startup fails', async () => {
    mocks.gatewayStart.mockRejectedValueOnce(new Error('port is already in use'))

    const service = await createSignedInService()

    expect(mocks.gatewayStart).toHaveBeenCalledOnce()
    expect(await service.getStatus()).toEqual({ phase: 'signed-in', displayName: 'Sora' })
  })

  it('reports that a Product Session is required for authenticated requests', async () => {
    const service = new CherryCloudService()
    await service._doInit()

    const response = await service.authenticatedFetch('/v1/messages', { method: 'POST' })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      type: 'error',
      error: {
        type: 'authentication_error',
        message: 'Cherry Cloud account is not signed in'
      }
    })
  })

  it('does not install a Session when login persistence fails', async () => {
    mocks.netFetch
      .mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
      .mockResolvedValueOnce(jsonResponse(exchangeResponse()))
    mocks.sessionReplace.mockImplementationOnce(() => {
      throw new Error('database is read-only')
    })
    const service = new CherryCloudService()
    await service._doInit()
    await service.startLogin()
    const createBody = JSON.parse(mocks.netFetch.mock.calls[0][1].body as string)

    await expect(
      service['handleCallback'](
        new URL(
          `http://127.0.0.1/cloud-auth/callback?authorization_id=${authorizationId}&handoff_code=${token('D')}&state=${createBody.state}`
        )
      )
    ).rejects.toThrow('database is read-only')

    expect(await service.getStatus()).toEqual({ phase: 'signed-out', displayName: null })
    expect(mocks.savedSession).toBeNull()
  })

  it('uses the global production origin in global packaged builds', async () => {
    mocks.appIsPackaged = true
    mocks.netFetch.mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
    const service = new CherryCloudService()
    await service._doInit()

    await expect(service.startLogin()).resolves.toEqual({ phase: 'authorizing', displayName: null })
    expect(mocks.loopbackOpen).toHaveBeenCalledOnce()
    expect(mocks.netFetch.mock.calls[0][0]).toBe('https://cloud.cherryai.com/api/v1/desktop/authorizations')
    expect(JSON.parse(mocks.netFetch.mock.calls[0][1].body as string).callback_port).toBe(49152)
  })

  it('uses the CN production origin in CN packaged builds', async () => {
    mocks.appEdition = 'cn'
    mocks.appIsPackaged = true
    mocks.netFetch.mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
    const service = new CherryCloudService()
    await service._doInit()

    await service.startLogin()

    expect(mocks.netFetch.mock.calls[0][0]).toBe('https://cloud.cherryai.com.cn/api/v1/desktop/authorizations')
  })

  it('uses the configured Cloud origin for login requests', async () => {
    vi.stubEnv('MAIN_VITE_CHERRY_CLOUD_API_ORIGIN', 'https://cloud-dev.cherry-ai.com/')
    mocks.appIsPackaged = true
    mocks.netFetch.mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
    const service = new CherryCloudService()
    await service._doInit()

    await service.startLogin()

    expect(mocks.netFetch.mock.calls[0][0]).toBe('https://cloud-dev.cherry-ai.com/api/v1/desktop/authorizations')
    expect(mocks.loopbackOpen).toHaveBeenCalledWith(expect.any(Function), 'https://cloud-dev.cherry-ai.com')
  })

  it('returns to signed out when browser authorization expires without a callback', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2030-01-02T03:00:00Z'))
      mocks.appIsPackaged = true
      mocks.netFetch.mockResolvedValueOnce(jsonResponse(authorizationResponse('2030-01-02T03:00:05Z'), 201))
      const service = new CherryCloudService()
      await service._doInit()
      await service.startLogin()

      await vi.advanceTimersByTimeAsync(5_000)

      expect(mocks.broadcast).toHaveBeenLastCalledWith('cherry_cloud.status_changed', {
        phase: 'signed-out',
        displayName: null
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not install a Session when authorization expires during exchange', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2030-01-02T03:00:00Z'))
      mocks.appIsPackaged = true
      const pendingExchange = deferred<Response>()
      mocks.netFetch
        .mockResolvedValueOnce(jsonResponse(authorizationResponse('2030-01-02T03:00:05Z'), 201))
        .mockReturnValueOnce(pendingExchange.promise)
      const service = new CherryCloudService()
      await service._doInit()
      await service.startLogin()
      const createBody = JSON.parse(mocks.netFetch.mock.calls[0][1].body as string)

      const callback = service['handleCallback'](
        new URL(
          `http://127.0.0.1/cloud-auth/callback?authorization_id=${authorizationId}&handoff_code=${token('D')}&state=${createBody.state}`
        )
      )
      await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(2))
      vi.setSystemTime(new Date('2030-01-02T03:00:06Z'))
      pendingExchange.resolve(jsonResponse(exchangeResponse()))

      await expect(callback).rejects.toThrow('no longer active')
      expect(await service.getStatus()).toEqual({ phase: 'signed-out', displayName: null })
      expect(mocks.savedSession).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops a pending authorization when the service restarts', async () => {
    mocks.netFetch.mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
    const service = new CherryCloudService()
    await service._doInit()
    await service.startLogin()

    await service._doStop()
    await service._doInit()

    expect(await service.getStatus()).toEqual({ phase: 'signed-out', displayName: null })
    expect(mocks.loopbackReceiver.dispose).toHaveBeenCalledOnce()
  })

  it('does not finish a login request after the service stops', async () => {
    mocks.appIsPackaged = true
    const pendingAuthorization = deferred<Response>()
    mocks.netFetch.mockReturnValueOnce(pendingAuthorization.promise)
    const service = new CherryCloudService()
    await service._doInit()

    const login = service.startLogin()
    await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledOnce())
    await service._doStop()
    pendingAuthorization.resolve(jsonResponse(authorizationResponse(), 201))

    await expect(login).rejects.toThrow('service stopped during login')
    expect(await service.getStatus()).toEqual({ phase: 'signed-out', displayName: null })
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it('does not let an older loopback open replace the restarted login receiver', async () => {
    const oldOpen = deferred<typeof mocks.loopbackReceiver>()
    const newOpen = deferred<typeof mocks.loopbackReceiver>()
    const oldReceiver = { dispose: vi.fn(), port: 49152, setExpiresAt: vi.fn() }
    const newReceiver = { dispose: vi.fn(), port: 49153, setExpiresAt: vi.fn() }
    mocks.loopbackOpen.mockReset()
    mocks.loopbackOpen.mockReturnValueOnce(oldOpen.promise).mockReturnValueOnce(newOpen.promise)
    mocks.netFetch.mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
    const service = new CherryCloudService()
    await service._doInit()

    const oldLogin = service.startLogin()
    await vi.waitFor(() => expect(mocks.loopbackOpen).toHaveBeenCalledOnce())
    await service._doStop()
    await service._doInit()
    const newLogin = service.startLogin()
    await vi.waitFor(() => expect(mocks.loopbackOpen).toHaveBeenCalledTimes(2))
    newOpen.resolve(newReceiver)
    await newLogin
    oldOpen.resolve(oldReceiver)

    await expect(oldLogin).rejects.toThrow('service stopped during login')
    await service._doStop()
    expect(oldReceiver.dispose).toHaveBeenCalledOnce()
    expect(newReceiver.dispose).toHaveBeenCalledOnce()
  })

  it('reports an unavailable login service when the backend cannot be reached', async () => {
    mocks.netFetch.mockRejectedValueOnce(new TypeError('fetch failed'))
    const service = new CherryCloudService()
    await service._doInit()

    await expect(service.startLogin()).rejects.toBeInstanceOf(CherryCloudLoginUnavailableError)
    expect(await service.getStatus()).toEqual({ phase: 'signed-out', displayName: null })
  })

  it('clears a matching pending authorization when the user denies access', async () => {
    mocks.netFetch.mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
    const service = new CherryCloudService()
    await service._doInit()
    await service.startLogin()
    const createBody = JSON.parse(mocks.netFetch.mock.calls[0][1].body as string)

    await service['handleCallback'](
      new URL(
        `http://127.0.0.1/cloud-auth/callback?authorization_id=${authorizationId}&state=${createBody.state}&error=access_denied`
      )
    )

    expect(await service.getStatus()).toEqual({ phase: 'signed-out', displayName: null })
    expect(mocks.netFetch).toHaveBeenCalledTimes(1)
    expect(mocks.savedSession).toBeNull()
    expect(mocks.broadcast).toHaveBeenLastCalledWith('cherry_cloud.status_changed', {
      phase: 'signed-out',
      displayName: null
    })
  })

  it('coalesces concurrent login starts into one authorization and browser launch', async () => {
    mocks.netFetch.mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
    const service = new CherryCloudService()
    await service._doInit()

    await expect(Promise.all([service.startLogin(), service.startLogin()])).resolves.toEqual([
      { phase: 'authorizing', displayName: null },
      { phase: 'authorizing', displayName: null }
    ])

    expect(mocks.netFetch).toHaveBeenCalledTimes(1)
    expect(mocks.openExternal).toHaveBeenCalledTimes(1)
  })

  it('cancels an in-flight authorization request and allows a fresh login', async () => {
    mocks.netFetch
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        })
      })
      .mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
    const service = new CherryCloudService()
    await service._doInit()

    const login = service.startLogin()
    await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledOnce())
    const requestSignal = mocks.netFetch.mock.calls[0][1].signal
    expect(requestSignal).toBeInstanceOf(AbortSignal)
    const cancellation = service.cancelLogin()

    expect(requestSignal?.aborted).toBe(true)
    await expect(login).resolves.toEqual({ phase: 'signed-out', displayName: null })
    await expect(cancellation).resolves.toEqual({ phase: 'signed-out', displayName: null })
    expect(mocks.loopbackReceiver.dispose).toHaveBeenCalled()

    await expect(service.startLogin()).resolves.toEqual({ phase: 'authorizing', displayName: null })
    expect(mocks.netFetch).toHaveBeenCalledTimes(2)
    expect(mocks.openExternal).toHaveBeenCalledOnce()
  })

  it('does not install a Session when a cancelled exchange responds late', async () => {
    mocks.appIsPackaged = true
    const pendingExchange = deferred<Response>()
    mocks.netFetch
      .mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
      .mockReturnValueOnce(pendingExchange.promise)
    const service = new CherryCloudService()
    await service._doInit()
    await service.startLogin()
    const createBody = JSON.parse(mocks.netFetch.mock.calls[0][1].body as string)

    const callback = service['handleCallback'](
      new URL(
        `http://127.0.0.1/cloud-auth/callback?authorization_id=${authorizationId}&handoff_code=${token('D')}&state=${createBody.state}`
      )
    )
    await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(2))
    const cancellation = service.cancelLogin()
    expect(await service.getStatus()).toEqual({ phase: 'signed-out', displayName: null })

    pendingExchange.resolve(jsonResponse(exchangeResponse()))
    await expect(callback).resolves.toBeUndefined()
    await expect(cancellation).resolves.toEqual({ phase: 'signed-out', displayName: null })
    expect(mocks.savedSession).toBeNull()
  })

  it('bounds an authorization request without expiring the browser authorization early', async () => {
    mocks.appIsPackaged = true
    const timeoutController = new AbortController()
    const retryTimeoutController = new AbortController()
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValueOnce(timeoutController.signal)
      .mockReturnValueOnce(retryTimeoutController.signal)
    try {
      mocks.netFetch
        .mockImplementationOnce(
          (_url: string, init: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
            })
        )
        .mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
      const service = new CherryCloudService()
      await service._doInit()

      const login = service.startLogin()
      const loginFailure = expect(login).rejects.toBeInstanceOf(CherryCloudLoginUnavailableError)
      await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledOnce())
      expect(timeout).toHaveBeenCalledWith(30_000)
      expect(mocks.netFetch.mock.calls[0][1]).toMatchObject({ redirect: 'error' })
      timeoutController.abort(new DOMException('The operation timed out', 'TimeoutError'))

      await loginFailure
      await expect(service.startLogin()).resolves.toEqual({ phase: 'authorizing', displayName: null })
    } finally {
      timeout.mockRestore()
    }
  })

  it('does not let an invalid callback block the matching callback exchange', async () => {
    mocks.netFetch
      .mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
      .mockResolvedValueOnce(jsonResponse(exchangeResponse()))
    const service = new CherryCloudService()
    await service._doInit()
    await service.startLogin()
    const createBody = JSON.parse(mocks.netFetch.mock.calls[0][1].body as string)

    const invalidCallback = service['handleCallback'](
      new URL(
        `http://127.0.0.1/cloud-auth/callback?authorization_id=${authorizationId}&handoff_code=${token('D')}&state=wrong-state`
      )
    )
    const validCallback = service['handleCallback'](
      new URL(
        `http://127.0.0.1/cloud-auth/callback?authorization_id=${authorizationId}&handoff_code=${token('D')}&state=${createBody.state}`
      )
    )

    await expect(invalidCallback).rejects.toThrow('does not match')
    await expect(validCallback).resolves.toBeUndefined()
    expect(await service.getStatus()).toEqual({ phase: 'signed-in', displayName: 'Sora' })
  })

  it('keeps ownership of the loopback listener after an invalid callback', async () => {
    mocks.netFetch.mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
    const service = new CherryCloudService()
    await service._doInit()
    await service.startLogin()
    const callback = mocks.loopbackOpen.mock.calls[0][0] as (url: URL) => Promise<void>

    await expect(callback(new URL('http://127.0.0.1/cloud-auth/callback?state=wrong'))).rejects.toThrow(
      'does not match'
    )
    await service._doStop()

    expect(mocks.loopbackReceiver.dispose).toHaveBeenCalledOnce()
  })

  it('does not let a matching error callback clear an exchange in progress', async () => {
    const pendingExchange = deferred<Response>()
    mocks.netFetch
      .mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
      .mockReturnValueOnce(pendingExchange.promise)
    const service = new CherryCloudService()
    await service._doInit()
    await service.startLogin()
    const createBody = JSON.parse(mocks.netFetch.mock.calls[0][1].body as string)

    const validCallback = service['handleCallback'](
      new URL(
        `http://127.0.0.1/cloud-auth/callback?authorization_id=${authorizationId}&handoff_code=${token('D')}&state=${createBody.state}`
      )
    )
    await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(2))
    const errorCallback = service['handleCallback'](
      new URL(
        `http://127.0.0.1/cloud-auth/callback?authorization_id=${authorizationId}&state=${createBody.state}&error=access_denied`
      )
    )

    expect(await service.getStatus()).toEqual({ phase: 'authorizing', displayName: null })
    pendingExchange.resolve(jsonResponse(exchangeResponse()))
    await expect(Promise.all([validCallback, errorCallback])).resolves.toEqual([undefined, undefined])
    expect(await service.getStatus()).toEqual({ phase: 'signed-in', displayName: 'Sora' })
  })

  it('clears a matching malformed callback so login can be started again', async () => {
    mocks.netFetch
      .mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
      .mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
    const service = new CherryCloudService()
    await service._doInit()
    await service.startLogin()
    const createBody = JSON.parse(mocks.netFetch.mock.calls[0][1].body as string)

    await expect(
      service['handleCallback'](
        new URL(`http://127.0.0.1/cloud-auth/callback?authorization_id=${authorizationId}&state=${createBody.state}`)
      )
    ).rejects.toThrow('missing the handoff code')
    expect(await service.getStatus()).toEqual({ phase: 'signed-out', displayName: null })

    await expect(service.startLogin()).resolves.toEqual({ phase: 'authorizing', displayName: null })
    expect(mocks.netFetch).toHaveBeenCalledTimes(2)
    expect(mocks.openExternal).toHaveBeenCalledTimes(2)
  })

  it('syncs models belonging to active free and paid entitlements', async () => {
    const service = await createSignedInService()
    mocks.modelList.mockReturnValue([
      {
        id: 'cherryai-subscription::old-free',
        providerId: 'cherryai-subscription',
        apiModelId: 'old-free',
        name: 'Old Free',
        group: 'Cherry Cloud'
      }
    ])
    mocks.netFetch
      .mockResolvedValueOnce(
        jsonResponse({
          ...accountSnapshot,
          quota_pools: [
            { model_ids: ['deepseek-free'], windows: [{ remaining_units: 0 }] },
            { model_ids: ['deepseek-go'], windows: [{ remaining_units: 1 }] }
          ]
        })
      )
      .mockResolvedValueOnce(jsonResponse(cloudModelCatalog))

    await expect(service['syncEntitledModels']()).resolves.toEqual({
      entitledModelIds: ['cherryai-subscription::deepseek-free', 'cherryai-subscription::deepseek-go'],
      quotaExhaustedModelIds: ['cherryai-subscription::deepseek-free'],
      featuresByModelId: cloudFeaturesByModelId
    })

    expect(mocks.modelReconcile).toHaveBeenCalledWith({
      toAdd: [
        expect.objectContaining({
          modelId: 'deepseek-free',
          name: 'DeepSeek Free',
          group: 'Cherry Cloud',
          endpointTypes: ['anthropic-messages'],
          contextWindow: 128_000,
          maxOutputTokens: 8_192
        }),
        expect.objectContaining({
          modelId: 'deepseek-go',
          name: 'DeepSeek GO',
          group: 'Cherry Cloud',
          endpointTypes: ['anthropic-messages'],
          contextWindow: 256_000,
          maxOutputTokens: 16_384
        })
      ],
      toUpdate: [],
      toRemove: ['old-free']
    })
    expect(mocks.modelReconcile.mock.calls[0][0].toAdd[0]).not.toHaveProperty('availableFeatures')
    expect(service.isModelAvailableForFeature('cherryai-subscription::deepseek-go', 'chat')).toBe(true)
    expect(service.isModelAvailableForFeature('cherryai-subscription::deepseek-free', 'chat')).toBe(false)

    for (const [, init] of mocks.netFetch.mock.calls) {
      const headers = new Headers(init.headers)
      expect(headers.get('Authorization')).toBe(`Bearer ${token('F')}`)
      expect(headers.get('Cherry-Device-ID')).toBe(deviceId)
      expect(headers.get('Cherry-Signature')).toMatch(/^[A-Za-z0-9_-]{86}$/)
    }
  })

  it('rejects a model catalog that omits endpoint_type', async () => {
    const service = await createSignedInService()
    mocks.netFetch.mockResolvedValueOnce(jsonResponse(accountSnapshot)).mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            id: 'deepseek-free',
            display_name: 'DeepSeek Free',
            context_window: 128_000,
            max_output_tokens: 8_192,
            available_features: ['agent']
          }
        ]
      })
    )

    await expect(service['syncEntitledModels']()).rejects.toThrow(/endpoint_type/)
    expect(mocks.modelReconcile).not.toHaveBeenCalled()
  })

  it('persists the endpoint_type selected by the server', async () => {
    const service = await createSignedInService()
    mocks.netFetch.mockResolvedValueOnce(jsonResponse(accountSnapshot)).mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            id: 'deepseek-free',
            display_name: 'DeepSeek Free',
            endpoint_type: 'openai-responses',
            context_window: 128_000,
            max_output_tokens: 8_192,
            available_features: ['agent']
          }
        ]
      })
    )

    await service['syncEntitledModels']()

    expect(mocks.modelReconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        toAdd: [
          expect.objectContaining({
            modelId: 'deepseek-free',
            endpointTypes: ['openai-responses']
          })
        ]
      })
    )
  })

  it('reuses a recent model snapshot when the selector opens repeatedly', async () => {
    const service = await createSignedInService()
    mocks.netFetch
      .mockResolvedValueOnce(jsonResponse(accountSnapshot))
      .mockResolvedValueOnce(jsonResponse(cloudModelCatalog))

    const expected = await service['syncEntitledModels']()
    mocks.netFetch.mockClear()

    await expect(service.syncEntitledModelsIfStale()).resolves.toEqual(expected)
    await expect(service.syncEntitledModelsIfStale()).resolves.toEqual(expected)
    expect(mocks.netFetch).not.toHaveBeenCalled()
  })

  it('refreshes an expired model snapshot when the selector opens', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2030-01-02T03:00:00Z'))
      const service = await createSignedInService()
      mocks.netFetch
        .mockResolvedValueOnce(jsonResponse(accountSnapshot))
        .mockResolvedValueOnce(jsonResponse(cloudModelCatalog))
      await service['syncEntitledModels']()
      mocks.netFetch.mockClear()

      await vi.advanceTimersByTimeAsync(60_001)
      mocks.netFetch
        .mockResolvedValueOnce(
          jsonResponse({
            ...accountSnapshot,
            quota_pools: [{ model_ids: ['deepseek-free'], windows: [{ remaining_units: 0 }] }]
          })
        )
        .mockResolvedValueOnce(jsonResponse(cloudModelCatalog))

      await expect(service.syncEntitledModelsIfStale()).resolves.toEqual({
        entitledModelIds: ['cherryai-subscription::deepseek-free', 'cherryai-subscription::deepseek-go'],
        quotaExhaustedModelIds: ['cherryai-subscription::deepseek-free'],
        featuresByModelId: cloudFeaturesByModelId
      })
      expect(mocks.netFetch).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds model sync requests without clearing the retriable Session', async () => {
    const service = await createSignedInService()
    const timeoutController = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(timeoutController.signal)
    try {
      mocks.netFetch.mockImplementation((_url: string, init: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        })
      })

      const sync = service['syncEntitledModels']()
      const syncFailure = expect(sync).rejects.toMatchObject({ name: 'TimeoutError' })
      await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(2))
      const requestSignals = mocks.netFetch.mock.calls.map(([, init]) => init.signal)

      expect(timeout).toHaveBeenCalledWith(30_000)
      expect(requestSignals[0]).toBe(requestSignals[1])
      timeoutController.abort(new DOMException('The operation timed out', 'TimeoutError'))

      expect(requestSignals.every((signal) => signal?.aborted)).toBe(true)
      await syncFailure
      expect(await service.getStatus()).toEqual({ phase: 'signed-in', displayName: 'Sora' })
    } finally {
      timeout.mockRestore()
    }
  })

  it('cancels model sync requests when the service stops', async () => {
    const service = await createSignedInService()
    mocks.netFetch.mockImplementation((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })
    })

    const sync = service['syncEntitledModels']()
    const syncFailure = expect(sync).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(2))
    const requestSignals = mocks.netFetch.mock.calls.map(([, init]) => init.signal)

    await service._doStop()

    expect(requestSignals.every((signal) => signal?.aborted)).toBe(true)
    await syncFailure
  })

  it('keeps remote model ids isolated from ordinary CherryAI models', async () => {
    const service = await createSignedInService()
    mocks.netFetch
      .mockResolvedValueOnce(jsonResponse(accountSnapshot))
      .mockResolvedValueOnce(jsonResponse(cloudModelCatalog))

    await expect(service['syncEntitledModels']()).resolves.toEqual({
      entitledModelIds: ['cherryai-subscription::deepseek-free', 'cherryai-subscription::deepseek-go'],
      quotaExhaustedModelIds: [],
      featuresByModelId: cloudFeaturesByModelId
    })

    expect(mocks.modelList).toHaveBeenLastCalledWith({ providerId: 'cherryai-subscription' })
    expect(mocks.modelReconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        toAdd: expect.arrayContaining([
          expect.objectContaining({ modelId: 'deepseek-free' }),
          expect.objectContaining({ modelId: 'deepseek-go' })
        ])
      })
    )
  })

  it('does not apply a model sync that finishes after the Session is cleared', async () => {
    const service = await createSignedInService()
    const accountRequest = deferred<Response>()
    const catalogRequest = deferred<Response>()
    mocks.netFetch
      .mockReturnValueOnce(accountRequest.promise)
      .mockReturnValueOnce(catalogRequest.promise)
      .mockResolvedValueOnce(jsonResponse({ type: 'error' }, 401))

    const sync = service['syncEntitledModels']()
    const syncFailure = expect(sync).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(2))
    await service.authenticatedFetch('/v1/messages', { method: 'POST' })

    accountRequest.resolve(jsonResponse(accountSnapshot))
    catalogRequest.resolve(jsonResponse(cloudModelCatalog))

    await syncFailure
    expect(mocks.modelReconcile).not.toHaveBeenCalled()
  })

  it('starts a new model sync when the account changes during an older sync', async () => {
    const service = await createSignedInService()
    const oldAccountRequest = deferred<Response>()
    const oldCatalogRequest = deferred<Response>()
    mocks.netFetch
      .mockReturnValueOnce(oldAccountRequest.promise)
      .mockReturnValueOnce(oldCatalogRequest.promise)
      .mockResolvedValueOnce(jsonResponse({ type: 'error' }, 401))

    const oldSync = service['syncEntitledModels']()
    const oldSyncFailure = expect(oldSync).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(2))
    await service.authenticatedFetch('/v1/messages', { method: 'POST' })

    mocks.netFetch
      .mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
      .mockResolvedValueOnce(jsonResponse(exchangeResponse()))
      .mockResolvedValueOnce(jsonResponse(accountSnapshot))
      .mockResolvedValueOnce(jsonResponse(cloudModelCatalog))
    await service.startLogin()
    const createBody = JSON.parse(mocks.netFetch.mock.calls[3][1].body as string)
    await service['handleCallback'](
      new URL(
        `http://127.0.0.1/cloud-auth/callback?authorization_id=${authorizationId}&handoff_code=${token('D')}&state=${createBody.state}`
      )
    )

    await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(7))
    oldAccountRequest.resolve(jsonResponse(accountSnapshot))
    oldCatalogRequest.resolve(jsonResponse(cloudModelCatalog))

    await oldSyncFailure
    expect(mocks.modelReconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        toAdd: expect.arrayContaining([expect.objectContaining({ modelId: 'deepseek-free' })])
      })
    )
  })

  it('rotates an expired access token before a signed model request', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-02T03:00:00Z'))

    try {
      const service = await createSignedInService()
      mocks.netFetch
        .mockResolvedValueOnce(jsonResponse(refreshedTokenSet()))
        .mockResolvedValueOnce(jsonResponse({ data: [] }))
      clock.mockReturnValue(Date.parse('2030-01-02T03:09:30Z'))

      await expect(
        service.authenticatedFetch('/v1/models?limit=1000', {
          headers: { 'anthropic-version': '2023-06-01' }
        })
      ).resolves.toHaveProperty('status', 200)

      const refreshHeaders = new Headers(mocks.netFetch.mock.calls[0][1].headers)
      const modelHeaders = new Headers(mocks.netFetch.mock.calls[1][1].headers)
      expect(refreshHeaders.has('Authorization')).toBe(false)
      expect(JSON.parse(Buffer.from(mocks.netFetch.mock.calls[0][1].body).toString())).toEqual({
        session_id: sessionId,
        refresh_token: token('G')
      })
      expect(modelHeaders.get('Authorization')).toBe(`Bearer ${token('H')}`)
    } finally {
      clock.mockRestore()
    }
  })

  it('times out a token refresh without clearing the retriable Session', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-02T03:00:00Z'))

    try {
      const service = await createSignedInService()
      const firstTimeout = new AbortController()
      const secondTimeout = new AbortController()
      const timeout = vi
        .spyOn(AbortSignal, 'timeout')
        .mockReturnValueOnce(firstTimeout.signal)
        .mockReturnValueOnce(secondTimeout.signal)
      try {
        mocks.netFetch.mockImplementationOnce((_url: string, init: RequestInit) => {
          return new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
          })
        })
        clock.mockReturnValue(Date.parse('2030-01-02T03:09:30Z'))

        const request = service.authenticatedFetch('/v1/models')
        const requestFailure = expect(request).rejects.toMatchObject({ name: 'TimeoutError' })
        await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledOnce())
        expect(timeout).toHaveBeenCalledWith(30_000)
        expect(mocks.netFetch.mock.calls[0][1]).toMatchObject({ redirect: 'error' })
        firstTimeout.abort(new DOMException('The operation timed out', 'TimeoutError'))

        await requestFailure
        expect(await service.getStatus()).toEqual({ phase: 'signed-in', displayName: 'Sora' })

        mocks.netFetch
          .mockResolvedValueOnce(jsonResponse(refreshedTokenSet()))
          .mockResolvedValueOnce(jsonResponse({ data: [] }))
        await expect(service.authenticatedFetch('/v1/models')).resolves.toHaveProperty('status', 200)
      } finally {
        timeout.mockRestore()
      }
    } finally {
      clock.mockRestore()
    }
  })

  it('clears runtime state when a refreshed Session cannot be persisted', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-02T03:00:00Z'))

    try {
      const service = await createSignedInService()
      mocks.sessionReplace.mockImplementationOnce(() => {
        throw new Error('database is read-only')
      })
      mocks.netFetch.mockResolvedValueOnce(jsonResponse(refreshedTokenSet()))
      clock.mockReturnValue(Date.parse('2030-01-02T03:09:30Z'))

      await expect(service.authenticatedFetch('/v1/models')).rejects.toThrow('database is read-only')

      expect(await service.getStatus()).toEqual({ phase: 'signed-out', displayName: null })
      expect(mocks.savedSession).toBeNull()
    } finally {
      clock.mockRestore()
    }
  })

  it('keeps a refreshed Session when an older request returns 401 afterward', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-02T03:00:00Z'))

    try {
      const service = await createSignedInService()
      const pendingOldRequest = deferred<Response>()
      mocks.netFetch
        .mockReturnValueOnce(pendingOldRequest.promise)
        .mockResolvedValueOnce(jsonResponse(refreshedTokenSet()))
        .mockResolvedValueOnce(jsonResponse({ data: [] }))
      const oldRequest = service.authenticatedFetch('/v1/messages', { method: 'POST' })
      await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(1))

      clock.mockReturnValue(Date.parse('2030-01-02T03:09:30Z'))
      await expect(service.authenticatedFetch('/v1/models')).resolves.toHaveProperty('status', 200)
      pendingOldRequest.resolve(jsonResponse({ type: 'error' }, 401))
      await expect(oldRequest).resolves.toHaveProperty('status', 401)

      expect(await service.getStatus()).toEqual({ phase: 'signed-in', displayName: 'Sora' })
      expect(mocks.savedSession).toMatchObject({ accessToken: token('H'), refreshToken: token('I') })
      expect(new Headers(mocks.netFetch.mock.calls[2][1].headers).get('Authorization')).toBe(`Bearer ${token('H')}`)
    } finally {
      clock.mockRestore()
    }
  })

  it('does not restore a refreshed Session after an older request has cleared it', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-02T03:00:00Z'))

    try {
      const service = await createSignedInService()
      const pendingOldRequest = deferred<Response>()
      const pendingRefresh = deferred<Response>()
      mocks.netFetch.mockReturnValueOnce(pendingOldRequest.promise).mockReturnValueOnce(pendingRefresh.promise)
      const oldRequest = service.authenticatedFetch('/v1/messages', { method: 'POST' })
      await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(1))

      clock.mockReturnValue(Date.parse('2030-01-02T03:09:30Z'))
      const refreshingRequest = service.authenticatedFetch('/v1/models')
      const refreshFailure = expect(refreshingRequest).rejects.toThrow(
        'Cherry Cloud session changed while refresh was in progress'
      )
      await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(2))

      pendingOldRequest.resolve(jsonResponse({ type: 'error' }, 401))
      await expect(oldRequest).resolves.toHaveProperty('status', 401)
      pendingRefresh.resolve(jsonResponse(refreshedTokenSet()))
      await refreshFailure

      expect(await service.getStatus()).toEqual({ phase: 'signed-out', displayName: null })
      expect(mocks.savedSession).toBeNull()
      expect(mocks.netFetch).toHaveBeenCalledTimes(2)
    } finally {
      clock.mockRestore()
    }
  })

  it('does not share an in-flight token refresh with a newer Session', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-02T03:00:00Z'))

    try {
      const service = await createSignedInService()
      const pendingOldRequest = deferred<Response>()
      const pendingOldRefresh = deferred<Response>()
      mocks.netFetch.mockReturnValueOnce(pendingOldRequest.promise).mockReturnValueOnce(pendingOldRefresh.promise)

      const oldRequest = service.authenticatedFetch('/v1/messages', { method: 'POST' })
      await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(1))
      clock.mockReturnValue(Date.parse('2030-01-02T03:09:30Z'))
      const oldRefresh = service.authenticatedFetch('/v1/models')
      const oldRefreshFailure = expect(oldRefresh).rejects.toThrow(
        'Cherry Cloud session changed while refresh was in progress'
      )
      await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(2))

      pendingOldRequest.resolve(jsonResponse({}, 401))
      await oldRequest
      mocks.netFetch
        .mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
        .mockResolvedValueOnce(jsonResponse(exchangeResponse(30)))
        .mockResolvedValueOnce(jsonResponse(refreshedTokenSet()))
        .mockResolvedValueOnce(jsonResponse({ ...accountSnapshot, entitlements: [] }))
        .mockResolvedValueOnce(jsonResponse({ data: [] }))
      await service.startLogin()
      const createBody = JSON.parse(mocks.netFetch.mock.calls[2][1].body as string)
      await service['handleCallback'](
        new URL(
          `http://127.0.0.1/cloud-auth/callback?authorization_id=${authorizationId}&handoff_code=${token('D')}&state=${createBody.state}`
        )
      )

      await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(7))
      expect(mocks.netFetch.mock.calls[4][0]).toBe('http://127.0.0.1:8084/api/v1/product-sessions/refresh')
      pendingOldRefresh.resolve(jsonResponse(refreshedTokenSet()))
      await oldRefreshFailure
      expect(await service.getStatus()).toEqual({ phase: 'signed-in', displayName: 'Sora' })
    } finally {
      clock.mockRestore()
    }
  })

  it('adds an idempotency key to signed Anthropic message requests', async () => {
    const service = await createSignedInService()
    mocks.netFetch.mockResolvedValueOnce(jsonResponse({ type: 'message' }))

    await service.authenticatedFetch('/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: '{"model":"deepseek-free","messages":[],"max_tokens":8}'
    })

    const init = mocks.netFetch.mock.calls[0][1]
    const headers = new Headers(init.headers)
    expect(headers.get('Idempotency-Key')).toMatch(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/)
    expect(headers.get('Cherry-Body-SHA256')).toBe('f24394a04116608ee41330b7fd6511ff8e44f65e29f6cfc44bb7c8393de7e5ea')
    expect(init.redirect).toBe('error')
    expect(init.signal).toBeUndefined()
  })

  it('clears the local login before waiting for remote Product Session revocation', async () => {
    const service = await createSignedInService()
    const pendingRevoke = deferred<Response>()
    mocks.netFetch.mockReturnValueOnce(pendingRevoke.promise)

    const revoke = service.revokeCurrentSession()
    await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(1))

    expect(await service.getStatus()).toEqual({ phase: 'signed-out', displayName: null })
    expect(mocks.savedSession).toBeNull()

    const [url, init] = mocks.netFetch.mock.calls[0]
    const headers = new Headers(init.headers)
    expect(url).toBe('http://127.0.0.1:8084/api/v1/product-sessions/current')
    expect(init.method).toBe('DELETE')
    expect(headers.get('Authorization')).toBe(`Bearer ${token('F')}`)
    expect(headers.get('Cherry-Device-ID')).toBe(deviceId)
    expect(headers.get('Cherry-Signature')).toMatch(/^[A-Za-z0-9_-]{86}$/)

    await expect(revoke).resolves.toEqual({ phase: 'signed-out', displayName: null })
    pendingRevoke.resolve(new Response(null, { status: 204 }))
  })

  it('does not let an older logout response clear a newer Session', async () => {
    const service = await createSignedInService()
    const pendingRevoke = deferred<Response>()
    mocks.netFetch.mockReturnValueOnce(pendingRevoke.promise)

    await expect(service.revokeCurrentSession()).resolves.toEqual({ phase: 'signed-out', displayName: null })

    mocks.netFetch
      .mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
      .mockResolvedValueOnce(jsonResponse(exchangeResponse()))
      .mockResolvedValueOnce(jsonResponse({ ...accountSnapshot, entitlements: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
    await service.startLogin()
    const createBody = JSON.parse(mocks.netFetch.mock.calls[1][1].body as string)
    await service['handleCallback'](
      new URL(
        `http://127.0.0.1/cloud-auth/callback?authorization_id=${authorizationId}&handoff_code=${token('D')}&state=${createBody.state}`
      )
    )
    pendingRevoke.resolve(new Response(null, { status: 204 }))
    await pendingRevoke.promise

    expect(await service.getStatus()).toEqual({ phase: 'signed-in', displayName: 'Sora' })
    expect(mocks.savedSession).not.toBeNull()
  })

  it('finishes local logout when the current Product Session is already invalid', async () => {
    const service = await createSignedInService()
    mocks.netFetch.mockResolvedValueOnce(jsonResponse({ type: 'error' }, 401))

    await expect(service.revokeCurrentSession()).resolves.toEqual({ phase: 'signed-out', displayName: null })
    expect(mocks.savedSession).toBeNull()
  })

  it('clears the local login when remote Product Session revocation fails', async () => {
    const service = await createSignedInService()
    mocks.netFetch.mockResolvedValueOnce(jsonResponse({ type: 'error' }, 503))

    await expect(service.revokeCurrentSession()).resolves.toEqual({ phase: 'signed-out', displayName: null })

    expect(mocks.savedSession).toBeNull()
  })

  it('attempts remote Product Session revocation when managed model cleanup fails', async () => {
    const service = await createSignedInService()
    mocks.modelList.mockReturnValue([
      {
        id: 'cherryai-subscription::deepseek-free',
        providerId: 'cherryai-subscription',
        apiModelId: 'deepseek-free',
        name: 'DeepSeek Free',
        group: 'Cherry Cloud',
        isEnabled: true
      }
    ])
    mocks.modelReconcile.mockImplementationOnce(() => {
      throw new Error('database is read-only')
    })
    mocks.netFetch.mockResolvedValueOnce(new Response(null, { status: 204 }))

    await expect(service.revokeCurrentSession()).resolves.toEqual({ phase: 'signed-out', displayName: null })

    expect(mocks.savedSession).toBeNull()
    expect(mocks.netFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8084/api/v1/product-sessions/current',
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it('times out remote Product Session revocation and clears the local login', async () => {
    const service = await createSignedInService()
    const timeoutController = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(timeoutController.signal)
    mocks.netFetch.mockRejectedValueOnce(new DOMException('The operation timed out', 'TimeoutError'))

    try {
      await expect(service.revokeCurrentSession()).resolves.toEqual({ phase: 'signed-out', displayName: null })
      expect(timeout).toHaveBeenCalledWith(30_000)
      expect(mocks.netFetch.mock.calls[0][1].signal).toBe(timeoutController.signal)
      expect(mocks.savedSession).toBeNull()
    } finally {
      timeout.mockRestore()
    }
  })

  it('clears the Product Session when Cloud API rejects authentication', async () => {
    const service = await createSignedInService()
    mocks.netFetch.mockResolvedValueOnce(jsonResponse({ type: 'error' }, 401))

    await expect(service.authenticatedFetch('/v1/messages', { method: 'POST' })).resolves.toHaveProperty('status', 401)

    expect(await service.getStatus()).toEqual({ phase: 'signed-out', displayName: null })
    expect(mocks.savedSession).toBeNull()
  })

  it('keeps the current Session when persisted removal fails', async () => {
    const service = await createSignedInService()
    mocks.modelList.mockReturnValue([
      {
        id: 'cherryai-subscription::deepseek-free',
        providerId: 'cherryai-subscription',
        apiModelId: 'deepseek-free',
        name: 'DeepSeek Free',
        group: 'Cherry Cloud',
        isEnabled: true
      }
    ])
    mocks.sessionClear.mockImplementationOnce(() => {
      throw new Error('database is read-only')
    })

    await expect(service.revokeCurrentSession()).rejects.toThrow('database is read-only')

    expect(await service.getStatus()).toEqual({ phase: 'signed-in', displayName: 'Sora' })
    expect(mocks.savedSession).not.toBeNull()
    expect(mocks.modelReconcile).not.toHaveBeenCalled()
    expect(mocks.broadcast).not.toHaveBeenCalled()
    expect(mocks.netFetch).not.toHaveBeenCalled()
  })

  it('broadcasts signed out when managed model cleanup fails', async () => {
    const service = await createSignedInService()
    mocks.modelList.mockReturnValue([
      {
        id: 'cherryai-subscription::deepseek-free',
        providerId: 'cherryai-subscription',
        apiModelId: 'deepseek-free',
        name: 'DeepSeek Free',
        group: 'Cherry Cloud',
        isEnabled: true
      }
    ])
    mocks.modelReconcile.mockImplementationOnce(() => {
      throw new Error('database is read-only')
    })
    mocks.netFetch.mockResolvedValueOnce(jsonResponse({}, 401))

    await expect(service.authenticatedFetch('/v1/messages', { method: 'POST' })).resolves.toHaveProperty('status', 401)

    expect(await service.getStatus()).toEqual({ phase: 'signed-out', displayName: null })
    expect(mocks.broadcast).toHaveBeenLastCalledWith('cherry_cloud.status_changed', {
      phase: 'signed-out',
      displayName: null
    })
  })

  it('expires the Product Session and deletes its managed models', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2030-01-02T03:00:00Z'))
      mocks.appIsPackaged = true
      mocks.netFetch
        .mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
        .mockResolvedValueOnce(jsonResponse(exchangeResponse(600, '2030-01-02T03:00:05Z')))
        .mockResolvedValueOnce(jsonResponse({ ...accountSnapshot, entitlements: [] }))
        .mockResolvedValueOnce(jsonResponse({ data: [] }))
      const service = new CherryCloudService()
      await service._doInit()
      await service.startLogin()
      const createBody = JSON.parse(mocks.netFetch.mock.calls[0][1].body as string)
      await service['handleCallback'](
        new URL(
          `http://127.0.0.1/cloud-auth/callback?authorization_id=${authorizationId}&handoff_code=${token('D')}&state=${createBody.state}`
        )
      )
      await service['syncEntitledModels']()
      mocks.modelList.mockReturnValue([
        {
          id: 'cherryai-subscription::deepseek-free',
          providerId: 'cherryai-subscription',
          apiModelId: 'deepseek-free',
          name: 'DeepSeek Free',
          group: 'Cherry Cloud',
          isEnabled: true
        }
      ])
      mocks.modelReconcile.mockClear()

      await vi.advanceTimersByTimeAsync(5_000)
      await Promise.resolve()
      await Promise.resolve()

      expect(mocks.sessionClear).toHaveBeenCalledOnce()
      expect(mocks.broadcast).toHaveBeenLastCalledWith('cherry_cloud.status_changed', {
        phase: 'signed-out',
        displayName: null
      })
      expect(await service.getStatus()).toEqual({ phase: 'signed-out', displayName: null })
      expect(mocks.savedSession).toBeNull()
      expect(mocks.modelReconcile).toHaveBeenCalledWith({
        toAdd: [],
        toUpdate: [],
        toRemove: ['deepseek-free']
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
