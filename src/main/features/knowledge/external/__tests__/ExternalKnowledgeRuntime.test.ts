import { describe, expect, it, vi } from 'vitest'

import type { ExternalKnowledgeConnection } from '@shared/data/types/externalKnowledgeConnection'

import type {
  ExternalKnowledgeCredential,
  ExternalKnowledgeCredentialReadResult,
  ExternalKnowledgeTokenSet,
  TokenRotationResult
} from '../ExternalKnowledgeCredentialStore'
import { ExternalKnowledgeRuntime } from '../ExternalKnowledgeRuntime'
import { FEISHU_KNOWLEDGE_USER_SCOPES, FeishuProviderError, type FeishuUserTokenSet } from '../feishuKnowledgeProvider'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function connection(
  id: string,
  credentialReference: string,
  overrides: Partial<ExternalKnowledgeConnection> = {}
): ExternalKnowledgeConnection {
  return {
    id,
    provider: 'feishu',
    appId: `cli_${id}`,
    appCredentialSource: 'custom-app',
    authorizationStatus: 'connected',
    credentialReference,
    accountOpenId: `ou_${id}`,
    accountUnionId: null,
    tenantKey: `tenant_${id}`,
    displayName: id,
    avatarUrl: null,
    applicationName: null,
    grantedScopes: [...FEISHU_KNOWLEDGE_USER_SCOPES],
    authorizedAt: '2026-01-01T00:00:00.000Z',
    lastValidatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

class MemoryConnections {
  readonly values = new Map<string, ExternalKnowledgeConnection>()
  startupList: ExternalKnowledgeConnection[] = []

  list = vi.fn(() => this.startupList)
  getById = vi.fn((id: string) => this.values.get(id) ?? null)
  create = vi.fn((input: any) => {
    const value = connection(
      `01960000-0000-7000-8000-${String(this.values.size + 1).padStart(12, '0')}`,
      input.credentialReference,
      {
        appId: input.appId,
        appCredentialSource: input.appCredentialSource,
        applicationName: input.applicationName ?? null,
        authorizationStatus: 'pending-authorization',
        accountOpenId: null,
        tenantKey: null,
        grantedScopes: [],
        authorizedAt: null,
        lastValidatedAt: null
      }
    )
    this.values.set(value.id, value)
    return value
  })
  markConnected = vi.fn((id: string, identity: any) => {
    const value = { ...this.values.get(id)!, ...identity, authorizationStatus: 'connected' as const }
    this.values.set(id, value)
    return value
  })
  markValidated = vi.fn((id: string, identity: any) => {
    const value = { ...this.values.get(id)!, ...identity }
    this.values.set(id, value)
    return value
  })
  markReauthorizationRequired = vi.fn((id: string) => {
    const value = { ...this.values.get(id)!, authorizationStatus: 'reauthorization-required' as const }
    this.values.set(id, value)
    return value
  })
  remove = vi.fn((id: string) => this.values.delete(id))
}

class MemoryCredentials {
  readonly values = new Map<string, ExternalKnowledgeCredentialReadResult>()
  rotateCalls = 0

  read = vi.fn(async (reference: string) => this.values.get(reference) ?? { status: 'missing' as const })
  put = vi.fn(async (reference: string, credential: ExternalKnowledgeCredential) => {
    this.values.set(reference, { status: 'ok', credential })
  })
  rotateTokens = vi.fn(
    async (
      reference: string,
      expectedRefreshToken: string,
      tokens: ExternalKnowledgeTokenSet
    ): Promise<TokenRotationResult> => {
      this.rotateCalls++
      const current = this.values.get(reference)
      if (current?.status !== 'ok') return 'missing'
      if (current.credential.refreshToken !== expectedRefreshToken) return 'stale'
      this.values.set(reference, {
        status: 'ok',
        credential: { ...current.credential, ...tokens }
      })
      return 'updated'
    }
  )
  remove = vi.fn(async (reference: string) => {
    this.values.delete(reference)
  })
}

function createProvider(overrides: Record<string, unknown> = {}) {
  return {
    beginDeviceAuthorization: vi.fn(),
    exchangeDeviceAuthorization: vi.fn(),
    refreshUserToken: vi.fn(),
    getUserIdentity: vi.fn(),
    revokeUserToken: vi.fn(),
    ...overrides
  }
}

function validCredential(id: string, now = 1_000): ExternalKnowledgeCredential {
  return {
    appId: `cli_${id}`,
    appSecret: 'app-secret',
    accessToken: `access-${id}`,
    refreshToken: `refresh-${id}`,
    accessTokenExpiresAt: now + 3_600_000,
    refreshTokenExpiresAt: now + 604_800_000,
    grantedScopes: [...FEISHU_KNOWLEDGE_USER_SCOPES]
  }
}

describe('ExternalKnowledgeRuntime', () => {
  it('merges concurrent refreshes for one credential and persists one token rotation', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', {
      status: 'ok',
      credential: { ...validCredential('one'), accessTokenExpiresAt: 1_000 }
    })
    const refresh = deferred<FeishuUserTokenSet>()
    const provider = createProvider({ refreshUserToken: vi.fn(() => refresh.promise) })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider, now: () => 1_000 })
    await runtime.start()

    const first = runtime.acquireAccessToken(value.id)
    const second = runtime.acquireAccessToken(value.id)
    await vi.waitFor(() => expect(provider.refreshUserToken).toHaveBeenCalledOnce())
    refresh.resolve({
      accessToken: 'access-rotated',
      refreshToken: 'refresh-rotated',
      expiresIn: 7200,
      refreshTokenExpiresIn: 604800,
      grantedScopes: [...FEISHU_KNOWLEDGE_USER_SCOPES]
    })

    await expect(Promise.all([first, second])).resolves.toEqual(['access-rotated', 'access-rotated'])
    expect(credentials.rotateCalls).toBe(1)
  })

  it('does not share request admission between different credentials', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const first = connection('one', 'ref-one')
    const second = connection('two', 'ref-two')
    connections.values.set(first.id, first)
    connections.values.set(second.id, second)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    credentials.values.set('ref-two', { status: 'ok', credential: validCredential('two') })
    const runtime = new ExternalKnowledgeRuntime({
      connections,
      credentials,
      provider: createProvider(),
      now: () => 1_000
    })
    await runtime.start()
    const firstGate = deferred<string>()
    const secondGate = deferred<string>()
    const started: string[] = []

    const firstRequest = runtime.runAuthorizedRequest(first.id, async () => {
      started.push('one')
      return firstGate.promise
    })
    const secondRequest = runtime.runAuthorizedRequest(second.id, async () => {
      started.push('two')
      return secondGate.promise
    })
    await vi.waitFor(() => expect(started).toEqual(['one', 'two']))
    firstGate.resolve('first')
    secondGate.resolve('second')

    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual(['first', 'second'])
  })

  it('stops admission and aborts an in-flight provider request', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    const runtime = new ExternalKnowledgeRuntime({
      connections,
      credentials,
      provider: createProvider(),
      now: () => 1_000
    })
    await runtime.start()
    let observedSignal: AbortSignal | undefined
    const request = runtime.runAuthorizedRequest(value.id, (_token, signal) => {
      observedSignal = signal
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })
    })
    await vi.waitFor(() => expect(observedSignal).toBeDefined())

    const stopping = runtime.stop()

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    await stopping
    expect(observedSignal?.aborted).toBe(true)
    await expect(runtime.acquireAccessToken(value.id)).rejects.toMatchObject({ code: 'stopped' })
  })

  it('marks missing, mismatched, corrupt and undecryptable credentials before network admission', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const missing = connection('missing', 'ref-missing')
    const mismatch = connection('mismatch', 'ref-mismatch')
    const undecryptable = connection('undecryptable', 'ref-undecryptable')
    const corrupt = connection('corrupt', 'ref-corrupt')
    for (const value of [missing, mismatch, corrupt, undecryptable]) connections.values.set(value.id, value)
    connections.startupList = [missing, mismatch, corrupt, undecryptable]
    credentials.values.set('ref-mismatch', {
      status: 'ok',
      credential: { ...validCredential('mismatch'), appId: 'cli_other' }
    })
    credentials.values.set('ref-undecryptable', { status: 'undecryptable' })
    credentials.values.set('ref-corrupt', { status: 'corrupt' })
    const provider = createProvider()
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider, now: () => 1_000 })

    await runtime.start()

    expect(connections.markReauthorizationRequired).toHaveBeenCalledTimes(4)
    expect(provider.refreshUserToken).not.toHaveBeenCalled()
    expect(provider.getUserIdentity).not.toHaveBeenCalled()
  })

  it('marks terminal refresh failures as requiring reauthorization', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', {
      status: 'ok',
      credential: { ...validCredential('one'), accessTokenExpiresAt: 1_000 }
    })
    const provider = createProvider({
      refreshUserToken: vi.fn(async () => {
        throw new FeishuProviderError('reauthorization-required', true)
      })
    })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider, now: () => 1_000 })
    await runtime.start()

    await expect(runtime.acquireAccessToken(value.id)).rejects.toMatchObject({ code: 'reauthorization-required' })
    expect(connections.values.get(value.id)?.authorizationStatus).toBe('reauthorization-required')
  })

  it('honors Retry-After inside one credential lane', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    const waits: number[] = []
    const runtime = new ExternalKnowledgeRuntime({
      connections,
      credentials,
      provider: createProvider(),
      now: () => 1_000,
      sleep: async (milliseconds) => void waits.push(milliseconds)
    })
    await runtime.start()
    let attempts = 0

    const result = await runtime.runAuthorizedRequest(value.id, async () => {
      attempts++
      if (attempts === 1) throw new FeishuProviderError('transient', false, 2500)
      return 'ok'
    })

    expect(result).toBe('ok')
    expect(waits).toEqual([2500])
  })

  it('cancels initial user authorization and removes its pending connection', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const exchangeStarted = deferred<void>()
    const provider = createProvider({
      beginDeviceAuthorization: vi.fn(async () => ({
        deviceCode: 'device-code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=ABCD-EFGH',
        expiresIn: 600,
        interval: 5
      })),
      exchangeDeviceAuthorization: vi.fn((_app, _code, signal: AbortSignal) => {
        exchangeStarted.resolve()
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
        })
      })
    })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider, sleep: async () => {} })
    await runtime.start()
    const begun = await runtime.beginUserAuthorization({
      kind: 'custom-app',
      appId: 'cli_manual',
      appSecret: 'app-secret',
      applicationName: 'Manual app'
    })
    const completing = runtime.completeUserAuthorization(begun.authorizationSessionId)
    await exchangeStarted.promise

    await runtime.cancelUserAuthorization(begun.authorizationSessionId)

    await expect(completing).rejects.toMatchObject({ name: 'AbortError' })
    expect(connections.getById(begun.connection.id)).toBeNull()
    await expect(credentials.read(begun.connection.credentialReference)).resolves.toEqual({ status: 'missing' })
  })

  it('does not contact Feishu when new application credentials cannot be stored securely', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    credentials.put.mockRejectedValueOnce(new Error('secure storage unavailable'))
    const provider = createProvider({ beginDeviceAuthorization: vi.fn() })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider })
    await runtime.start()

    await expect(
      runtime.beginUserAuthorization({ kind: 'custom-app', appId: 'cli_manual', appSecret: 'private-secret' })
    ).rejects.toThrow('secure storage unavailable')

    expect(provider.beginDeviceAuthorization).not.toHaveBeenCalled()
    expect(connections.create).not.toHaveBeenCalled()
  })

  it('uses actual token scopes and rejects an incomplete authorization before identity lookup', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const provider = createProvider({
      beginDeviceAuthorization: vi.fn(async () => ({
        deviceCode: 'device-code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=ABCD-EFGH',
        expiresIn: 600,
        interval: 5
      })),
      exchangeDeviceAuthorization: vi.fn(async () => ({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresIn: 7200,
        refreshTokenExpiresIn: 604800,
        grantedScopes: ['wiki:node:read']
      }))
    })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider, sleep: async () => {} })
    await runtime.start()
    const begun = await runtime.beginUserAuthorization({
      kind: 'custom-app',
      appId: 'cli_manual',
      appSecret: 'app-secret'
    })

    await expect(runtime.completeUserAuthorization(begun.authorizationSessionId)).rejects.toMatchObject({
      code: 'scope-missing'
    })
    expect(provider.getUserIdentity).not.toHaveBeenCalled()
    expect(connections.values.get(begun.connection.id)?.authorizationStatus).toBe('reauthorization-required')
  })

  it('cancels an in-flight PersonalAgent registration', async () => {
    const controllerObserved = deferred<AbortSignal>()
    const runtime = new ExternalKnowledgeRuntime({
      connections: new MemoryConnections(),
      credentials: new MemoryCredentials(),
      provider: createProvider(),
      registration: {
        begin: vi.fn(async (_domain, options) => ({
          deviceCode: 'registration-code',
          verificationUri: 'https://accounts.feishu.cn/registration',
          interval: 5,
          expiresIn: 600,
          signal: options?.signal
        })),
        poll: vi.fn((_domain, _code, options) => {
          controllerObserved.resolve(options.signal)
          return new Promise<never>((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
              once: true
            })
          })
        })
      }
    })
    await runtime.start()

    const begun = await runtime.beginAppRegistration()
    const signal = await controllerObserved.promise
    await runtime.cancelAppRegistration(begun.registrationSessionId)

    expect(signal.aborted).toBe(true)
  })

  it('feeds automatic PersonalAgent credentials into the same device authorization flow', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const provider = createProvider({
      beginDeviceAuthorization: vi.fn(async () => ({
        deviceCode: 'device-code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=ABCD-EFGH',
        expiresIn: 600,
        interval: 5
      }))
    })
    const runtime = new ExternalKnowledgeRuntime({
      connections,
      credentials,
      provider,
      registration: {
        begin: vi.fn(async () => ({
          deviceCode: 'registration-code',
          verificationUri: 'https://accounts.feishu.cn/registration',
          interval: 5,
          expiresIn: 600
        })),
        poll: vi.fn(async () => ({ appId: 'cli_automatic', appSecret: 'automatic-secret' }))
      }
    })
    await runtime.start()

    const registration = await runtime.beginAppRegistration()
    const authorization = await runtime.beginUserAuthorization({
      kind: 'personal-agent',
      registrationSessionId: registration.registrationSessionId
    })

    expect(provider.beginDeviceAuthorization).toHaveBeenCalledWith(
      { appId: 'cli_automatic', appSecret: 'automatic-secret' },
      expect.any(AbortSignal)
    )
    expect(authorization.connection).toMatchObject({
      appId: 'cli_automatic',
      appCredentialSource: 'personal-agent',
      authorizationStatus: 'pending-authorization'
    })
    await runtime.cancelUserAuthorization(authorization.authorizationSessionId)
  })

  it('accepts extra scopes for a manual app but rejects them for automatic registration', async () => {
    const token: FeishuUserTokenSet = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 7200,
      refreshTokenExpiresIn: 604800,
      grantedScopes: [...FEISHU_KNOWLEDGE_USER_SCOPES, 'drive:drive']
    }

    const manualConnections = new MemoryConnections()
    const manualCredentials = new MemoryCredentials()
    const manualProvider = createProvider({
      beginDeviceAuthorization: vi.fn(async () => ({
        deviceCode: 'device-code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=ABCD-EFGH',
        expiresIn: 600,
        interval: 5
      })),
      exchangeDeviceAuthorization: vi.fn(async () => token),
      getUserIdentity: vi.fn(async () => ({
        accountOpenId: 'ou_user',
        accountUnionId: null,
        tenantKey: 'tenant',
        displayName: 'User',
        avatarUrl: null
      }))
    })
    const manualRuntime = new ExternalKnowledgeRuntime({
      connections: manualConnections,
      credentials: manualCredentials,
      provider: manualProvider
    })
    await manualRuntime.start()
    const manual = await manualRuntime.beginUserAuthorization({
      kind: 'custom-app',
      appId: 'cli_manual',
      appSecret: 'manual-secret'
    })

    await expect(manualRuntime.completeUserAuthorization(manual.authorizationSessionId)).resolves.toMatchObject({
      authorizationStatus: 'connected',
      grantedScopes: token.grantedScopes
    })

    const automaticConnections = new MemoryConnections()
    const automaticCredentials = new MemoryCredentials()
    const automatic = connection('automatic', 'ref-automatic', { appCredentialSource: 'personal-agent' })
    automaticConnections.values.set(automatic.id, automatic)
    automaticCredentials.values.set('ref-automatic', {
      status: 'ok',
      credential: { ...validCredential('automatic'), accessTokenExpiresAt: 1_000 }
    })
    const automaticRuntime = new ExternalKnowledgeRuntime({
      connections: automaticConnections,
      credentials: automaticCredentials,
      provider: createProvider({ refreshUserToken: vi.fn(async () => token) }),
      now: () => 1_000
    })
    await automaticRuntime.start()

    await expect(automaticRuntime.acquireAccessToken(automatic.id)).rejects.toMatchObject({
      code: 'automatic-scope-mismatch'
    })
  })

  it('can finish a pending connection through validation after identity lookup transiently fails', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const provider = createProvider({
      beginDeviceAuthorization: vi.fn(async () => ({
        deviceCode: 'device-code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=ABCD-EFGH',
        expiresIn: 600,
        interval: 5
      })),
      exchangeDeviceAuthorization: vi.fn(async () => ({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresIn: 7200,
        refreshTokenExpiresIn: 604800,
        grantedScopes: [...FEISHU_KNOWLEDGE_USER_SCOPES]
      })),
      getUserIdentity: vi
        .fn()
        .mockRejectedValueOnce(new FeishuProviderError('transient', false))
        .mockResolvedValueOnce({
          accountOpenId: 'ou_user',
          accountUnionId: null,
          tenantKey: 'tenant',
          displayName: 'User',
          avatarUrl: null
        })
    })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider })
    await runtime.start()
    const begun = await runtime.beginUserAuthorization({
      kind: 'custom-app',
      appId: 'cli_manual',
      appSecret: 'manual-secret'
    })

    await expect(runtime.completeUserAuthorization(begun.authorizationSessionId)).rejects.toMatchObject({
      code: 'transient'
    })
    await expect(runtime.validateConnection(begun.connection.id)).resolves.toMatchObject({
      authorizationStatus: 'connected',
      accountOpenId: 'ou_user'
    })
  })

  it('aborts an in-flight request before removing its connection and credential', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    const provider = createProvider({ revokeUserToken: vi.fn(async () => {}) })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider, now: () => 1_000 })
    await runtime.start()
    const fallback = deferred<string>()
    let observedSignal: AbortSignal | undefined
    const request = runtime.runAuthorizedRequest(value.id, async (_token, signal) => {
      observedSignal = signal
      return await new Promise<string>((resolve, reject) => {
        void fallback.promise.then(resolve)
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })
    })
    await vi.waitFor(() => expect(observedSignal).toBeDefined())

    await runtime.removeUnreferencedConnection(value.id)
    const wasAborted = observedSignal?.aborted === true
    if (!wasAborted) fallback.resolve('finished')
    await Promise.allSettled([request])

    expect(wasAborted).toBe(true)
    expect(connections.getById(value.id)).toBeNull()
    await expect(credentials.read('ref-one')).resolves.toEqual({ status: 'missing' })
  })
})
