import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
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
      throw new Error(`Unexpected service: ${name}`)
    },
    getPath: () => '/mock/cherry-cloud-session.enc'
  }
}))

vi.mock('electron', () => ({
  app: { getVersion: () => '2.1.0', isPackaged: false },
  net: { fetch: mocks.netFetch },
  safeStorage: {
    isEncryptionAvailable: () => true,
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

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
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
    authorization_url: `http://localhost:8080/desktop/authorize?authorization_id=${authorizationId}`,
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
    mocks.storedBytes = null
    mocks.modelList.mockReturnValue([
      { id: 'cherryai::qwen', providerId: 'cherryai', apiModelId: 'qwen', name: 'Qwen', group: 'Qwen' }
    ])
    mocks.modelCreate.mockReturnValue([])
    mocks.modelBulkUpdate.mockReturnValue([])
    mocks.openExternal.mockResolvedValue(undefined)
    mocks.loopbackOpen.mockResolvedValue(mocks.loopbackReceiver)
    vi.stubEnv('CHERRY_CLOUD_LOOPBACK_CALLBACK', 'false')
  })

  afterEach(() => vi.unstubAllEnvs())

  it('creates a desktop authorization, exchanges its callback, and restores the signed-in account', async () => {
    mocks.netFetch
      .mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
      .mockResolvedValueOnce(jsonResponse(exchangeResponse()))

    const service = new CherryCloudService()
    await service._doInit()
    expect(await service.getStatus()).toEqual({ phase: 'signed-out', displayName: null })

    expect(await service.startLogin()).toEqual({ phase: 'authorizing', displayName: null })
    expect(mocks.openExternal).toHaveBeenCalledWith(
      `http://localhost:8080/desktop/authorize?authorization_id=${authorizationId}`
    )

    const createRequest = mocks.netFetch.mock.calls[0]
    expect(createRequest[0]).toBe('http://127.0.0.1:8080/api/v1/desktop/authorizations')
    const createBody = JSON.parse(createRequest[1].body as string)
    expect(createBody).toMatchObject({
      code_challenge_method: 'S256',
      platform: process.platform === 'win32' ? 'windows' : process.platform,
      client_version: '2.1.0'
    })
    expect(createBody.state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(createBody.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(createBody.device_public_key).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(createBody.callback_port).toBeUndefined()

    await service.handleCallback(
      new URL(
        `cherrystudio://cloud-auth/callback?authorization_id=${authorizationId}&handoff_code=${token('D')}&state=${createBody.state}`
      )
    )
    expect(await service.getStatus()).toEqual({ phase: 'signed-in', displayName: 'Sora' })

    const exchangeRequest = mocks.netFetch.mock.calls[1]
    expect(exchangeRequest[0]).toBe(`http://127.0.0.1:8080/api/v1/desktop/authorizations/${authorizationId}/exchange`)
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

  it('uses an ephemeral loopback callback for local development', async () => {
    vi.stubEnv('CHERRY_CLOUD_LOOPBACK_CALLBACK', 'true')
    mocks.netFetch
      .mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
      .mockResolvedValueOnce(jsonResponse(exchangeResponse()))

    const service = new CherryCloudService()
    await service._doInit()
    await service.startLogin()

    const createBody = JSON.parse(mocks.netFetch.mock.calls[0][1].body as string)
    expect(createBody.callback_port).toBe(49152)
    expect(mocks.loopbackReceiver.setExpiresAt).toHaveBeenCalledWith('2030-01-02T03:14:05Z')

    const callback = mocks.loopbackOpen.mock.calls[0][0] as (url: URL) => Promise<void>
    await callback(
      new URL(
        `cherrystudio://cloud-auth/callback?authorization_id=${authorizationId}&handoff_code=${token('D')}&state=${createBody.state}`
      )
    )
    expect(await service.getStatus()).toEqual({ phase: 'signed-in', displayName: 'Sora' })
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

  it('does not let a matching error callback clear an exchange in progress', async () => {
    let resolveExchange!: (response: Response) => void
    const pendingExchange = new Promise<Response>((resolve) => {
      resolveExchange = resolve
    })
    mocks.netFetch
      .mockResolvedValueOnce(jsonResponse(authorizationResponse(), 201))
      .mockReturnValueOnce(pendingExchange)
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
    resolveExchange(jsonResponse(exchangeResponse()))
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
      .mockResolvedValueOnce(
        jsonResponse({
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
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { id: 'deepseek-free', display_name: 'DeepSeek Free' },
            { id: 'deepseek-go', display_name: 'DeepSeek GO' }
          ]
        })
      )

    const service = new CherryCloudService()
    await service._doInit()
    await expect(service.syncFreeModels()).resolves.toEqual({ modelCount: 1 })

    expect(mocks.modelCreate).toHaveBeenCalledWith([
      {
        dto: expect.objectContaining({
          providerId: 'cherryai',
          modelId: 'deepseek-free',
          name: 'DeepSeek Free',
          group: 'Cherry Cloud'
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

  it('rotates an expired access token before a signed model request', async () => {
    restoreSignedInState('2026-01-02T03:14:05Z')
    mocks.netFetch
      .mockResolvedValueOnce(
        jsonResponse({
          token_set: {
            token_type: 'Bearer',
            access_token: token('H'),
            expires_in: 600,
            refresh_token: token('I'),
            session_id: sessionId,
            session_expires_at: '2030-02-01T03:04:05Z'
          }
        })
      )
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
})
