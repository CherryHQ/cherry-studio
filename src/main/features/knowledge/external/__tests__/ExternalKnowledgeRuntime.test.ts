import { describe, expect, it, vi } from 'vitest'

import { DataApiErrorFactory, ErrorCode } from '@shared/data/api/errors'
import type { ExternalKnowledgeConnection } from '@shared/data/types/externalKnowledgeConnection'

import type {
  ExternalKnowledgeCredential,
  ExternalKnowledgeCredentialReferenceListResult,
  ExternalKnowledgeCredentialReadResult,
  ExternalKnowledgeTokenSet,
  TokenRotationResult
} from '../ExternalKnowledgeCredentialStore'
import { ExternalKnowledgeRuntime } from '../ExternalKnowledgeRuntime'
import {
  FEISHU_REQUIRED_USER_SCOPES,
  FeishuProviderError,
  type FeishuUserIdentity,
  type FeishuUserTokenSet
} from '../feishuKnowledgeProvider'

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
    accountUserId: `user_${id}`,
    accountOpenId: `ou_${id}`,
    accountUnionId: null,
    tenantKey: `tenant_${id}`,
    displayName: id,
    avatarUrl: null,
    applicationName: null,
    grantedScopes: [...FEISHU_REQUIRED_USER_SCOPES],
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
        accountUserId: null,
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
  commitReauthorization = vi.fn((id: string, input: any) => {
    const current = this.values.get(id)
    if (!current) throw DataApiErrorFactory.notFound('ExternalKnowledgeConnection', id)
    if (
      current.credentialReference !== input.expectedCredentialReference ||
      current.authorizationStatus !== 'reauthorization-required'
    ) {
      throw DataApiErrorFactory.concurrentModification('ExternalKnowledgeConnection', id)
    }
    const value = {
      ...current,
      appId: input.appId,
      appCredentialSource: input.appCredentialSource,
      applicationName: input.applicationName,
      credentialReference: input.candidateCredentialReference,
      ...input.identity,
      authorizationStatus: 'connected' as const
    }
    this.values.set(id, value)
    return value
  })
  remove = vi.fn((id: string) => this.values.delete(id))
  assertUnreferenced = vi.fn()
  removeUnreferenced = vi.fn((id: string) => this.values.delete(id))
}

class MemoryCredentials {
  readonly values = new Map<string, ExternalKnowledgeCredentialReadResult>()
  rotateCalls = 0

  assertAvailable = vi.fn()
  listReferences = vi.fn<() => Promise<ExternalKnowledgeCredentialReferenceListResult>>(async () => ({
    status: 'ok',
    credentialReferences: []
  }))
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
    getUserIdentity: vi.fn(async (accessToken: string) => {
      const id = accessToken.replace(/^access-/, '')
      return {
        accountUserId: `user_${id}`,
        accountOpenId: `ou_${id}`,
        accountUnionId: null,
        tenantKey: `tenant_${id}`,
        displayName: id,
        avatarUrl: null
      }
    }),
    revokeUserToken: vi.fn(),
    getWikiNode: vi.fn(),
    listWikiChildNodes: vi.fn(),
    getDocxMarkdown: vi.fn(),
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
    grantedScopes: [...FEISHU_REQUIRED_USER_SCOPES]
  }
}

