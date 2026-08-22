import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appIsPackaged: false,
  broadcast: vi.fn(),
  loopbackOpen: vi.fn(),
  loopbackReceiver: {
    dispose: vi.fn(),
    port: 49152,
    setExpiresAt: vi.fn()
  },
  modelBulkUpdate: vi.fn(),
  modelCreate: vi.fn(),
  modelList: vi.fn(),
  netFetch: vi.fn(),
  notifyDataChange: vi.fn(),
  openExternal: vi.fn(),
  acquireGatewayLease: vi.fn(),
  releaseGatewayLease: vi.fn(),
  savedSession: null as Record<string, unknown> | null,
  sessionClear: vi.fn(),
  sessionReplace: vi.fn()
}))

vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: mocks.notifyDataChange }))

vi.mock('@data/services/ModelService', () => ({
  modelService: {
    bulkUpdate: mocks.modelBulkUpdate,
    create: mocks.modelCreate,
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
      if (name === 'IpcApiService') return { broadcast: mocks.broadcast }
      if (name === 'ApiGatewayService') {
        return { acquireLease: mocks.acquireGatewayLease, releaseLease: mocks.releaseGatewayLease }
      }
      throw new Error(`Unexpected service: ${name}`)
    }
  }
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

vi.mock('../loopbackCallback', () => ({
  CherryCloudLoopbackCallback: { open: mocks.loopbackOpen }
}))

import { CherryCloudLoginUnavailableError, CherryCloudService } from '../CherryCloudService'

const authorizationId = '00000000-0000-4000-8000-000000000001'
const sessionId = '00000000-0000-4000-8000-000000000010'
const accountId = '00000000-0000-4000-8000-000000000020'
const deviceId = '00000000-0000-4000-8000-000000000030'
const token = (character: string) => character.repeat(42) + 'A'
const freeAccountSnapshot = {
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
    }
  ]
}
const cloudModelCatalog = {
  data: [
    { id: 'deepseek-free', display_name: 'DeepSeek Free', context_window: 128_000, max_output_tokens: 8_192 },
    { id: 'deepseek-go', display_name: 'DeepSeek GO', context_window: 256_000, max_output_tokens: 16_384 }
  ]
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
    .mockResolvedValueOnce(jsonResponse({ ...freeAccountSnapshot, entitlements: [] }))
    .mockResolvedValueOnce(jsonResponse({ data: [] }))

  const service = new CherryCloudService()
  await service._doInit()
  await service.startLogin()
  const createBody = JSON.parse(mocks.netFetch.mock.calls[0][1].body as string)
  await service.handleCallback(
    new URL(
      `cherrystudio://cloud-auth/callback?authorization_id=${authorizationId}&handoff_code=${token('D')}&state=${createBody.state}`
    )
  )
  await service.syncFreeModels()
  mocks.netFetch.mockReset()
  mocks.broadcast.mockClear()
  mocks.modelCreate.mockClear()
  mocks.modelBulkUpdate.mockClear()
  mocks.notifyDataChange.mockClear()
  return service
}

