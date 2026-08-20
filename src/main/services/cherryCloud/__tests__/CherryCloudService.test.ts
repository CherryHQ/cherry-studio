import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  broadcast: vi.fn(),
  netFetch: vi.fn(),
  openExternal: vi.fn(),
  storedBytes: null as Uint8Array | null,
  writeFile: vi.fn()
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
  app: { getVersion: () => '2.1.0' },
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

import { CherryCloudService } from '../CherryCloudService'

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
    authorization_url: `https://cloud.example.invalid/desktop/authorize?authorization_id=${authorizationId}`,
    expires_at: '2030-01-02T03:14:05Z'
  }
}

describe('CherryCloudService', () => {
  beforeEach(() => {
    CherryCloudService.resetInstances()
    vi.clearAllMocks()
    mocks.storedBytes = null
    mocks.openExternal.mockResolvedValue(undefined)
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
      `https://cloud.example.invalid/desktop/authorize?authorization_id=${authorizationId}`
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
})
