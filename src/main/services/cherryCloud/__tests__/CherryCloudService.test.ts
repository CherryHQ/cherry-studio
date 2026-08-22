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
  safeStorageBackend: 'gnome_libsecret',
  storedBytes: null as Uint8Array | null,
  writeFile: vi.fn()
}))

vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: mocks.notifyDataChange }))

vi.mock('@data/services/ModelService', () => ({
  modelService: {
    bulkUpdate: mocks.modelBulkUpdate,
    create: mocks.modelCreate,
    list: mocks.modelList
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
    },
    getPath: () => '/mock/cherry-cloud-session.enc'
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
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => mocks.safeStorageBackend,
    encryptString: (value: string) => Buffer.from(value).map((byte) => byte ^ 0xff),
    decryptString: (value: Buffer) =>
      Buffer.from(value)
        .map((byte) => byte ^ 0xff)
        .toString()
  },
  shell: { openExternal: mocks.openExternal }
}))

vi.mock('../loopbackCallback', () => ({
  CherryCloudLoopbackCallback: { open: mocks.loopbackOpen }
}))

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async () => {
    if (mocks.storedBytes) return Buffer.from(mocks.storedBytes)
    const error = new Error('missing') as NodeJS.ErrnoException
    error.code = 'ENOENT'
    throw error
  })
}))

vi.mock('@main/utils/file', () => ({
  atomicWriteFile: vi.fn(async (_path: string, data: Uint8Array) => {
    mocks.storedBytes = new Uint8Array(data)
    mocks.writeFile(data)
  })
}))

import { CherryCloudLoginUnavailableError, CherryCloudService } from '../CherryCloudService'
import { createDeviceKeyPair } from '../crypto'

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