describe('CherryCloudService', () => {
  beforeEach(() => {
    CherryCloudService.resetInstances()
    vi.clearAllMocks()
    mocks.appIsPackaged = false
    mocks.savedSession = null
    mocks.modelList.mockReturnValue([
      { id: 'cherryai::qwen', providerId: 'cherryai', apiModelId: 'qwen', name: 'Qwen', group: 'Qwen' }
    ])
    mocks.modelCreate.mockReturnValue([])
    mocks.modelBulkUpdate.mockReturnValue([])
    mocks.openExternal.mockResolvedValue(undefined)
    mocks.acquireGatewayLease.mockResolvedValue(undefined)
    mocks.loopbackOpen.mockResolvedValue(mocks.loopbackReceiver)
  })

  it('persists the signed-in account across service restarts', async () => {
    mocks.netFetch
      .mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
      .mockResolvedValueOnce(jsonResponse(exchangeResponse()))
      .mockResolvedValueOnce(jsonResponse({ ...freeAccountSnapshot, entitlements: [] }))
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
        `cherrystudio://cloud-auth/callback?authorization_id=${authorizationId}&handoff_code=${token('D')}&state=${createBody.state}`
      )
    )
    expect(await service.getStatus()).toEqual({ phase: 'signed-in', displayName: 'Sora' })

    const exchangeRequest = mocks.netFetch.mock.calls[1]
    expect(exchangeRequest[0]).toBe(`http://127.0.0.1:8084/api/v1/desktop/authorizations/${authorizationId}/exchange`)
    const exchangeBody = JSON.parse(exchangeRequest[1].body as string)
    expect(exchangeBody).toMatchObject({ state: createBody.state, handoff_code: token('D') })
    expect(exchangeBody.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    await service.syncFreeModels()

    CherryCloudService.resetInstances()
    const restarted = new CherryCloudService()
    await restarted._doInit()
    expect(await restarted.getStatus()).toEqual({ phase: 'signed-in', displayName: 'Sora' })
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
      service.handleCallback(
        new URL(
          `cherrystudio://cloud-auth/callback?authorization_id=${authorizationId}&handoff_code=${token('D')}&state=${createBody.state}`
        )
      )
    ).rejects.toThrow('database is read-only')

    expect(await service.getStatus()).toEqual({ phase: 'signed-out', displayName: null })
    expect(mocks.savedSession).toBeNull()
  })

  it('uses the HTTPS production origin in packaged builds', async () => {
    mocks.appIsPackaged = true
    mocks.netFetch.mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
    const service = new CherryCloudService()
    await service._doInit()

    await expect(service.startLogin()).resolves.toEqual({ phase: 'authorizing', displayName: null })
    expect(mocks.loopbackOpen).not.toHaveBeenCalled()
    expect(mocks.netFetch.mock.calls[0][0]).toBe('https://cloud.cherryai.com.cn/api/v1/desktop/authorizations')
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

      const callback = service.handleCallback(
        new URL(
          `cherrystudio://cloud-auth/callback?authorization_id=${authorizationId}&handoff_code=${token('D')}&state=${createBody.state}`
        )
      )
      await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(2))
      await vi.advanceTimersByTimeAsync(5_000)
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

    await service.handleCallback(
      new URL(
        `cherrystudio://cloud-auth/callback?authorization_id=${authorizationId}&state=${createBody.state}&error=access_denied`
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

  it('does not let an invalid callback block the matching callback exchange', async () => {
    mocks.netFetch
      .mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
      .mockResolvedValueOnce(jsonResponse(exchangeResponse()))
    const service = new CherryCloudService()
    await service._doInit()
    await service.startLogin()
    const createBody = JSON.parse(mocks.netFetch.mock.calls[0][1].body as string)

    const invalidCallback = service.handleCallback(
      new URL(
        `cherrystudio://cloud-auth/callback?authorization_id=${authorizationId}&handoff_code=${token('D')}&state=wrong-state`
      )
    )
    const validCallback = service.handleCallback(
      new URL(
        `cherrystudio://cloud-auth/callback?authorization_id=${authorizationId}&handoff_code=${token('D')}&state=${createBody.state}`
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

    await expect(callback(new URL('cherrystudio://cloud-auth/callback?state=wrong'))).rejects.toThrow('does not match')
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

    const validCallback = service.handleCallback(
      new URL(
        `cherrystudio://cloud-auth/callback?authorization_id=${authorizationId}&handoff_code=${token('D')}&state=${createBody.state}`
      )
    )
    await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(2))
    const errorCallback = service.handleCallback(
      new URL(
        `cherrystudio://cloud-auth/callback?authorization_id=${authorizationId}&state=${createBody.state}&error=access_denied`
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
      service.handleCallback(
        new URL(`cherrystudio://cloud-auth/callback?authorization_id=${authorizationId}&state=${createBody.state}`)
      )
    ).rejects.toThrow('missing the handoff code')
    expect(await service.getStatus()).toEqual({ phase: 'signed-out', displayName: null })

    await expect(service.startLogin()).resolves.toEqual({ phase: 'authorizing', displayName: null })
    expect(mocks.netFetch).toHaveBeenCalledTimes(2)
    expect(mocks.openExternal).toHaveBeenCalledTimes(2)
  })

  it('syncs only models belonging to active free entitlements', async () => {
    const service = await createSignedInService()
    mocks.modelList.mockReturnValue([
      { id: 'cherryai::qwen', providerId: 'cherryai', apiModelId: 'qwen', name: 'Qwen', group: 'Qwen' },
      {
        id: 'cherryai::old-free',
        providerId: 'cherryai',
        apiModelId: 'old-free',
        name: 'Old Free',
        group: 'Cherry Cloud'
      }
    ])
    mocks.netFetch
      .mockResolvedValueOnce(jsonResponse(freeAccountSnapshot))
      .mockResolvedValueOnce(jsonResponse(cloudModelCatalog))

    await expect(service.syncFreeModels()).resolves.toEqual({ modelCount: 1 })

    expect(mocks.modelCreate).toHaveBeenCalledWith([
      {
        dto: expect.objectContaining({
          providerId: 'cherryai',
          modelId: 'deepseek-free',
          name: 'DeepSeek Free',
          group: 'Cherry Cloud',
          contextWindow: 128_000,
          maxOutputTokens: 8_192
        })
      }
    ])
    expect(mocks.modelBulkUpdate).toHaveBeenCalledWith([
      expect.objectContaining({
        providerId: 'cherryai',
        modelId: 'old-free',
        patch: expect.objectContaining({ isEnabled: false })
      })
    ])
    expect(mocks.notifyDataChange).toHaveBeenCalledWith([{ endpoint: '/models', kind: 'membership' }])

    for (const [, init] of mocks.netFetch.mock.calls) {
      const headers = new Headers(init.headers)
      expect(headers.get('Authorization')).toBe(`Bearer ${token('F')}`)
      expect(headers.get('Cherry-Device-ID')).toBe(deviceId)
      expect(headers.get('Cherry-Signature')).toMatch(/^[A-Za-z0-9_-]{86}$/)
    }
  })

  it('does not apply a model sync that finishes after the Session is cleared', async () => {
    const service = await createSignedInService()
    const accountRequest = deferred<Response>()
    const catalogRequest = deferred<Response>()
    mocks.netFetch
      .mockReturnValueOnce(accountRequest.promise)
      .mockReturnValueOnce(catalogRequest.promise)
      .mockResolvedValueOnce(jsonResponse({ type: 'error' }, 401))

    const sync = service.syncFreeModels()
    await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(2))
    await service.authenticatedFetch('/v1/messages', { method: 'POST' })

    accountRequest.resolve(jsonResponse(freeAccountSnapshot))
    catalogRequest.resolve(jsonResponse(cloudModelCatalog))

    await expect(sync).resolves.toEqual({ modelCount: 0 })
    expect(mocks.modelCreate).not.toHaveBeenCalled()
  })

  it('starts a new model sync when the account changes during an older sync', async () => {
    const service = await createSignedInService()
    const oldAccountRequest = deferred<Response>()
    const oldCatalogRequest = deferred<Response>()
    mocks.netFetch
      .mockReturnValueOnce(oldAccountRequest.promise)
      .mockReturnValueOnce(oldCatalogRequest.promise)
      .mockResolvedValueOnce(jsonResponse({ type: 'error' }, 401))

    const oldSync = service.syncFreeModels()
    await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(2))
    await service.authenticatedFetch('/v1/messages', { method: 'POST' })

    mocks.netFetch
      .mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
      .mockResolvedValueOnce(jsonResponse(exchangeResponse()))
      .mockResolvedValueOnce(jsonResponse(freeAccountSnapshot))
      .mockResolvedValueOnce(jsonResponse(cloudModelCatalog))
    await service.startLogin()
    const createBody = JSON.parse(mocks.netFetch.mock.calls[3][1].body as string)
    await service.handleCallback(
      new URL(
        `cherrystudio://cloud-auth/callback?authorization_id=${authorizationId}&handoff_code=${token('D')}&state=${createBody.state}`
      )
    )

    await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(7))
    oldAccountRequest.resolve(jsonResponse(freeAccountSnapshot))
    oldCatalogRequest.resolve(jsonResponse(cloudModelCatalog))

    await expect(oldSync).resolves.toEqual({ modelCount: 0 })
    expect(mocks.modelCreate).toHaveBeenCalledWith([
      expect.objectContaining({ dto: expect.objectContaining({ modelId: 'deepseek-free' }) })
    ])
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

  it('clears runtime state when a refreshed Session cannot be persisted', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-02T03:00:00Z'))

    try {
      const service = await createSignedInService()
      await service.ensureAgentGateway()
      mocks.sessionReplace.mockImplementationOnce(() => {
        throw new Error('database is read-only')
      })
      mocks.netFetch.mockResolvedValueOnce(jsonResponse(refreshedTokenSet()))
      clock.mockReturnValue(Date.parse('2030-01-02T03:09:30Z'))

      await expect(service.authenticatedFetch('/v1/models')).rejects.toThrow('database is read-only')

      expect(await service.getStatus()).toEqual({ phase: 'signed-out', displayName: null })
      expect(mocks.savedSession).toBeNull()
      expect(mocks.releaseGatewayLease).toHaveBeenCalledOnce()
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
      await service.ensureAgentGateway()
      const sessionGeneration = await service.getSessionGeneration()
      const oldRequest = service.authenticatedFetch('/v1/messages', { method: 'POST' })
      await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(1))

      clock.mockReturnValue(Date.parse('2030-01-02T03:09:30Z'))
      await expect(service.authenticatedFetch('/v1/models')).resolves.toHaveProperty('status', 200)
      pendingOldRequest.resolve(jsonResponse({ type: 'error' }, 401))
      await expect(oldRequest).resolves.toHaveProperty('status', 401)

      expect(await service.getStatus()).toEqual({ phase: 'signed-in', displayName: 'Sora' })
      expect(await service.getSessionGeneration()).toBe(sessionGeneration)
      expect(mocks.savedSession).toMatchObject({ accessToken: token('H'), refreshToken: token('I') })
      expect(mocks.releaseGatewayLease).not.toHaveBeenCalled()
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
      await service.ensureAgentGateway()
      const sessionGeneration = await service.getSessionGeneration()
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
      expect(await service.getSessionGeneration()).toBe(sessionGeneration + 1)
      expect(mocks.savedSession).toBeNull()
      expect(mocks.releaseGatewayLease).toHaveBeenCalledOnce()
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
        .mockResolvedValueOnce(jsonResponse({ ...freeAccountSnapshot, entitlements: [] }))
        .mockResolvedValueOnce(jsonResponse({ data: [] }))
      await service.startLogin()
      const createBody = JSON.parse(mocks.netFetch.mock.calls[2][1].body as string)
      await service.handleCallback(
        new URL(
          `cherrystudio://cloud-auth/callback?authorization_id=${authorizationId}&handoff_code=${token('D')}&state=${createBody.state}`
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

    const headers = new Headers(mocks.netFetch.mock.calls[0][1].headers)
    expect(headers.get('Idempotency-Key')).toMatch(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/)
    expect(headers.get('Cherry-Body-SHA256')).toBe('f24394a04116608ee41330b7fd6511ff8e44f65e29f6cfc44bb7c8393de7e5ea')
  })

  it('revokes the current Product Session before clearing the local login', async () => {
    const service = await createSignedInService()
    mocks.netFetch.mockResolvedValueOnce(new Response(null, { status: 204 }))

    await expect(service.revokeCurrentSession()).resolves.toEqual({ phase: 'signed-out', displayName: null })

    const [url, init] = mocks.netFetch.mock.calls[0]
    const headers = new Headers(init.headers)
    expect(url).toBe('http://127.0.0.1:8084/api/v1/product-sessions/current')
    expect(init.method).toBe('DELETE')
    expect(headers.get('Authorization')).toBe(`Bearer ${token('F')}`)
    expect(headers.get('Cherry-Device-ID')).toBe(deviceId)
    expect(headers.get('Cherry-Signature')).toMatch(/^[A-Za-z0-9_-]{86}$/)
    expect(mocks.savedSession).toBeNull()
  })

  it('does not let an older logout response clear a newer Session', async () => {
    const service = await createSignedInService()
    const pendingRevoke = deferred<Response>()
    mocks.netFetch.mockReturnValueOnce(pendingRevoke.promise).mockResolvedValueOnce(jsonResponse({}, 401))

    const revoke = service.revokeCurrentSession()
    await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(1))
    await service.authenticatedFetch('/v1/messages', { method: 'POST' })

    mocks.netFetch
      .mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
      .mockResolvedValueOnce(jsonResponse(exchangeResponse()))
      .mockResolvedValueOnce(jsonResponse({ ...freeAccountSnapshot, entitlements: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
    await service.startLogin()
    const createBody = JSON.parse(mocks.netFetch.mock.calls[2][1].body as string)
    await service.handleCallback(
      new URL(
        `cherrystudio://cloud-auth/callback?authorization_id=${authorizationId}&handoff_code=${token('D')}&state=${createBody.state}`
      )
    )
    pendingRevoke.resolve(new Response(null, { status: 204 }))

    await expect(revoke).resolves.toEqual({ phase: 'signed-in', displayName: 'Sora' })
    expect(await service.getStatus()).toEqual({ phase: 'signed-in', displayName: 'Sora' })
    expect(mocks.savedSession).not.toBeNull()
  })

  it('finishes local logout when the current Product Session is already invalid', async () => {
    const service = await createSignedInService()
    mocks.netFetch.mockResolvedValueOnce(jsonResponse({ type: 'error' }, 401))

    await expect(service.revokeCurrentSession()).resolves.toEqual({ phase: 'signed-out', displayName: null })
    expect(mocks.savedSession).toBeNull()
  })

  it('keeps the local login when remote Product Session revocation fails', async () => {
    const service = await createSignedInService()
    mocks.netFetch.mockResolvedValueOnce(jsonResponse({ type: 'error' }, 503))

    await expect(service.revokeCurrentSession()).rejects.toThrow('Cherry Cloud logout failed (503)')

    expect(await service.getStatus()).toEqual({ phase: 'signed-in', displayName: 'Sora' })
    expect(mocks.savedSession).not.toBeNull()
  })

  it('clears the Product Session when Cloud API rejects authentication', async () => {
    const service = await createSignedInService()
    mocks.netFetch.mockResolvedValueOnce(jsonResponse({ type: 'error' }, 401))
    const sessionGeneration = await service.getSessionGeneration()

    await expect(service.authenticatedFetch('/v1/messages', { method: 'POST' })).resolves.toHaveProperty('status', 401)

    expect(await service.getStatus()).toEqual({ phase: 'signed-out', displayName: null })
    expect(await service.getSessionGeneration()).toBe(sessionGeneration + 1)
    expect(mocks.savedSession).toBeNull()
  })

  it('finishes runtime cleanup when persisted Session removal fails', async () => {
    const service = await createSignedInService()
    await service.ensureAgentGateway()
    mocks.sessionClear.mockImplementationOnce(() => {
      throw new Error('database is read-only')
    })
    mocks.netFetch.mockResolvedValueOnce(jsonResponse({ type: 'error' }, 401))

    await expect(service.authenticatedFetch('/v1/messages', { method: 'POST' })).rejects.toThrow(
      'database is read-only'
    )

    expect(await service.getStatus()).toEqual({ phase: 'signed-out', displayName: null })
    expect(mocks.releaseGatewayLease).toHaveBeenCalledOnce()
    expect(mocks.broadcast).toHaveBeenLastCalledWith('cherry_cloud.status_changed', {
      phase: 'signed-out',
      displayName: null
    })
  })

  it('broadcasts signed out when managed model cleanup fails', async () => {
    const service = await createSignedInService()
    mocks.modelList.mockReturnValue([
      {
        id: 'cherryai::deepseek-free',
        providerId: 'cherryai',
        apiModelId: 'deepseek-free',
        name: 'DeepSeek Free',
        group: 'Cherry Cloud',
        isEnabled: true
      }
    ])
    mocks.modelBulkUpdate.mockImplementationOnce(() => {
      throw new Error('database is read-only')
    })
    mocks.netFetch.mockResolvedValueOnce(jsonResponse({}, 401))

    await expect(service.authenticatedFetch('/v1/messages', { method: 'POST' })).rejects.toThrow(
      'database is read-only'
    )

    expect(await service.getStatus()).toEqual({ phase: 'signed-out', displayName: null })
    expect(mocks.broadcast).toHaveBeenLastCalledWith('cherry_cloud.status_changed', {
      phase: 'signed-out',
      displayName: null
    })
  })

  it('does not install a new Session until the previous gateway cleanup finishes', async () => {
    const service = await createSignedInService()
    const pendingLease = deferred<void>()
    mocks.acquireGatewayLease.mockReturnValueOnce(pendingLease.promise)
    const oldGateway = service.ensureAgentGateway()
    await vi.waitFor(() => expect(mocks.acquireGatewayLease).toHaveBeenCalledOnce())
    mocks.netFetch
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
      .mockResolvedValueOnce(jsonResponse(exchangeResponse()))
      .mockResolvedValueOnce(jsonResponse({ ...freeAccountSnapshot, entitlements: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))

    const oldRequest = service.authenticatedFetch('/v1/messages', { method: 'POST' })
    await vi.waitFor(() => expect(mocks.sessionClear).toHaveBeenCalledOnce())
    await service.startLogin()
    const createBody = JSON.parse(mocks.netFetch.mock.calls[1][1].body as string)
    const newLogin = service.handleCallback(
      new URL(
        `cherrystudio://cloud-auth/callback?authorization_id=${authorizationId}&handoff_code=${token('D')}&state=${createBody.state}`
      )
    )
    await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(3))
    await new Promise<void>((resolve) => setImmediate(resolve))

    const statusBeforeCleanup = await service.getStatus()
    expect(mocks.sessionReplace).toHaveBeenCalledOnce()
    pendingLease.resolve()
    await Promise.all([oldGateway, oldRequest, newLogin])

    expect(statusBeforeCleanup).toEqual({ phase: 'authorizing', displayName: null })
    expect(await service.getStatus()).toEqual({ phase: 'signed-in', displayName: 'Sora' })
    expect(mocks.releaseGatewayLease).toHaveBeenCalledOnce()
    await service.ensureAgentGateway()
    expect(mocks.acquireGatewayLease).toHaveBeenCalledTimes(2)
  })

  it('expires the Product Session before a warm agent connection can be reused', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2030-01-02T03:00:00Z'))
      mocks.appIsPackaged = true
      mocks.netFetch
        .mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
        .mockResolvedValueOnce(jsonResponse(exchangeResponse(600, '2030-01-02T03:00:05Z')))
        .mockResolvedValueOnce(jsonResponse({ ...freeAccountSnapshot, entitlements: [] }))
        .mockResolvedValueOnce(jsonResponse({ data: [] }))
      const service = new CherryCloudService()
      await service._doInit()
      await service.startLogin()
      const createBody = JSON.parse(mocks.netFetch.mock.calls[0][1].body as string)
      await service.handleCallback(
        new URL(
          `cherrystudio://cloud-auth/callback?authorization_id=${authorizationId}&handoff_code=${token('D')}&state=${createBody.state}`
        )
      )
      await service.syncFreeModels()
      mocks.modelList.mockReturnValue([
        {
          id: 'cherryai::deepseek-free',
          providerId: 'cherryai',
          apiModelId: 'deepseek-free',
          name: 'DeepSeek Free',
          group: 'Cherry Cloud',
          isEnabled: true
        }
      ])
      mocks.modelBulkUpdate.mockClear()
      await service.ensureAgentGateway()
      const sessionGeneration = await service.getSessionGeneration()

      await vi.advanceTimersByTimeAsync(5_000)
      await Promise.resolve()
      await Promise.resolve()

      expect(mocks.sessionClear).toHaveBeenCalledOnce()
      expect(mocks.broadcast).toHaveBeenLastCalledWith('cherry_cloud.status_changed', {
        phase: 'signed-out',
        displayName: null
      })
      expect(await service.getSessionGeneration()).toBe(sessionGeneration + 1)
      expect(await service.getStatus()).toEqual({ phase: 'signed-out', displayName: null })
      expect(mocks.releaseGatewayLease).toHaveBeenCalledOnce()
      expect(mocks.savedSession).toBeNull()
      expect(mocks.modelBulkUpdate).toHaveBeenCalledWith([
        expect.objectContaining({
          providerId: 'cherryai',
          modelId: 'deepseek-free',
          patch: expect.objectContaining({ isEnabled: false })
        })
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('holds one temporary API gateway lease while Cloud Work can use the signed session', async () => {
    const service = await createSignedInService()

    await Promise.all([service.ensureAgentGateway(), service.ensureAgentGateway()])
    expect(mocks.acquireGatewayLease).toHaveBeenCalledOnce()

    await service._doStop()
    expect(mocks.releaseGatewayLease).toHaveBeenCalledOnce()
  })
})