describe('ExternalKnowledgeRuntime', () => {
  it('rejects an untrusted scope URL before reading credentials or making a provider request', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    const provider = createProvider()
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider, now: () => 1_000 })
    await runtime.start()
    credentials.read.mockClear()

    await expect(runtime.resolveFeishuScope(value.id, 'https://acme.larksuite.com/wiki/root')).rejects.toMatchObject({
      code: 'invalid-scope-url'
    })
    expect(credentials.read).not.toHaveBeenCalled()
    expect(provider.getUserIdentity).not.toHaveBeenCalled()
    expect(provider.getWikiNode).not.toHaveBeenCalled()
  })

  it('applies the verified Wiki endpoint budget between individual page requests', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    let now = 1_000
    const waits: number[] = []
    const pageRequestTimes: number[] = []
    const provider = createProvider({
      getWikiNode: vi.fn(async () => ({
        spaceId: 'space-1',
        nodeToken: 'root',
        objToken: 'doc-root',
        objType: 'docx',
        parentNodeToken: null,
        nodeType: 'origin',
        originNodeToken: null,
        originSpaceId: null,
        title: 'Root',
        hasChild: true,
        objEditTime: '42'
      })),
      listWikiChildNodes: vi.fn(async () => {
        pageRequestTimes.push(now)
        return pageRequestTimes.length === 1 ? { nodes: [], nextPageToken: 'page-2' } : { nodes: [] }
      })
    })
    const runtime = new ExternalKnowledgeRuntime({
      connections,
      credentials,
      provider,
      now: () => now,
      sleep: async (milliseconds) => {
        waits.push(milliseconds)
        now += milliseconds
      }
    })
    await runtime.start()

    await expect(runtime.previewFeishuScope(value.id, 'https://acme.feishu.cn/wiki/root')).resolves.toMatchObject({
      visibleNodeCount: 1,
      supportedDocxCount: 1
    })
    expect(pageRequestTimes).toEqual([1_000, 1_600])
    expect(waits).toEqual([600])
  })

  it('retries only the failing provider call instead of replaying completed traversal work', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    let listAttempts = 0
    const getWikiNode = vi.fn(async () => ({
      spaceId: 'space-1',
      nodeToken: 'root',
      objToken: 'doc-root',
      objType: 'docx',
      parentNodeToken: null,
      nodeType: 'origin' as const,
      originNodeToken: null,
      originSpaceId: null,
      title: 'Root',
      hasChild: true,
      objEditTime: '42'
    }))
    const provider = createProvider({
      getWikiNode,
      listWikiChildNodes: vi.fn(async () => {
        listAttempts++
        if (listAttempts === 1) throw new FeishuProviderError('transient', false, 1)
        return { nodes: [] }
      })
    })
    const runtime = new ExternalKnowledgeRuntime({
      connections,
      credentials,
      provider,
      now: () => 1_000,
      sleep: async () => {}
    })
    await runtime.start()

    await expect(runtime.previewFeishuScope(value.id, 'https://acme.feishu.cn/wiki/root')).resolves.toMatchObject({
      visibleNodeCount: 1
    })
    expect(getWikiNode).toHaveBeenCalledOnce()
    expect(listAttempts).toBe(2)
  })

  it('does not start a retry attempt after caller cancellation during its backoff wait', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    const retryWaitStarted = deferred<void>()
    const releaseRetryWait = deferred<void>()
    const requestedSpaces: string[] = []
    const provider = createProvider({
      listWikiChildNodes: vi.fn(async (_accessToken: string, spaceId: string) => {
        requestedSpaces.push(spaceId)
        if (requestedSpaces.length === 1) throw new FeishuProviderError('transient', false, 10)
        return { nodes: [] }
      })
    })
    let now = 1_000
    let waitCount = 0
    const runtime = new ExternalKnowledgeRuntime({
      connections,
      credentials,
      provider,
      now: () => now,
      sleep: async (milliseconds) => {
        waitCount++
        if (waitCount === 1) {
          retryWaitStarted.resolve()
          await releaseRetryWait.promise
        }
        now += milliseconds
      }
    })
    await runtime.start()
    const caller = new AbortController()
    const cancelledScan = runtime.scanFeishuSource(
      value.id,
      { spaceId: 'space-retry', scope: { kind: 'space' } },
      caller.signal
    )
    const cancelledScanRejected = expect(cancelledScan).rejects.toBeInstanceOf(DOMException)
    await retryWaitStarted.promise
    const cancellation = new DOMException('cancel during retry backoff', 'AbortError')

    caller.abort(cancellation)
    const followingScan = runtime.scanFeishuSource(value.id, {
      spaceId: 'space-following',
      scope: { kind: 'space' }
    })
    releaseRetryWait.resolve()

    await cancelledScanRejected
    await expect(cancelledScan).rejects.toBe(cancellation)
    await expect(followingScan).resolves.toMatchObject({ canonicalReferences: [] })
    expect(requestedSpaces).toEqual(['space-retry', 'space-following'])
  })

  it('scans a persisted Feishu source identity through the credential-scoped read lane', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    const provider = createProvider({
      listWikiChildNodes: vi.fn(async () => ({
        nodes: [
          {
            spaceId: 'space-1',
            nodeToken: 'root',
            objToken: 'doc-root',
            objType: 'docx',
            parentNodeToken: null,
            nodeType: 'origin',
            originNodeToken: null,
            originSpaceId: null,
            title: 'Root',
            hasChild: false,
            objEditTime: '42'
          }
        ]
      }))
    })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider, now: () => 1_000 })
    await runtime.start()

    await expect(
      runtime.scanFeishuSource(value.id, { spaceId: 'space-1', scope: { kind: 'space' } })
    ).resolves.toMatchObject({
      visibleNodeCount: 1,
      unsupportedOrSkippedCount: 0,
      canonicalReferences: [{ descriptor: { nodeId: 'root', remoteObjectId: 'doc-root' } }]
    })
  })

  it('propagates the caller cancellation unchanged while scanning a persisted source', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    const page = deferred<{ nodes: [] }>()
    let observedSignal: AbortSignal | undefined
    const provider = createProvider({
      listWikiChildNodes: vi.fn(
        async (
          _accessToken: string,
          _spaceId: string,
          _parentNodeToken?: string,
          _pageToken?: string,
          signal?: AbortSignal
        ) => {
          observedSignal = signal
          return await new Promise<{ nodes: [] }>((resolve, reject) => {
            page.promise.then(resolve, reject)
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
        }
      )
    })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider, now: () => 1_000 })
    await runtime.start()
    const caller = new AbortController()
    const scan = runtime.scanFeishuSource(value.id, { spaceId: 'space-1', scope: { kind: 'space' } }, caller.signal)
    await vi.waitFor(() => expect(provider.listWikiChildNodes).toHaveBeenCalledOnce())
    const cancellation = new DOMException('job cancelled scan', 'AbortError')

    caller.abort(cancellation)
    if (!observedSignal?.aborted) page.reject(new Error('caller signal was not forwarded to scan'))

    await expect(scan).rejects.toBe(cancellation)
  })

  it('propagates the caller cancellation unchanged while reading a document', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    const body = deferred<string>()
    let observedSignal: AbortSignal | undefined
    const provider = createProvider({
      getDocxMarkdown: vi.fn(async (_accessToken: string, _documentToken: string, signal?: AbortSignal) => {
        observedSignal = signal
        return await new Promise<string>((resolve, reject) => {
          body.promise.then(resolve, reject)
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      })
    })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider, now: () => 1_000 })
    await runtime.start()
    const caller = new AbortController()
    const read = runtime.readFeishuDocument(
      value.id,
      {
        descriptor: {
          remoteObjectId: 'doc-1',
          nodeId: 'node-1',
          parentNodeId: null,
          relativeBreadcrumb: ['Document'],
          title: 'Document',
          originalUrl: 'https://feishu.cn/wiki/node-1',
          remoteRevision: '42',
          documentKind: 'document',
          supportState: 'supported'
        },
        providerData: {
          spaceId: 'space-1',
          nodeToken: 'node-1',
          objToken: 'doc-1',
          objType: 'docx',
          nodeType: 'origin',
          originNodeToken: null,
          originSpaceId: null
        }
      },
      caller.signal
    )
    await vi.waitFor(() => expect(provider.getDocxMarkdown).toHaveBeenCalledOnce())
    const cancellation = new DOMException('job cancelled read', 'AbortError')

    caller.abort(cancellation)
    if (!observedSignal?.aborted) body.reject(new Error('caller signal was not forwarded to read'))

    await expect(read).rejects.toBe(cancellation)
  })

  it('rejects a queued caller cancellation immediately without letting later reads bypass the lane', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    const firstBody = deferred<string>()
    const started: string[] = []
    let active = 0
    let maxActive = 0
    const provider = createProvider({
      getDocxMarkdown: vi.fn(async (_accessToken: string, documentToken: string) => {
        started.push(documentToken)
        active++
        maxActive = Math.max(maxActive, active)
        try {
          if (documentToken === 'doc-a') return await firstBody.promise
          return `# ${documentToken}`
        } finally {
          active--
        }
      })
    })
    const runtime = new ExternalKnowledgeRuntime({
      connections,
      credentials,
      provider,
      now: () => 1_000,
      sleep: async () => {}
    })
    await runtime.start()
    const reference = (documentToken: string) => ({
      descriptor: {
        remoteObjectId: documentToken,
        nodeId: `node-${documentToken}`,
        parentNodeId: null,
        relativeBreadcrumb: [documentToken],
        title: documentToken,
        originalUrl: `https://feishu.cn/wiki/node-${documentToken}`,
        remoteRevision: '42',
        documentKind: 'document' as const,
        supportState: 'supported' as const
      },
      providerData: {
        spaceId: 'space-1',
        nodeToken: `node-${documentToken}`,
        objToken: documentToken,
        objType: 'docx',
        nodeType: 'origin' as const,
        originNodeToken: null,
        originSpaceId: null
      }
    })

    const first = runtime.readFeishuDocument(value.id, reference('doc-a'))
    await vi.waitFor(() => expect(started).toEqual(['doc-a']))
    const caller = new AbortController()
    const second = runtime.readFeishuDocument(value.id, reference('doc-b'), caller.signal)
    let secondSettled = false
    const secondRejection = second.catch((error) => {
      secondSettled = true
      return error
    })
    const cancellation = new DOMException('queued job cancelled', 'AbortError')
    caller.abort(cancellation)
    const third = runtime.readFeishuDocument(value.id, reference('doc-c'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    const secondSettledBeforeFirstReleased = secondSettled
    const thirdStartedBeforeFirstReleased = started.includes('doc-c')

    firstBody.resolve('# doc-a')
    await expect(first).resolves.toMatchObject({ content: '# doc-a' })
    await expect(secondRejection).resolves.toBe(cancellation)
    await expect(third).resolves.toMatchObject({ content: '# doc-c' })

    expect(secondSettledBeforeFirstReleased).toBe(true)
    expect(thirdStartedBeforeFirstReleased).toBe(false)
    expect(started).toEqual(['doc-a', 'doc-c'])
    expect(maxActive).toBe(1)
  })

  it('keeps resource ACL failures local while terminal authentication still requires reauthorization', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const aclConnection = connection('acl', 'ref-acl')
    const authConnection = connection('auth', 'ref-auth')
    connections.values.set(aclConnection.id, aclConnection)
    connections.values.set(authConnection.id, authConnection)
    credentials.values.set('ref-acl', { status: 'ok', credential: validCredential('acl') })
    credentials.values.set('ref-auth', { status: 'ok', credential: validCredential('auth') })
    const provider = createProvider({
      getWikiNode: vi
        .fn()
        .mockRejectedValueOnce(new FeishuProviderError('resource-permission-denied', false))
        .mockRejectedValueOnce(new FeishuProviderError('reauthorization-required', true))
    })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider, now: () => 1_000 })
    await runtime.start()

    await expect(runtime.resolveFeishuScope(aclConnection.id, 'https://acme.feishu.cn/wiki/acl')).rejects.toMatchObject(
      { code: 'resource-permission-denied' }
    )
    expect(connections.values.get(aclConnection.id)?.authorizationStatus).toBe('connected')

    await expect(
      runtime.resolveFeishuScope(authConnection.id, 'https://acme.feishu.cn/wiki/auth')
    ).rejects.toMatchObject({ code: 'reauthorization-required' })
    expect(connections.values.get(authConnection.id)?.authorizationStatus).toBe('reauthorization-required')
  })

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
      grantedScopes: [...FEISHU_REQUIRED_USER_SCOPES]
    })

    await expect(Promise.all([first, second])).resolves.toEqual(['access-rotated', 'access-rotated'])
    expect(credentials.rotateCalls).toBe(1)
  })

  it('honors Retry-After while refreshing a credential', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', {
      status: 'ok',
      credential: { ...validCredential('one'), accessTokenExpiresAt: 1_000 }
    })
    let now = 1_000
    const waits: number[] = []
    const provider = createProvider({
      refreshUserToken: vi
        .fn()
        .mockRejectedValueOnce(new FeishuProviderError('transient', false, 2_000))
        .mockResolvedValueOnce({
          accessToken: 'access-rotated',
          refreshToken: 'refresh-rotated',
          expiresIn: 7200,
          refreshTokenExpiresIn: 604800,
          grantedScopes: [...FEISHU_REQUIRED_USER_SCOPES]
        })
    })
    const runtime = new ExternalKnowledgeRuntime({
      connections,
      credentials,
      provider,
      now: () => now,
      sleep: async (milliseconds) => {
        waits.push(milliseconds)
        now += milliseconds
      }
    })
    await runtime.start()

    await expect(runtime.acquireAccessToken(value.id)).resolves.toBe('access-rotated')
    expect(provider.refreshUserToken).toHaveBeenCalledTimes(2)
    expect(waits).toEqual([2_000])
  })

  it('honors Retry-After while validating user identity', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    let now = 1_000
    const waits: number[] = []
    const provider = createProvider({
      getUserIdentity: vi
        .fn()
        .mockRejectedValueOnce(new FeishuProviderError('transient', false, 1_750))
        .mockResolvedValueOnce({
          accountUserId: value.accountUserId!,
          accountOpenId: value.accountOpenId!,
          accountUnionId: null,
          tenantKey: value.tenantKey!,
          displayName: 'Validated user',
          avatarUrl: null
        })
    })
    const runtime = new ExternalKnowledgeRuntime({
      connections,
      credentials,
      provider,
      now: () => now,
      sleep: async (milliseconds) => {
        waits.push(milliseconds)
        now += milliseconds
      }
    })
    await runtime.start()

    await expect(runtime.validateConnection(value.id)).resolves.toMatchObject({ displayName: 'Validated user' })
    expect(provider.getUserIdentity).toHaveBeenCalledTimes(2)
    expect(waits).toEqual([1_750])
  })

  it('honors Retry-After while beginning device authorization', async () => {
    const waits: number[] = []
    let now = 1_000
    const provider = createProvider({
      beginDeviceAuthorization: vi
        .fn()
        .mockRejectedValueOnce(new FeishuProviderError('transient', false, 1_250))
        .mockResolvedValueOnce({
          deviceCode: 'device-code',
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=ABCD-EFGH',
          expiresIn: 600,
          interval: 5
        })
    })
    const runtime = new ExternalKnowledgeRuntime({
      connections: new MemoryConnections(),
      credentials: new MemoryCredentials(),
      provider,
      now: () => now,
      sleep: async (milliseconds) => {
        waits.push(milliseconds)
        now += milliseconds
      }
    })
    await runtime.start()

    await expect(
      runtime.beginUserAuthorization({ kind: 'custom-app', appId: 'cli_manual', appSecret: 'app-secret' })
    ).resolves.toMatchObject({ userCode: 'ABCD-EFGH' })
    expect(provider.beginDeviceAuthorization).toHaveBeenCalledTimes(2)
    expect(waits).toEqual([1_250])
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

  it('validates one credential once before admitting its provider requests', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    const provider = createProvider()
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider, now: () => 1_000 })
    await runtime.start()

    await expect(runtime.runAuthorizedRequest(value.id, async () => 'first')).resolves.toBe('first')
    await expect(runtime.runAuthorizedRequest(value.id, async () => 'second')).resolves.toBe('second')

    expect(provider.getUserIdentity).toHaveBeenCalledOnce()
    expect(connections.markValidated).toHaveBeenCalledOnce()
  })

  it('performs a fresh identity request for explicit validation after cached admission', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    const provider = createProvider()
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider, now: () => 1_000 })
    await runtime.start()

    await runtime.runAuthorizedRequest(value.id, async () => 'admitted')
    await runtime.validateConnection(value.id)

    expect(provider.getUserIdentity).toHaveBeenCalledTimes(2)
    expect(connections.markValidated).toHaveBeenCalledTimes(2)
  })

  it('coalesces concurrent explicit validations after invalidating the cache', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    const freshIdentity = deferred<FeishuUserIdentity>()
    const identity = {
      accountUserId: value.accountUserId!,
      accountOpenId: value.accountOpenId!,
      accountUnionId: null,
      tenantKey: value.tenantKey!,
      displayName: 'Validated user',
      avatarUrl: null
    }
    const provider = createProvider({
      getUserIdentity: vi
        .fn()
        .mockResolvedValueOnce(identity)
        .mockImplementationOnce(() => freshIdentity.promise)
    })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider, now: () => 1_000 })
    await runtime.start()
    await runtime.runAuthorizedRequest(value.id, async () => 'admitted')

    const first = runtime.validateConnection(value.id)
    const second = runtime.validateConnection(value.id)
    await vi.waitFor(() => expect(provider.getUserIdentity).toHaveBeenCalledTimes(2))
    freshIdentity.resolve(identity)

    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(provider.getUserIdentity).toHaveBeenCalledTimes(2)
  })

  it('marks terminal identity validation failures as requiring reauthorization before provider admission', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    const operation = vi.fn(async () => 'should-not-run')
    const runtime = new ExternalKnowledgeRuntime({
      connections,
      credentials,
      provider: createProvider({
        getUserIdentity: vi.fn(async () => {
          throw new FeishuProviderError('identity-unverifiable', true)
        })
      }),
      now: () => 1_000
    })
    await runtime.start()

    await expect(runtime.runAuthorizedRequest(value.id, operation)).rejects.toMatchObject({
      code: 'identity-unverifiable'
    })
    expect(connections.values.get(value.id)?.authorizationStatus).toBe('reauthorization-required')
    expect(operation).not.toHaveBeenCalled()
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

  it('does not persist an initial credential when shutdown interrupts device authorization setup', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const beginStarted = deferred<void>()
    const provider = createProvider({
      beginDeviceAuthorization: vi.fn((_credentials, signal: AbortSignal) => {
        beginStarted.resolve()
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
        })
      })
    })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider })
    await runtime.start()
    const beginning = runtime
      .beginUserAuthorization({ kind: 'custom-app', appId: 'cli_manual', appSecret: 'app-secret' })
      .catch((error) => error)
    await beginStarted.promise

    const stopping = runtime.stop()

    await expect(beginning).resolves.toMatchObject({ name: 'AbortError' })
    await stopping
    expect(credentials.values.size).toBe(0)
    expect(credentials.put).not.toHaveBeenCalled()
    expect(connections.create).not.toHaveBeenCalled()
    expect(provider.beginDeviceAuthorization).toHaveBeenCalledOnce()
  })

  it('does not resume reconnect admission after shutdown completes during credential loading', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    const readStarted = deferred<void>()
    const finishRead = deferred<void>()
    credentials.read.mockImplementation(async (reference: string) => {
      readStarted.resolve()
      await finishRead.promise
      return credentials.values.get(reference) ?? { status: 'missing' as const }
    })
    const provider = createProvider({
      beginDeviceAuthorization: vi.fn(async () => ({
        deviceCode: 'device-code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=ABCD-EFGH',
        expiresIn: 600,
        interval: 5
      }))
    })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider })
    await runtime.start()
    const reconnecting = runtime.beginReconnect(value.id).catch((error) => error)
    await readStarted.promise

    await runtime.stop()
    finishRead.resolve()

    await expect(reconnecting).resolves.toMatchObject({ name: 'AbortError' })
    expect(provider.beginDeviceAuthorization).not.toHaveBeenCalled()
    expect(connections.values.get(value.id)?.authorizationStatus).toBe('connected')
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

  it('propagates startup credential failures after the durable connection transition', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    connections.startupList = [value]
    const provider = createProvider()
    const onReauthorizationRequired = vi.fn((connectionId: string) => {
      expect(connections.values.get(connectionId)?.authorizationStatus).toBe('reauthorization-required')
      expect(provider.refreshUserToken).not.toHaveBeenCalled()
      expect(provider.getUserIdentity).not.toHaveBeenCalled()
    })
    const runtime = new ExternalKnowledgeRuntime({
      connections,
      credentials,
      provider,
      hooks: { onReauthorizationRequired }
    })

    await runtime.start()

    expect(onReauthorizationRequired).toHaveBeenCalledOnce()
    expect(onReauthorizationRequired).toHaveBeenCalledWith(value.id)
  })

  it('does not contact Feishu while reconciling a locally valid connection at startup', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    connections.startupList = [value]
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    const provider = createProvider()
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider, now: () => 1_000 })

    await runtime.start()

    expect(provider.refreshUserToken).not.toHaveBeenCalled()
    expect(provider.getUserIdentity).not.toHaveBeenCalled()
    expect(connections.values.get(value.id)?.authorizationStatus).toBe('connected')
  })

  it('keeps admission closed and shares startup reconciliation until it finishes', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    connections.startupList = [value]
    const credentialRead = deferred<ExternalKnowledgeCredentialReadResult>()
    credentials.read.mockImplementationOnce(() => credentialRead.promise)
    const provider = createProvider({
      beginDeviceAuthorization: vi.fn(async () => ({
        deviceCode: 'device-code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=ABCD-EFGH',
        expiresIn: 600,
        interval: 5
      }))
    })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider, now: () => 1_000 })
    let firstSettled = false
    let secondSettled = false

    const first = runtime.start().then(() => {
      firstSettled = true
    })
    const second = runtime.start().then(() => {
      secondSettled = true
    })
    await vi.waitFor(() => expect(credentials.read).toHaveBeenCalledOnce())
    const admission = runtime
      .beginUserAuthorization({ kind: 'custom-app', appId: 'cli_manual', appSecret: 'app-secret' })
      .catch((error) => error)
    await Promise.resolve()

    expect(firstSettled).toBe(false)
    expect(secondSettled).toBe(false)
    expect(provider.beginDeviceAuthorization).not.toHaveBeenCalled()
    credentialRead.resolve({ status: 'ok', credential: validCredential('one') })

    await expect(admission).resolves.toMatchObject({ code: 'stopped' })
    await Promise.all([first, second])
    expect(credentials.read).toHaveBeenCalledOnce()
  })

  it('waits for startup reconciliation to settle while stopping', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    connections.startupList = [value]
    const credentialRead = deferred<ExternalKnowledgeCredentialReadResult>()
    credentials.read.mockImplementationOnce(() => credentialRead.promise)
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider: createProvider() })
    const starting = runtime.start()
    await vi.waitFor(() => expect(credentials.read).toHaveBeenCalledOnce())
    let stopSettled = false

    const stopping = runtime.stop().then(() => {
      stopSettled = true
    })
    for (let index = 0; index < 5; index++) await Promise.resolve()

    expect(stopSettled).toBe(false)
    credentialRead.resolve({ status: 'ok', credential: validCredential('one') })
    await Promise.all([starting, stopping])
    await expect(runtime.acquireAccessToken(value.id)).rejects.toMatchObject({ code: 'stopped' })
  })

  it('removes an orphaned candidate credential during startup reconciliation', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    connections.startupList = [value]
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    credentials.values.set('ref-candidate', { status: 'ok', credential: validCredential('candidate') })
    credentials.listReferences.mockResolvedValueOnce({
      status: 'ok',
      credentialReferences: ['ref-one', 'ref-candidate']
    })
    const runtime = new ExternalKnowledgeRuntime({
      connections,
      credentials,
      provider: createProvider(),
      now: () => 1_000
    })

    await runtime.start()

    expect(credentials.remove).toHaveBeenCalledWith('ref-candidate')
    await expect(credentials.read('ref-one')).resolves.toMatchObject({ status: 'ok' })
    await expect(credentials.read('ref-candidate')).resolves.toEqual({ status: 'missing' })
  })

  it('keeps the referenced candidate and removes the old credential after a post-CAS crash', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-candidate')
    connections.values.set(value.id, value)
    connections.startupList = [value]
    credentials.values.set('ref-candidate', { status: 'ok', credential: validCredential('one') })
    credentials.values.set('ref-old', { status: 'ok', credential: validCredential('one') })
    credentials.listReferences.mockResolvedValueOnce({
      status: 'ok',
      credentialReferences: ['ref-candidate', 'ref-old']
    })
    const runtime = new ExternalKnowledgeRuntime({
      connections,
      credentials,
      provider: createProvider(),
      now: () => 1_000
    })

    await runtime.start()

    expect(credentials.remove).toHaveBeenCalledWith('ref-old')
    await expect(credentials.read('ref-candidate')).resolves.toMatchObject({ status: 'ok' })
    await expect(credentials.read('ref-old')).resolves.toEqual({ status: 'missing' })
  })

  it('preserves a pending initial connection without credentials and marks it for reauthorization', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-candidate', {
      authorizationStatus: 'pending-authorization',
      accountUserId: null,
      accountOpenId: null,
      accountUnionId: null,
      tenantKey: null,
      grantedScopes: [],
      authorizedAt: null,
      lastValidatedAt: null
    })
    connections.values.set(value.id, value)
    connections.startupList = [value]
    const runtime = new ExternalKnowledgeRuntime({
      connections,
      credentials,
      provider: createProvider(),
      now: () => 1_000
    })

    await runtime.start()

    expect(connections.values.get(value.id)?.authorizationStatus).toBe('reauthorization-required')
    expect(connections.remove).not.toHaveBeenCalled()
  })

  it.each(['corrupt', 'undecryptable'] as const)(
    'does not prune credentials when reference enumeration is %s',
    async (status) => {
      const connections = new MemoryConnections()
      const credentials = new MemoryCredentials()
      const value = connection('one', 'ref-one')
      connections.values.set(value.id, value)
      connections.startupList = [value]
      credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
      credentials.values.set('ref-orphan', { status: 'ok', credential: validCredential('orphan') })
      credentials.listReferences.mockResolvedValueOnce({ status })
      const runtime = new ExternalKnowledgeRuntime({
        connections,
        credentials,
        provider: createProvider(),
        now: () => 1_000
      })

      await runtime.start()

      expect(credentials.remove).not.toHaveBeenCalled()
      await expect(credentials.read('ref-orphan')).resolves.toMatchObject({ status: 'ok' })
    }
  )

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

  it('propagates a terminal refresh failure before admitting another provider request', async () => {
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
    const onReauthorizationRequired = vi.fn((connectionId: string) => {
      expect(connections.values.get(connectionId)?.authorizationStatus).toBe('reauthorization-required')
    })
    const runtime = new ExternalKnowledgeRuntime({
      connections,
      credentials,
      provider,
      now: () => 1_000,
      hooks: { onReauthorizationRequired }
    })
    await runtime.start()

    await expect(runtime.acquireAccessToken(value.id)).rejects.toMatchObject({ code: 'reauthorization-required' })
    await expect(runtime.runAuthorizedRequest(value.id, async () => 'should-not-run')).rejects.toMatchObject({
      code: 'reauthorization-required'
    })

    expect(onReauthorizationRequired).toHaveBeenCalledOnce()
    expect(provider.refreshUserToken).toHaveBeenCalledOnce()
    expect(provider.getUserIdentity).not.toHaveBeenCalled()
  })

  it('does not let a stale terminal refresh invalidate a successfully reauthorized connection', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', {
      status: 'ok',
      credential: { ...validCredential('one'), accessTokenExpiresAt: 1_000 }
    })
    const refresh = deferred<FeishuUserTokenSet>()
    const provider = createProvider({
      refreshUserToken: vi.fn(() => refresh.promise),
      beginDeviceAuthorization: vi.fn(async () => ({
        deviceCode: 'device-code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=ABCD-EFGH',
        expiresIn: 600,
        interval: 5
      })),
      exchangeDeviceAuthorization: vi.fn(async () => ({
        accessToken: 'fresh-access',
        refreshToken: 'fresh-refresh',
        expiresIn: 7200,
        refreshTokenExpiresIn: 604800,
        grantedScopes: [...FEISHU_REQUIRED_USER_SCOPES]
      })),
      getUserIdentity: vi.fn(async () => ({
        accountUserId: value.accountUserId!,
        accountOpenId: value.accountOpenId!,
        accountUnionId: null,
        tenantKey: value.tenantKey!,
        displayName: 'Reauthorized user',
        avatarUrl: null
      }))
    })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider, now: () => 1_000 })
    await runtime.start()
    const staleRefresh = runtime.acquireAccessToken(value.id).catch((error) => error)
    await vi.waitFor(() => expect(provider.refreshUserToken).toHaveBeenCalledOnce())

    const reconnect = await runtime.beginReconnect(value.id)
    const reauthorized = await runtime.completeUserAuthorization(reconnect.authorizationSessionId)
    expect(reauthorized).toMatchObject({ authorizationStatus: 'connected' })
    refresh.reject(new FeishuProviderError('reauthorization-required', true))
    await staleRefresh

    expect(connections.values.get(value.id)?.authorizationStatus).toBe('connected')
    await expect(credentials.read(reauthorized.credentialReference)).resolves.toMatchObject({
      status: 'ok',
      credential: { accessToken: 'fresh-access', refreshToken: 'fresh-refresh' }
    })
    await expect(credentials.read('ref-one')).resolves.toEqual({ status: 'missing' })
  })

  it('closes provider request admission while reconnect authorization is pending', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    const provider = createProvider({
      beginDeviceAuthorization: vi.fn(async () => ({
        deviceCode: 'device-code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=ABCD-EFGH',
        expiresIn: 600,
        interval: 5
      }))
    })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider, now: () => 1_000 })
    await runtime.start()

    const begun = await runtime.beginReconnect(value.id)

    expect(begun.connection.authorizationStatus).toBe('reauthorization-required')
    await expect(runtime.acquireAccessToken(value.id)).rejects.toMatchObject({ code: 'reauthorization-required' })
  })

  it('keeps the active reference, application metadata and credential bytes unchanged while reconnect authorization is pending', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one', { authorizationStatus: 'reauthorization-required' })
    const originalCredential = validCredential('one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: originalCredential })
    const provider = createProvider({
      beginDeviceAuthorization: vi.fn(async () => ({
        deviceCode: 'device-code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=ABCD-EFGH',
        expiresIn: 600,
        interval: 5
      }))
    })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider })
    await runtime.start()

    const begun = await runtime.beginReconnect(value.id, {
      kind: 'custom-app',
      appId: 'cli_replacement',
      appSecret: 'replacement-secret',
      applicationName: 'Replacement app'
    })

    expect(credentials.assertAvailable).toHaveBeenCalledOnce()
    expect(connections.values.get(value.id)).toMatchObject({
      credentialReference: 'ref-one',
      appId: value.appId,
      appCredentialSource: value.appCredentialSource,
      applicationName: value.applicationName
    })
    await expect(credentials.read('ref-one')).resolves.toEqual({ status: 'ok', credential: originalCredential })
    await runtime.cancelUserAuthorization(begun.authorizationSessionId)
    expect(credentials.remove.mock.calls.at(-1)?.[0]).not.toBe('ref-one')
    expect([...credentials.values.keys()]).toEqual(['ref-one'])
  })

  it('reauthorizes a connection with replacement app credentials when its credential entry is missing', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one', { authorizationStatus: 'reauthorization-required' })
    connections.values.set(value.id, value)
    const provider = createProvider({
      beginDeviceAuthorization: vi.fn(async () => ({
        deviceCode: 'device-code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=ABCD-EFGH',
        expiresIn: 600,
        interval: 5
      })),
      exchangeDeviceAuthorization: vi.fn(async () => ({
        accessToken: 'restored-access',
        refreshToken: 'restored-refresh',
        expiresIn: 7200,
        refreshTokenExpiresIn: 604800,
        grantedScopes: [...FEISHU_REQUIRED_USER_SCOPES]
      })),
      getUserIdentity: vi.fn(async () => ({
        accountUserId: value.accountUserId!,
        accountOpenId: value.accountOpenId!,
        accountUnionId: null,
        tenantKey: value.tenantKey!,
        displayName: 'Restored user',
        avatarUrl: null
      }))
    })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider, now: () => 1_000 })
    await runtime.start()

    const begun = await runtime.beginReconnect(value.id, {
      kind: 'custom-app',
      appId: value.appId,
      appSecret: 'replacement-secret'
    })
    const reauthorized = await runtime.completeUserAuthorization(begun.authorizationSessionId)
    expect(reauthorized).toMatchObject({
      authorizationStatus: 'connected',
      accountUserId: value.accountUserId,
      accountOpenId: value.accountOpenId
    })
    expect(reauthorized.credentialReference).not.toBe('ref-one')

    await expect(credentials.read(reauthorized.credentialReference)).resolves.toMatchObject({
      status: 'ok',
      credential: {
        appSecret: 'replacement-secret',
        accessToken: 'restored-access',
        refreshToken: 'restored-refresh'
      }
    })
    await expect(credentials.read('ref-one')).resolves.toEqual({ status: 'missing' })
  })

  it('runs post-commit reauthorization effects after the durable transition and before credential retirement', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one', { authorizationStatus: 'reauthorization-required' })
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    const events: string[] = []
    const provider = createProvider({
      beginDeviceAuthorization: vi.fn(async () => ({
        deviceCode: 'device-code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=ABCD-EFGH',
        expiresIn: 600,
        interval: 5
      })),
      exchangeDeviceAuthorization: vi.fn(async () => ({
        accessToken: 'fresh-access',
        refreshToken: 'fresh-refresh',
        expiresIn: 7200,
        refreshTokenExpiresIn: 604800,
        grantedScopes: [...FEISHU_REQUIRED_USER_SCOPES]
      })),
      getUserIdentity: vi.fn(async () => ({
        accountUserId: value.accountUserId!,
        accountOpenId: 'ou_fresh',
        accountUnionId: null,
        tenantKey: value.tenantKey!,
        displayName: 'Fresh user',
        avatarUrl: null
      })),
      revokeUserToken: vi.fn(async () => {
        events.push('credential-retirement')
      })
    })
    const commitReauthorization = vi.fn((connectionId: string, input: any) => ({
      connection: connections.commitReauthorization(connectionId, input),
      afterCommit: () => {
        expect(connections.values.get(connectionId)).toMatchObject({
          authorizationStatus: 'connected',
          accountUserId: value.accountUserId,
          tenantKey: value.tenantKey
        })
        events.push('reauthorization-succeeded')
      }
    }))
    const runtime = new ExternalKnowledgeRuntime({
      connections,
      credentials,
      provider,
      now: () => 1_000,
      commitReauthorization
    })
    await runtime.start()

    const begun = await runtime.beginReconnect(value.id)
    await runtime.completeUserAuthorization(begun.authorizationSessionId)

    expect(commitReauthorization).toHaveBeenCalledOnce()
    expect(commitReauthorization).toHaveBeenCalledWith(value.id, expect.any(Object))
    expect(events).toEqual(['reauthorization-succeeded', 'credential-retirement'])
  })

  it('keeps the connection identity while replacing a lost PersonalAgent registration', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one', {
      appCredentialSource: 'personal-agent',
      authorizationStatus: 'reauthorization-required'
    })
    connections.values.set(value.id, value)
    const provider = createProvider({
      beginDeviceAuthorization: vi.fn(async () => ({
        deviceCode: 'device-code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=ABCD-EFGH',
        expiresIn: 600,
        interval: 5
      })),
      exchangeDeviceAuthorization: vi.fn(async () => ({
        accessToken: 'restored-access',
        refreshToken: 'restored-refresh',
        expiresIn: 7200,
        refreshTokenExpiresIn: 604800,
        grantedScopes: [...FEISHU_REQUIRED_USER_SCOPES]
      })),
      getUserIdentity: vi.fn(async () => ({
        accountUserId: value.accountUserId!,
        accountOpenId: 'ou_replacement_app',
        accountUnionId: null,
        tenantKey: value.tenantKey!,
        displayName: 'Restored user',
        avatarUrl: null
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
        poll: vi.fn(async () => ({ appId: 'cli_replacement', appSecret: 'replacement-secret' }))
      },
      now: () => 1_000
    })
    await runtime.start()

    const registration = await runtime.beginAppRegistration()
    const begun = await runtime.beginReconnect(value.id, {
      kind: 'personal-agent',
      registrationSessionId: registration.registrationSessionId
    })
    const reauthorized = await runtime.completeUserAuthorization(begun.authorizationSessionId)

    expect(reauthorized).toMatchObject({
      id: value.id,
      appId: 'cli_replacement',
      appCredentialSource: 'personal-agent',
      applicationName: 'Cherry Studio Knowledge',
      accountUserId: value.accountUserId,
      accountOpenId: 'ou_replacement_app',
      tenantKey: value.tenantKey,
      authorizationStatus: 'connected'
    })
    expect(reauthorized.credentialReference).not.toBe('ref-one')
    await expect(credentials.read(reauthorized.credentialReference)).resolves.toMatchObject({
      status: 'ok',
      credential: { appId: 'cli_replacement', appSecret: 'replacement-secret' }
    })
    await expect(credentials.read('ref-one')).resolves.toEqual({ status: 'missing' })
  })

  it.each([
    { accountUserId: 'user_other', tenantKey: 'tenant_one' },
    { accountUserId: 'user_one', tenantKey: 'tenant_other' }
  ])('rejects reconnecting when the stable identity changes: %o', async (identity) => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one', { authorizationStatus: 'reauthorization-required' })
    const originalCredential = validCredential('one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: originalCredential })
    const provider = createProvider({
      beginDeviceAuthorization: vi.fn(async () => ({
        deviceCode: 'device-code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=ABCD-EFGH',
        expiresIn: 600,
        interval: 5
      })),
      exchangeDeviceAuthorization: vi.fn(async () => ({
        accessToken: 'other-access',
        refreshToken: 'other-refresh',
        expiresIn: 7200,
        refreshTokenExpiresIn: 604800,
        grantedScopes: [...FEISHU_REQUIRED_USER_SCOPES]
      })),
      getUserIdentity: vi.fn(async () => ({
        accountUserId: identity.accountUserId,
        accountOpenId: value.accountOpenId!,
        accountUnionId: null,
        tenantKey: identity.tenantKey,
        displayName: 'Other user',
        avatarUrl: null
      }))
    })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider, now: () => 1_000 })
    await runtime.start()
    const begun = await runtime.beginReconnect(value.id)

    await expect(runtime.completeUserAuthorization(begun.authorizationSessionId)).rejects.toMatchObject({
      code: 'identity-conflict'
    })
    expect(connections.values.get(value.id)).toMatchObject({
      authorizationStatus: 'reauthorization-required',
      credentialReference: 'ref-one',
      appId: value.appId,
      appCredentialSource: value.appCredentialSource,
      applicationName: value.applicationName,
      accountUserId: value.accountUserId,
      accountOpenId: value.accountOpenId,
      tenantKey: value.tenantKey
    })
    expect([...credentials.values.keys()]).toEqual(['ref-one'])
    await expect(credentials.read('ref-one')).resolves.toEqual({ status: 'ok', credential: originalCredential })
  })

  it('reports identity-unverifiable when a reconnect has no stable persisted user id', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one', {
      authorizationStatus: 'reauthorization-required',
      accountUserId: null
    })
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    const provider = createProvider({
      beginDeviceAuthorization: vi.fn(async () => ({
        deviceCode: 'device-code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=ABCD-EFGH',
        expiresIn: 600,
        interval: 5
      })),
      exchangeDeviceAuthorization: vi.fn(async () => ({
        accessToken: 'restored-access',
        refreshToken: 'restored-refresh',
        expiresIn: 7200,
        refreshTokenExpiresIn: 604800,
        grantedScopes: [...FEISHU_REQUIRED_USER_SCOPES]
      })),
      getUserIdentity: vi.fn(async () => ({
        accountUserId: 'user_one',
        accountOpenId: 'ou_replacement_app',
        accountUnionId: null,
        tenantKey: value.tenantKey!,
        displayName: 'Restored user',
        avatarUrl: null
      }))
    })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider, now: () => 1_000 })
    await runtime.start()
    const begun = await runtime.beginReconnect(value.id)

    await expect(runtime.completeUserAuthorization(begun.authorizationSessionId)).rejects.toMatchObject({
      code: 'identity-unverifiable'
    })
  })

  it('removes the candidate and preserves the old credential when the reauthorization CAS is stale', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one', { authorizationStatus: 'reauthorization-required' })
    const originalCredential = validCredential('one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: originalCredential })
    connections.commitReauthorization.mockImplementationOnce(() => {
      throw DataApiErrorFactory.concurrentModification('ExternalKnowledgeConnection', value.id)
    })
    const provider = createProvider({
      beginDeviceAuthorization: vi.fn(async () => ({
        deviceCode: 'device-code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=ABCD-EFGH',
        expiresIn: 600,
        interval: 5
      })),
      exchangeDeviceAuthorization: vi.fn(async () => ({
        accessToken: 'candidate-access',
        refreshToken: 'candidate-refresh',
        expiresIn: 7200,
        refreshTokenExpiresIn: 604800,
        grantedScopes: [...FEISHU_REQUIRED_USER_SCOPES]
      })),
      getUserIdentity: vi.fn(async () => ({
        accountUserId: value.accountUserId!,
        accountOpenId: 'ou_replacement_app',
        accountUnionId: null,
        tenantKey: value.tenantKey!,
        displayName: 'Candidate user',
        avatarUrl: null
      }))
    })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider })
    await runtime.start()
    const begun = await runtime.beginReconnect(value.id, {
      kind: 'custom-app',
      appId: 'cli_candidate',
      appSecret: 'candidate-secret'
    })

    await expect(runtime.completeUserAuthorization(begun.authorizationSessionId)).rejects.toMatchObject({
      code: ErrorCode.CONCURRENT_MODIFICATION
    })
    expect([...credentials.values.keys()]).toEqual(['ref-one'])
    await expect(credentials.read('ref-one')).resolves.toEqual({ status: 'ok', credential: originalCredential })
    expect(connections.values.get(value.id)).toEqual(value)
  })

  it('preserves the old credential and application metadata on a terminal reconnect failure', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one', { authorizationStatus: 'reauthorization-required' })
    const originalCredential = validCredential('one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: originalCredential })
    const runtime = new ExternalKnowledgeRuntime({
      connections,
      credentials,
      provider: createProvider({
        beginDeviceAuthorization: vi.fn(async () => ({
          deviceCode: 'device-code',
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=ABCD-EFGH',
          expiresIn: 600,
          interval: 5
        })),
        exchangeDeviceAuthorization: vi.fn(async () => {
          throw new FeishuProviderError('authorization-denied', true)
        })
      })
    })
    await runtime.start()
    const begun = await runtime.beginReconnect(value.id, {
      kind: 'custom-app',
      appId: 'cli_candidate',
      appSecret: 'candidate-secret'
    })

    await expect(runtime.completeUserAuthorization(begun.authorizationSessionId)).rejects.toMatchObject({
      code: 'authorization-failed'
    })
    expect([...credentials.values.keys()]).toEqual(['ref-one'])
    await expect(credentials.read('ref-one')).resolves.toEqual({ status: 'ok', credential: originalCredential })
    expect(connections.values.get(value.id)).toEqual(value)
  })

  it('does not let stale validation overwrite metadata from a newer authorization', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one', { displayName: 'Original user' })
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    const staleIdentity = deferred<{
      accountUserId: string
      accountOpenId: string
      accountUnionId: null
      tenantKey: string
      displayName: string
      avatarUrl: null
    }>()
    const provider = createProvider({
      beginDeviceAuthorization: vi.fn(async () => ({
        deviceCode: 'device-code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=ABCD-EFGH',
        expiresIn: 600,
        interval: 5
      })),
      exchangeDeviceAuthorization: vi.fn(async () => ({
        accessToken: 'fresh-access',
        refreshToken: 'fresh-refresh',
        expiresIn: 7200,
        refreshTokenExpiresIn: 604800,
        grantedScopes: [...FEISHU_REQUIRED_USER_SCOPES]
      })),
      getUserIdentity: vi
        .fn()
        .mockImplementationOnce(() => staleIdentity.promise)
        .mockResolvedValueOnce({
          accountUserId: value.accountUserId!,
          accountOpenId: value.accountOpenId!,
          accountUnionId: null,
          tenantKey: value.tenantKey!,
          displayName: 'New user',
          avatarUrl: null
        })
    })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider, now: () => 1_000 })
    await runtime.start()
    const validation = runtime.validateConnection(value.id)
    const validationRejected = expect(validation).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(provider.getUserIdentity).toHaveBeenCalledOnce())

    const reconnect = await runtime.beginReconnect(value.id)
    await runtime.completeUserAuthorization(reconnect.authorizationSessionId)
    staleIdentity.resolve({
      accountUserId: value.accountUserId!,
      accountOpenId: value.accountOpenId!,
      accountUnionId: null,
      tenantKey: value.tenantKey!,
      displayName: 'Stale user',
      avatarUrl: null
    })

    await validationRejected
    expect(connections.values.get(value.id)?.displayName).toBe('New user')
  })

  it('does not let a stale credential read invalidate replacement app authorization', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    const staleRead = deferred<ExternalKnowledgeCredentialReadResult>()
    let readCount = 0
    credentials.read.mockImplementation(async (reference: string) => {
      readCount++
      if (readCount === 2) return await staleRead.promise
      return credentials.values.get(reference) ?? { status: 'missing' as const }
    })
    const provider = createProvider({
      beginDeviceAuthorization: vi.fn(async () => ({
        deviceCode: 'device-code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=ABCD-EFGH',
        expiresIn: 600,
        interval: 5
      })),
      exchangeDeviceAuthorization: vi.fn(async () => ({
        accessToken: 'replacement-access',
        refreshToken: 'replacement-refresh',
        expiresIn: 7200,
        refreshTokenExpiresIn: 604800,
        grantedScopes: [...FEISHU_REQUIRED_USER_SCOPES]
      })),
      getUserIdentity: vi.fn(async () => ({
        accountUserId: value.accountUserId!,
        accountOpenId: value.accountOpenId!,
        accountUnionId: null,
        tenantKey: value.tenantKey!,
        displayName: 'Current user',
        avatarUrl: null
      }))
    })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider, now: () => 1_000 })
    await runtime.start()
    const validation = runtime.validateConnection(value.id).catch((error) => error)
    await vi.waitFor(() => expect(credentials.read).toHaveBeenCalledTimes(2))

    const reconnect = await runtime.beginReconnect(value.id, {
      kind: 'custom-app',
      appId: 'cli_replacement',
      appSecret: 'replacement-secret'
    })
    await runtime.completeUserAuthorization(reconnect.authorizationSessionId)
    staleRead.resolve(credentials.values.get('ref-one')!)

    await expect(validation).resolves.toMatchObject({ name: 'AbortError' })
    expect(connections.values.get(value.id)).toMatchObject({
      appId: 'cli_replacement',
      authorizationStatus: 'connected'
    })
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

  it('carries a final Retry-After into the next request for the same credential', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    let now = 1_000
    const waits: number[] = []
    const runtime = new ExternalKnowledgeRuntime({
      connections,
      credentials,
      provider: createProvider(),
      now: () => now,
      sleep: async (milliseconds) => {
        waits.push(milliseconds)
        now += milliseconds
      }
    })
    await runtime.start()

    await expect(
      runtime.runAuthorizedRequest(value.id, async () => {
        throw new FeishuProviderError('transient', false, 2500)
      })
    ).rejects.toMatchObject({ code: 'transient' })
    await expect(runtime.runAuthorizedRequest(value.id, async () => 'ok')).resolves.toBe('ok')

    expect(waits).toEqual([2500, 2500, 2500])
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

  it('prevents a cancelled reconnect from committing a late provider response', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    const exchange = deferred<FeishuUserTokenSet>()
    const provider = createProvider({
      beginDeviceAuthorization: vi.fn(async () => ({
        deviceCode: 'device-code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=ABCD-EFGH',
        expiresIn: 600,
        interval: 5
      })),
      exchangeDeviceAuthorization: vi.fn(() => exchange.promise),
      getUserIdentity: vi.fn(async () => ({
        accountUserId: value.accountUserId!,
        accountOpenId: value.accountOpenId!,
        accountUnionId: null,
        tenantKey: value.tenantKey!,
        displayName: 'Late user',
        avatarUrl: null
      }))
    })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider, now: () => 1_000 })
    await runtime.start()
    const begun = await runtime.beginReconnect(value.id)
    const completion = runtime.completeUserAuthorization(begun.authorizationSessionId)
    const completionRejected = expect(completion).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(provider.exchangeDeviceAuthorization).toHaveBeenCalledOnce())

    const cancelling = runtime.cancelUserAuthorization(begun.authorizationSessionId)
    exchange.resolve({
      accessToken: 'late-access',
      refreshToken: 'late-refresh',
      expiresIn: 7200,
      refreshTokenExpiresIn: 604800,
      grantedScopes: [...FEISHU_REQUIRED_USER_SCOPES]
    })

    await cancelling
    await completionRejected
    expect(provider.getUserIdentity).not.toHaveBeenCalled()
    await expect(credentials.read('ref-one')).resolves.toMatchObject({
      status: 'ok',
      credential: { accessToken: 'access-one', refreshToken: 'refresh-one' }
    })
  })

  it('does not contact Feishu when new application credentials cannot be stored securely', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    credentials.assertAvailable.mockImplementationOnce(() => {
      throw new Error('secure storage unavailable')
    })
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

  it('expires an abandoned PersonalAgent registration at the protocol deadline', async () => {
    vi.useFakeTimers()
    const controllerObserved = deferred<AbortSignal>()
    const runtime = new ExternalKnowledgeRuntime({
      connections: new MemoryConnections(),
      credentials: new MemoryCredentials(),
      provider: createProvider(),
      registration: {
        begin: vi.fn(async () => ({
          deviceCode: 'registration-code',
          verificationUri: 'https://accounts.feishu.cn/registration',
          interval: 5,
          expiresIn: 600
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

    try {
      await runtime.start()
      const begun = await runtime.beginAppRegistration()
      const signal = await controllerObserved.promise

      await vi.advanceTimersByTimeAsync(600_000)

      expect(signal.aborted).toBe(true)
      await expect(
        runtime.beginUserAuthorization({
          kind: 'personal-agent',
          registrationSessionId: begun.registrationSessionId
        })
      ).rejects.toMatchObject({ code: 'session-not-found' })
    } finally {
      await runtime.stop()
      vi.useRealTimers()
    }
  })

  it('expires an abandoned user authorization and removes its pending connection', async () => {
    vi.useFakeTimers()
    const connections = new MemoryConnections()
    const authorizationSignal = deferred<AbortSignal>()
    const runtime = new ExternalKnowledgeRuntime({
      connections,
      credentials: new MemoryCredentials(),
      provider: createProvider({
        beginDeviceAuthorization: vi.fn(async (_credentials, signal) => {
          authorizationSignal.resolve(signal)
          return {
            deviceCode: 'device-code',
            userCode: 'ABCD-EFGH',
            verificationUri: 'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=ABCD-EFGH',
            expiresIn: 600,
            interval: 5
          }
        })
      })
    })

    try {
      await runtime.start()
      const begun = await runtime.beginUserAuthorization({
        kind: 'custom-app',
        appId: 'cli_manual',
        appSecret: 'app-secret'
      })
      const signal = await authorizationSignal.promise

      await vi.advanceTimersByTimeAsync(600_000)
      await Promise.resolve()

      expect(signal.aborted).toBe(true)
      await expect(runtime.completeUserAuthorization(begun.authorizationSessionId)).rejects.toMatchObject({
        code: 'session-not-found'
      })
      expect(connections.values.has(begun.connection.id)).toBe(false)
    } finally {
      await runtime.stop()
      vi.useRealTimers()
    }
  })

  it('allows only one consumer to claim a PersonalAgent registration session', async () => {
    const registrationResult = deferred<{ appId: string; appSecret: string }>()
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
      connections: new MemoryConnections(),
      credentials: new MemoryCredentials(),
      provider,
      registration: {
        begin: vi.fn(async () => ({
          deviceCode: 'registration-code',
          verificationUri: 'https://accounts.feishu.cn/registration',
          interval: 5,
          expiresIn: 600
        })),
        poll: vi.fn(() => registrationResult.promise)
      }
    })
    await runtime.start()
    const registration = await runtime.beginAppRegistration()

    const first = runtime.beginUserAuthorization({
      kind: 'personal-agent',
      registrationSessionId: registration.registrationSessionId
    })
    const second = runtime
      .beginUserAuthorization({
        kind: 'personal-agent',
        registrationSessionId: registration.registrationSessionId
      })
      .catch((error) => error)
    registrationResult.resolve({ appId: 'cli_automatic', appSecret: 'automatic-secret' })

    await expect(second).resolves.toMatchObject({ code: 'session-not-found' })
    const authorization = await first
    expect(provider.beginDeviceAuthorization).toHaveBeenCalledOnce()
    await runtime.cancelUserAuthorization(authorization.authorizationSessionId)
  })

  it('can cancel a PersonalAgent registration after its session is claimed', async () => {
    const runtime = new ExternalKnowledgeRuntime({
      connections: new MemoryConnections(),
      credentials: new MemoryCredentials(),
      provider: createProvider(),
      registration: {
        begin: vi.fn(async () => ({
          deviceCode: 'registration-code',
          verificationUri: 'https://accounts.feishu.cn/registration',
          interval: 5,
          expiresIn: 600
        })),
        poll: vi.fn((_domain, _code, options) => {
          return new Promise<never>((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
              once: true
            })
          })
        })
      }
    })
    await runtime.start()
    const registration = await runtime.beginAppRegistration()
    const authorization = runtime
      .beginUserAuthorization({
        kind: 'personal-agent',
        registrationSessionId: registration.registrationSessionId
      })
      .catch((error) => error)

    await runtime.cancelAppRegistration(registration.registrationSessionId)

    await expect(authorization).resolves.toMatchObject({ code: 'authorization-failed' })
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
    expect(JSON.stringify(authorization)).not.toContain('automatic-secret')
    await runtime.cancelUserAuthorization(authorization.authorizationSessionId)
  })

  it('accepts extra scopes for a manual app but rejects them for automatic registration', async () => {
    const token: FeishuUserTokenSet = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 7200,
      refreshTokenExpiresIn: 604800,
      grantedScopes: [...FEISHU_REQUIRED_USER_SCOPES, 'drive:drive']
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
        accountUserId: 'user_account',
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

  it('does not persist an initial candidate when identity lookup transiently fails', async () => {
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
        grantedScopes: [...FEISHU_REQUIRED_USER_SCOPES]
      })),
      getUserIdentity: vi.fn().mockRejectedValue(new FeishuProviderError('transient', false))
    })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider, sleep: async () => {} })
    await runtime.start()
    const begun = await runtime.beginUserAuthorization({
      kind: 'custom-app',
      appId: 'cli_manual',
      appSecret: 'manual-secret'
    })

    await expect(runtime.completeUserAuthorization(begun.authorizationSessionId)).rejects.toMatchObject({
      code: 'transient'
    })
    await expect(credentials.read(begun.connection.credentialReference)).resolves.toEqual({ status: 'missing' })
    expect(connections.values.get(begun.connection.id)?.authorizationStatus).toBe('pending-authorization')
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
    expect(connections.removeUnreferenced).toHaveBeenCalledWith(value.id)
    await expect(credentials.read('ref-one')).resolves.toEqual({ status: 'missing' })
  })

  it('restores credential admission when durable removal rejects a referenced connection', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    connections.removeUnreferenced.mockImplementationOnce(() => {
      throw DataApiErrorFactory.invalidOperation('remove external knowledge connection', 'connection is in use')
    })
    const provider = createProvider({ revokeUserToken: vi.fn() })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider, now: () => 1_000 })
    await runtime.start()

    await expect(runtime.removeUnreferencedConnection(value.id)).rejects.toMatchObject({ code: 'connection-in-use' })

    expect(connections.getById(value.id)).toEqual(value)
    expect(provider.revokeUserToken).not.toHaveBeenCalled()
    expect(credentials.remove).not.toHaveBeenCalled()
    await expect(runtime.acquireAccessToken(value.id)).resolves.toBe('access-one')
  })

  it('preserves an in-flight authorization session when removal admission rejects the referenced connection', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    const inUse = () => {
      throw DataApiErrorFactory.invalidOperation('remove external knowledge connection', 'connection is in use')
    }
    connections.assertUnreferenced.mockImplementation(inUse)
    connections.removeUnreferenced.mockImplementation(inUse)
    const candidateStored = deferred<string>()
    const finishCandidatePut = deferred<void>()
    credentials.put.mockImplementation(async (reference, credential) => {
      credentials.values.set(reference, { status: 'ok', credential })
      candidateStored.resolve(reference)
      await finishCandidatePut.promise
    })
    let authorizationSignal: AbortSignal | undefined
    const provider = createProvider({
      beginDeviceAuthorization: vi.fn(async () => ({
        deviceCode: 'device-code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=ABCD-EFGH',
        expiresIn: 600,
        interval: 5
      })),
      exchangeDeviceAuthorization: vi.fn(async (_credentials, _deviceCode, signal: AbortSignal) => {
        authorizationSignal = signal
        return {
          accessToken: 'candidate-access',
          refreshToken: 'candidate-refresh',
          expiresIn: 7200,
          refreshTokenExpiresIn: 604800,
          grantedScopes: [...FEISHU_REQUIRED_USER_SCOPES]
        }
      }),
      getUserIdentity: vi.fn(async () => ({
        accountUserId: value.accountUserId!,
        accountOpenId: value.accountOpenId!,
        accountUnionId: null,
        tenantKey: value.tenantKey!,
        displayName: 'Reauthorized user',
        avatarUrl: null
      }))
    })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider, now: () => 1_000 })
    await runtime.start()
    const begun = await runtime.beginReconnect(value.id)
    const completing = runtime.completeUserAuthorization(begun.authorizationSessionId)
    const candidateReference = await candidateStored.promise

    const removing = runtime.removeUnreferencedConnection(value.id).catch((error) => error)
    await new Promise<void>((resolve) => setImmediate(resolve))
    const sessionWasAborted = authorizationSignal?.aborted
    const candidateBeforeRelease = await credentials.read(candidateReference)
    const revokeCountBeforeRelease = provider.revokeUserToken.mock.calls.length
    const credentialRemoveCallsBeforeRelease = credentials.remove.mock.calls.length
    finishCandidatePut.resolve()
    const [removalError, reauthorized] = await Promise.all([removing, completing.catch((error) => error)])

    expect(removalError).toMatchObject({ code: 'connection-in-use' })
    expect(sessionWasAborted).toBe(false)
    expect(candidateBeforeRelease).toMatchObject({ status: 'ok' })
    expect(revokeCountBeforeRelease).toBe(0)
    expect(credentialRemoveCallsBeforeRelease).toBe(0)
    expect(reauthorized).toMatchObject({
      id: value.id,
      authorizationStatus: 'connected',
      credentialReference: candidateReference
    })
    expect(credentials.remove).not.toHaveBeenCalledWith(candidateReference)
  })

  it('keeps a durably removed connection deleted when credential retirement fails', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    const events: string[] = []
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    connections.removeUnreferenced.mockImplementationOnce((id: string) => {
      events.push('connection-remove')
      return connections.values.delete(id)
    })
    const provider = createProvider({
      revokeUserToken: vi.fn(async () => {
        events.push('provider-revoke')
        throw new Error('offline')
      })
    })
    credentials.remove.mockImplementation(async () => {
      events.push('credential-remove')
      throw new Error('keychain unavailable')
    })
    const runtime = new ExternalKnowledgeRuntime({ connections, credentials, provider, now: () => 1_000 })
    await runtime.start()

    await expect(runtime.removeUnreferencedConnection(value.id)).resolves.toBeUndefined()

    expect(connections.getById(value.id)).toBeNull()
    expect(connections.removeUnreferenced).toHaveBeenCalledWith(value.id)
    expect(provider.revokeUserToken).toHaveBeenCalledOnce()
    expect(credentials.remove).toHaveBeenCalledWith('ref-one')
    expect(events).toEqual(['connection-remove', 'provider-revoke', 'credential-remove'])
    await expect(runtime.acquireAccessToken(value.id)).rejects.toMatchObject({ code: 'not-found' })
  })

  it('waits for local connection removal to finish during shutdown', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    const removeStarted = deferred<void>()
    const finishRemove = deferred<void>()
    credentials.remove.mockImplementation(async (reference: string) => {
      removeStarted.resolve()
      await finishRemove.promise
      credentials.values.delete(reference)
    })
    const runtime = new ExternalKnowledgeRuntime({
      connections,
      credentials,
      provider: createProvider({ revokeUserToken: vi.fn(async () => {}) }),
      now: () => 1_000
    })
    await runtime.start()
    const removing = runtime.removeUnreferencedConnection(value.id)
    await removeStarted.promise
    let stopped = false

    const stopping = runtime.stop().then(() => {
      stopped = true
    })
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(stopped).toBe(false)
    finishRemove.resolve()
    await Promise.all([removing, stopping])
    expect(connections.getById(value.id)).toBeNull()
  })

  it('closes credential admission before draining a connection removal', async () => {
    const connections = new MemoryConnections()
    const credentials = new MemoryCredentials()
    const value = connection('one', 'ref-one')
    connections.values.set(value.id, value)
    credentials.values.set('ref-one', { status: 'ok', credential: validCredential('one') })
    const runtime = new ExternalKnowledgeRuntime({
      connections,
      credentials,
      provider: createProvider({ revokeUserToken: vi.fn(async () => {}) }),
      now: () => 1_000
    })
    await runtime.start()
    let firstSignal: AbortSignal | undefined
    const first = runtime.runAuthorizedRequest(value.id, async (_token, signal) => {
      firstSignal = signal
      return await new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })
    })
    await vi.waitFor(() => expect(firstSignal).toBeDefined())
    const firstRejected = expect(first).rejects.toMatchObject({ name: 'AbortError' })

    const removing = runtime.removeUnreferencedConnection(value.id)
    const lateOperation = vi.fn(async () => 'unexpected')

    await expect(runtime.runAuthorizedRequest(value.id, lateOperation)).rejects.toMatchObject({ code: 'not-found' })
    await firstRejected
    await removing
    expect(lateOperation).not.toHaveBeenCalled()
  })
})