function exchangeResponse() {
  return {
    token_set: {
      token_type: 'Bearer',
      access_token: token('F'),
      expires_in: 600,
      refresh_token: token('G'),
      session_id: sessionId,
      session_expires_at: '2030-02-01T03:04:05Z'
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

function authorizationResponse() {
  return {
    authorization_id: authorizationId,
    authorization_url: `http://localhost:8084/desktop/authorize?authorization_id=${authorizationId}`,
    expires_at: '2030-01-02T03:14:05Z'
  }
}

function restoreSignedInState(accessExpiresAt = '2030-01-02T03:14:05Z') {
  const device = createDeviceKeyPair()
  const stored = {
    version: 1,
    device,
    pending: null,
    session: {
      accessToken: token('F'),
      accessExpiresAt,
      refreshToken: token('G'),
      sessionId,
      sessionExpiresAt: '2030-02-01T03:04:05Z',
      deviceId,
      accountId,
      displayName: 'Sora'
    }
  }
  mocks.storedBytes = Buffer.from(JSON.stringify(stored)).map((byte) => byte ^ 0xff)
  return device
}

describe('CherryCloudService', () => {
  beforeEach(() => {
    CherryCloudService.resetInstances()
    vi.clearAllMocks()
    mocks.appIsPackaged = false
    mocks.safeStorageBackend = 'gnome_libsecret'
    mocks.storedBytes = null
    mocks.modelList.mockReturnValue([
      { id: 'cherryai::qwen', providerId: 'cherryai', apiModelId: 'qwen', name: 'Qwen', group: 'Qwen' }
    ])
    mocks.modelCreate.mockReturnValue([])
    mocks.modelBulkUpdate.mockReturnValue([])
    mocks.openExternal.mockResolvedValue(undefined)
    mocks.acquireGatewayLease.mockResolvedValue(undefined)
    mocks.loopbackOpen.mockResolvedValue(mocks.loopbackReceiver)
  })

  it('creates a desktop authorization, exchanges its callback, and restores the signed-in account', async () => {
    mocks.netFetch
      .mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
      .mockResolvedValueOnce(jsonResponse(exchangeResponse()))

    const service = new CherryCloudService()
    await service._doInit()
    expect(await service.getStatus()).toEqual({ phase: 'signed-out', displayName: null })

    expect(await service.startLogin()).toEqual({ phase: 'authorizing', displayName: null })
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
    expect(mocks.writeFile).toHaveBeenCalled()
    expect(Buffer.from(mocks.storedBytes!).toString()).not.toContain(token('F'))

    CherryCloudService.resetInstances()
    const restored = new CherryCloudService()
    await restored._doInit()
    expect(await restored.getStatus()).toEqual({ phase: 'signed-in', displayName: 'Sora' })
  })

  it('refuses Linux basic_text storage without restoring or persisting credentials', async () => {
    restoreSignedInState()
    mocks.safeStorageBackend = 'basic_text'
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')

    try {
      const service = new CherryCloudService()
      await service._doInit()

      expect(await service.getStatus()).toEqual({ phase: 'signed-out', displayName: null })
      await expect(service.startLogin()).rejects.toThrow('Secure credential storage is unavailable')
      expect(mocks.netFetch).not.toHaveBeenCalled()
      expect(mocks.writeFile).not.toHaveBeenCalled()
    } finally {
      platform.mockRestore()
    }
  })

  it('restores credentials from a Linux secret-service backend', async () => {
    restoreSignedInState()
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')

    try {
      const service = new CherryCloudService()
      await service._doInit()

      expect(await service.getStatus()).toEqual({ phase: 'signed-in', displayName: 'Sora' })
    } finally {
      platform.mockRestore()
    }
  })

  it('fails closed in packaged builds until the production origin is configured', async () => {
    mocks.appIsPackaged = true
    const service = new CherryCloudService()
    await service._doInit()

    await expect(service.startLogin()).rejects.toBeInstanceOf(CherryCloudLoginUnavailableError)
    expect(mocks.loopbackOpen).not.toHaveBeenCalled()
    expect(mocks.netFetch).not.toHaveBeenCalled()
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

    CherryCloudService.resetInstances()
    const restored = new CherryCloudService()
    await restored._doInit()
    expect(await restored.getStatus()).toEqual({ phase: 'signed-in', displayName: 'Sora' })
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
    restoreSignedInState()
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

    const service = new CherryCloudService()
    await service._doInit()
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
    restoreSignedInState()
    const accountRequest = deferred<Response>()
    const catalogRequest = deferred<Response>()
    mocks.netFetch
      .mockReturnValueOnce(accountRequest.promise)
      .mockReturnValueOnce(catalogRequest.promise)
      .mockResolvedValueOnce(jsonResponse({ type: 'error' }, 401))

    const service = new CherryCloudService()
    await service._doInit()
    const sync = service.syncFreeModels()
    await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(2))
    await service.authenticatedFetch('/v1/messages', { method: 'POST' })

    accountRequest.resolve(jsonResponse(freeAccountSnapshot))
    catalogRequest.resolve(jsonResponse(cloudModelCatalog))

    await expect(sync).resolves.toEqual({ modelCount: 0 })
    expect(mocks.modelCreate).not.toHaveBeenCalled()
  })

  it('rotates an expired access token before a signed model request', async () => {
    restoreSignedInState('2026-01-02T03:14:05Z')
    mocks.netFetch
      .mockResolvedValueOnce(jsonResponse(refreshedTokenSet()))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))

    const service = new CherryCloudService()
    await service._doInit()
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
    expect(Buffer.from(mocks.storedBytes!).toString()).not.toContain(token('I'))
  })

  it('keeps a refreshed Session when an older request returns 401 afterward', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-02T03:00:00Z'))
    restoreSignedInState('2030-01-02T03:02:00Z')
    const pendingOldRequest = deferred<Response>()
    mocks.netFetch
      .mockReturnValueOnce(pendingOldRequest.promise)
      .mockResolvedValueOnce(jsonResponse(refreshedTokenSet()))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))

    try {
      const service = new CherryCloudService()
      await service._doInit()
      await service.ensureAgentGateway()
      const sessionGeneration = await service.getSessionGeneration()
      const oldRequest = service.authenticatedFetch('/v1/messages', { method: 'POST' })
      await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(1))

      clock.mockReturnValue(Date.parse('2030-01-02T03:01:30Z'))
      await expect(service.authenticatedFetch('/v1/models')).resolves.toHaveProperty('status', 200)
      pendingOldRequest.resolve(jsonResponse({ type: 'error' }, 401))
      await expect(oldRequest).resolves.toHaveProperty('status', 401)

      expect(await service.getStatus()).toEqual({ phase: 'signed-in', displayName: 'Sora' })
      expect(await service.getSessionGeneration()).toBe(sessionGeneration)
      expect(mocks.releaseGatewayLease).not.toHaveBeenCalled()
      expect(new Headers(mocks.netFetch.mock.calls[2][1].headers).get('Authorization')).toBe(`Bearer ${token('H')}`)
    } finally {
      clock.mockRestore()
    }
  })

  it('does not restore a refreshed Session after an older request has cleared it', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-02T03:00:00Z'))
    restoreSignedInState('2030-01-02T03:02:00Z')
    const pendingOldRequest = deferred<Response>()
    const pendingRefresh = deferred<Response>()
    mocks.netFetch.mockReturnValueOnce(pendingOldRequest.promise).mockReturnValueOnce(pendingRefresh.promise)

    try {
      const service = new CherryCloudService()
      await service._doInit()
      await service.ensureAgentGateway()
      const sessionGeneration = await service.getSessionGeneration()
      const oldRequest = service.authenticatedFetch('/v1/messages', { method: 'POST' })
      await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(1))

      clock.mockReturnValue(Date.parse('2030-01-02T03:01:30Z'))
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
      expect(mocks.releaseGatewayLease).toHaveBeenCalledOnce()
      expect(mocks.writeFile).toHaveBeenCalledOnce()
      expect(mocks.netFetch).toHaveBeenCalledTimes(2)
    } finally {
      clock.mockRestore()
    }
  })

  it('adds an idempotency key to signed Anthropic message requests', async () => {
    restoreSignedInState()
    mocks.netFetch.mockResolvedValueOnce(jsonResponse({ type: 'message' }))
    const service = new CherryCloudService()
    await service._doInit()

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
    restoreSignedInState()
    mocks.netFetch.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const service = new CherryCloudService()
    await service._doInit()

    await expect(service.revokeCurrentSession()).resolves.toEqual({ phase: 'signed-out', displayName: null })

    const [url, init] = mocks.netFetch.mock.calls[0]
    const headers = new Headers(init.headers)
    expect(url).toBe('http://127.0.0.1:8084/api/v1/product-sessions/current')
    expect(init.method).toBe('DELETE')
    expect(headers.get('Authorization')).toBe(`Bearer ${token('F')}`)
    expect(headers.get('Cherry-Device-ID')).toBe(deviceId)
    expect(headers.get('Cherry-Signature')).toMatch(/^[A-Za-z0-9_-]{86}$/)
    expect(mocks.writeFile).toHaveBeenCalledOnce()
  })

  it('finishes local logout when the current Product Session is already invalid', async () => {
    restoreSignedInState()
    mocks.netFetch.mockResolvedValueOnce(jsonResponse({ type: 'error' }, 401))
    const service = new CherryCloudService()
    await service._doInit()

    await expect(service.revokeCurrentSession()).resolves.toEqual({ phase: 'signed-out', displayName: null })
    expect(mocks.writeFile).toHaveBeenCalledOnce()
  })

  it('keeps the local login when remote Product Session revocation fails', async () => {
    restoreSignedInState()
    mocks.netFetch.mockResolvedValueOnce(jsonResponse({ type: 'error' }, 503))
    const service = new CherryCloudService()
    await service._doInit()

    await expect(service.revokeCurrentSession()).rejects.toThrow('Cherry Cloud logout failed (503)')

    expect(await service.getStatus()).toEqual({ phase: 'signed-in', displayName: 'Sora' })
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('clears the Product Session when Cloud API rejects authentication', async () => {
    restoreSignedInState()
    mocks.netFetch.mockResolvedValueOnce(jsonResponse({ type: 'error' }, 401))
    const service = new CherryCloudService()
    await service._doInit()
    const sessionGeneration = await service.getSessionGeneration()

    await expect(service.authenticatedFetch('/v1/messages', { method: 'POST' })).resolves.toHaveProperty('status', 401)

    expect(await service.getStatus()).toEqual({ phase: 'signed-out', displayName: null })
    expect(await service.getSessionGeneration()).toBe(sessionGeneration + 1)
    expect(mocks.writeFile).toHaveBeenCalledOnce()
  })

  it('expires the Product Session before a warm agent connection can be reused', async () => {
    restoreSignedInState()
    const service = new CherryCloudService()
    await service._doInit()
    await service.ensureAgentGateway()
    const sessionGeneration = await service.getSessionGeneration()

    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2031-01-01T00:00:00Z'))

      expect(await service.getSessionGeneration()).toBe(sessionGeneration + 1)
      expect(await service.getStatus()).toEqual({ phase: 'signed-out', displayName: null })
      expect(mocks.releaseGatewayLease).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('holds one temporary API gateway lease while Cloud Work can use the signed session', async () => {
    restoreSignedInState()
    const service = new CherryCloudService()
    await service._doInit()

    await Promise.all([service.ensureAgentGateway(), service.ensureAgentGateway()])
    expect(mocks.acquireGatewayLease).toHaveBeenCalledOnce()

    await service._doStop()
    expect(mocks.releaseGatewayLease).toHaveBeenCalledOnce()
  })
})
