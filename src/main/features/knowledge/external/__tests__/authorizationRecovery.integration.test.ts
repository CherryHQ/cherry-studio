import { randomUUID } from 'node:crypto'

import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { externalKnowledgeSourceTable } from '@data/db/schemas/externalKnowledgeSource'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { externalKnowledgeConnectionService as connections } from '@data/services/ExternalKnowledgeConnectionService'
import { setupCredentialStore } from '@main/services/credential/__tests__/credentialTestSetup'

import { ExternalKnowledgeCredentialStore } from '../ExternalKnowledgeCredentialStore'
import { ExternalKnowledgeRuntime } from '../ExternalKnowledgeRuntime'
import { ExternalKnowledgeSourceLifecycle } from '../ExternalKnowledgeSourceLifecycle'
import {
  exchangeDeviceAuthorization,
  FEISHU_REQUIRED_USER_SCOPES,
  FEISHU_SPACE_DISCOVERY_USER_SCOPE,
  FeishuProviderError,
  getDocxMarkdown,
  getWikiNode,
  listWikiChildNodes,
  refreshUserToken,
  type FeishuUserTokenSet
} from '../feishuKnowledgeProvider'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const app = { kind: 'custom-app' as const, appId: 'cli_test', appSecret: 'secret' }
const device = {
  deviceCode: 'device',
  userCode: 'code',
  verificationUri: 'https://accounts.feishu.cn/verify',
  expiresIn: 600,
  interval: 1
}
const identity = {
  accountUserId: 'user',
  accountOpenId: 'open',
  accountUnionId: null,
  tenantKey: 'tenant',
  displayName: 'User',
  avatarUrl: null
}
const token: FeishuUserTokenSet = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresIn: 7200,
  refreshTokenExpiresIn: 604800,
  grantedScopes: [...FEISHU_REQUIRED_USER_SCOPES]
}

function provider() {
  return {
    listWikiSpaces: vi.fn(),
    getWikiNode: vi.fn(),
    listWikiChildNodes: vi.fn(),
    getDocxMarkdown: vi.fn(),
    beginDeviceAuthorization: vi.fn(async () => device),
    exchangeDeviceAuthorization: vi.fn(async () => token),
    refreshUserToken: vi.fn(async () => token),
    getUserIdentity: vi.fn(async () => identity),
    revokeUserToken: vi.fn(async () => undefined)
  }
}

describe('authorization recovery ownership', () => {
  const fixture = setupCredentialStore()
  const dbh = fixture.dbh
  let credentials: ExternalKnowledgeCredentialStore
  const runtimes: ExternalKnowledgeRuntime[] = []

  beforeEach(async () => {
    credentials = new ExternalKnowledgeCredentialStore(fixture.store)
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.stop()))
    vi.restoreAllMocks()
    vi.mocked(net.fetch).mockReset()
  })

  async function start(api = provider(), now: () => number = () => 1_000) {
    const runtime = new ExternalKnowledgeRuntime({
      credentials,
      provider: api,
      now,
      sleep: async () => {}
    })
    runtimes.push(runtime)
    await runtime.start()
    return runtime
  }

  async function connected(runtime: ExternalKnowledgeRuntime) {
    const initial = await runtime.beginUserAuthorization(app)
    return runtime.completeUserAuthorization(initial.authorizationSessionId)
  }

  it('keeps replacement authorization and Sources active after a stale discovery credential read fails', async () => {
    const api = provider()
    api.exchangeDeviceAuthorization.mockResolvedValue({
      ...token,
      grantedScopes: [...FEISHU_REQUIRED_USER_SCOPES, FEISHU_SPACE_DISCOVERY_USER_SCOPE]
    })
    const lifecycle = new ExternalKnowledgeSourceLifecycle({ requestSyncForTrigger: vi.fn() })
    const runtime = new ExternalKnowledgeRuntime({
      credentials,
      provider: api,
      now: () => 1_000,
      sleep: async () => {},
      hooks: { onReauthorizationRequired: (id) => lifecycle.pauseForReauthorization(id) },
      commitReauthorization: (id, input) => lifecycle.commitReauthorization(id, input)
    })
    runtimes.push(runtime)
    await runtime.start()
    const original = await connected(runtime)
    const baseId = '11111111-1111-4111-8111-111111111111'
    dbh.db
      .insert(knowledgeBaseTable)
      .values({ id: baseId, orderKey: 'a0', name: 'Base', status: 'completed', chunkSize: 1024, chunkOverlap: 200 })
      .run()
    dbh.db
      .insert(externalKnowledgeSourceTable)
      .values({
        id: '0198f3f2-7d11-7abc-8def-123456789abc',
        baseId,
        connectionId: original.id,
        provider: 'feishu',
        tenantId: 'tenant',
        spaceId: 'space',
        scope: { kind: 'space' },
        name: 'Wiki',
        state: 'active',
        revision: 1
      })
      .run()

    const readEntered = deferred()
    const releaseRead = deferred()
    const read = credentials.read.bind(credentials)
    let holdNextRead = false
    vi.spyOn(credentials, 'read').mockImplementation(async (reference) => {
      if (holdNextRead) {
        holdNextRead = false
        readEntered.resolve()
        await releaseRead.promise
        return { status: 'missing' }
      }
      return read(reference)
    })
    api.listWikiSpaces.mockImplementationOnce(async () => {
      holdNextRead = true
      return { spaces: [], nextPageToken: 'second' }
    })
    const discovery = runtime.resolveFeishuSpace(original.id, 'space').catch((error) => error)
    await readEntered.promise
    try {
      const reconnect = await runtime.beginReconnect(original.id, app)
      const replacement = await runtime.completeUserAuthorization(reconnect.authorizationSessionId)
      const source = dbh.db.select().from(externalKnowledgeSourceTable).get()
      releaseRead.resolve()

      await expect(discovery).resolves.toMatchObject({ name: 'AbortError' })
      expect(connections.getById(original.id)).toEqual(replacement)
      expect(dbh.db.select().from(externalKnowledgeSourceTable).get()).toEqual(source)
      expect(source?.state).toBe('active')
      await expect(runtime.acquireAccessToken(original.id)).resolves.toBe('access')
      api.listWikiSpaces.mockResolvedValue({ spaces: [{ spaceId: 'space', name: 'Wiki', description: null }] })
      await expect(runtime.resolveFeishuSpace(original.id, 'space')).resolves.toEqual({
        tenantId: 'tenant',
        spaceId: 'space'
      })
    } finally {
      releaseRead.resolve()
      await discovery
    }
  })

  it('recovers Wiki preview after an HTTP 400 RPC failure without invalidating authorization', async () => {
    const api = provider()
    api.getWikiNode.mockResolvedValue({
      spaceId: 'space',
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
    })
    api.listWikiChildNodes.mockImplementation(listWikiChildNodes)
    const runtime = await start(api)
    const original = await connected(runtime)
    vi.mocked(net.fetch)
      .mockReset()
      .mockResolvedValueOnce(Response.json({ code: 131001, msg: 'rpc fail' }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ code: 0, data: { items: [], has_more: false } }))

    try {
      await expect(runtime.previewFeishuScope(original.id, 'https://acme.feishu.cn/wiki/root')).resolves.toMatchObject({
        visibleNodeCount: 1,
        supportedDocxCount: 1
      })
      expect(net.fetch).toHaveBeenCalledTimes(2)
      expect(connections.getById(original.id)).toEqual(original)
      await expect(runtime.acquireAccessToken(original.id)).resolves.toBe('access')
    } finally {
      vi.mocked(net.fetch).mockReset()
    }
  })

  it.each([400, 429])('waits for the Feishu rate-limit reset before retrying HTTP %s', async (status) => {
    let now = 1_000
    const runtime = new ExternalKnowledgeRuntime({
      credentials,
      provider: provider(),
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds
      }
    })
    runtimes.push(runtime)
    await runtime.start()
    const original = await connected(runtime)
    const availableAt = now + 52_000
    vi.mocked(net.fetch)
      .mockReset()
      .mockImplementation(async () =>
        now < availableAt
          ? Response.json({ code: 99991400 }, { status, headers: { 'x-ogw-ratelimit-reset': '52' } })
          : Response.json({ code: 0, data: { content: '# Recovered document' } })
      )
    try {
      await expect(
        runtime.runAuthorizedRequest(original.id, (accessToken, signal) =>
          getDocxMarkdown({ ...app, accessToken }, 'document', signal)
        )
      ).resolves.toBe('# Recovered document')
      expect(connections.getById(original.id)?.authorizationStatus).toBe('connected')
    } finally {
      vi.mocked(net.fetch).mockReset()
    }
  })

  it.each([
    [400, 99991668],
    [200, 99991677],
    [400, 99991677]
  ])('invalidates active authorization after HTTP %s / token error %s', async (status, code) => {
    const api = provider()
    api.getWikiNode.mockImplementation(getWikiNode)
    const runtime = await start(api)
    const original = await connected(runtime)
    vi.mocked(net.fetch)
      .mockReset()
      .mockResolvedValueOnce(Response.json({ code, msg: 'Invalid or expired user_access_token' }, { status }))

    try {
      await expect(runtime.previewFeishuScope(original.id, 'https://acme.feishu.cn/wiki/root')).rejects.toMatchObject({
        code: 'reauthorization-required'
      })
      expect(connections.getById(original.id)?.authorizationStatus).toBe('reauthorization-required')
      await expect(runtime.acquireAccessToken(original.id)).rejects.toMatchObject({ code: 'reauthorization-required' })
      await expect(runtime.previewFeishuScope(original.id, 'https://acme.feishu.cn/wiki/root')).rejects.toMatchObject({
        code: 'reauthorization-required'
      })
      await runtime.stop()
      const restarted = await start(api)
      await expect(restarted.acquireAccessToken(original.id)).rejects.toMatchObject({
        code: 'reauthorization-required'
      })
    } finally {
      vi.mocked(net.fetch).mockReset()
    }
  })

  it.each(['removed', 'replaced'])('rejects authorization if the selected application was %s', async (change) => {
    const application = await fixture.store.create({
      connector: 'feishu',
      kind: 'application',
      label: 'Existing app',
      payload: { domain: 'feishu', appId: app.appId, appSecret: app.appSecret }
    })
    const runtime = await start()
    const initial = await runtime.beginUserAuthorization({
      kind: 'saved-application',
      applicationCredentialId: application.id
    })
    if (change === 'removed') await fixture.store.remove(application.id, () => false)
    else await fixture.store.replaceApplication({ id: application.id, appSecret: 'replacement-secret' })
    await expect(runtime.completeUserAuthorization(initial.authorizationSessionId)).rejects.toMatchObject({
      code: 'conflict'
    })
    expect(connections.list()).toEqual([])
    expect(await fixture.store.listSummaries({ kind: 'user-authorization' })).toEqual([])
    expect(await fixture.store.read(application.id)).toMatchObject(
      change === 'removed'
        ? { status: 'missing' }
        : { status: 'ok', record: { payload: { appSecret: 'replacement-secret' } } }
    )
  })

  it.each([{ code: 20002 }, { error: 'invalid_client' }])(
    'persists recovery after invalid application credentials reject refresh: %j',
    async (body) => {
      let now = 1_000
      const api = provider()
      const runtime = await start(api, () => now)
      const original = await connected(runtime)
      now += token.expiresIn * 1_000
      api.refreshUserToken.mockImplementation(() => refreshUserToken(app, token.refreshToken))
      vi.mocked(net.fetch).mockResolvedValueOnce(Response.json(body, { status: 400 }))

      await expect(runtime.acquireAccessToken(original.id)).rejects.toMatchObject({ code: 'reauthorization-required' })
      expect(connections.getById(original.id)?.authorizationStatus).toBe('reauthorization-required')
      await expect(runtime.acquireAccessToken(original.id)).rejects.toMatchObject({ code: 'reauthorization-required' })
      expect(net.fetch).toHaveBeenCalledTimes(1)

      await runtime.stop()
      const restarted = await start(api, () => now)
      await expect(restarted.acquireAccessToken(original.id)).rejects.toMatchObject({
        code: 'reauthorization-required'
      })
      expect(net.fetch).toHaveBeenCalledTimes(1)
    }
  )

  it.each(['pending', 'committed'])('does not let old initial cancellation delete a %s replacement', async (stage) => {
    const api = provider()
    const runtime = await start(api)
    const initial = await runtime.beginUserAuthorization(app)
    const cleanupEntered = deferred()
    const releaseCleanup = deferred()
    const remove = credentials.remove.bind(credentials)
    vi.spyOn(credentials, 'remove').mockImplementationOnce(async (reference, release) => {
      cleanupEntered.resolve()
      await releaseCleanup.promise
      return remove(reference, release)
    })
    const cancelling = runtime.cancelUserAuthorization(initial.authorizationSessionId)
    await cleanupEntered.promise
    const replacement = await runtime.beginReconnect(initial.connection.id, app)
    if (stage === 'committed') await runtime.completeUserAuthorization(replacement.authorizationSessionId)
    releaseCleanup.resolve()
    await cancelling

    expect(connections.getById(initial.connection.id)).not.toBeNull()
    if (stage === 'pending') await runtime.completeUserAuthorization(replacement.authorizationSessionId)
    await expect(runtime.acquireAccessToken(initial.connection.id)).resolves.toBe('access')
    expect(connections.getById(initial.connection.id)?.authorizationStatus).toBe('connected')
  })

  it.each(['cancel', 'begin-failure', 'exchange-failure', 'identity-failure'])(
    'preserves working credentials after reconnect %s and restart',
    async (failure) => {
      const api = provider()
      const runtime = await start(api)
      const original = await connected(runtime)
      const bytes = await credentials.read(original.credentialReference)
      const error = new FeishuProviderError('transient', false)
      if (failure === 'begin-failure') api.beginDeviceAuthorization.mockRejectedValue(error)
      if (failure === 'exchange-failure') api.exchangeDeviceAuthorization.mockRejectedValue(error)
      if (failure === 'identity-failure') api.getUserIdentity.mockRejectedValue(error)
      if (failure === 'begin-failure') {
        await expect(runtime.beginReconnect(original.id)).rejects.toMatchObject({ code: 'transient' })
      } else {
        const reconnect = await runtime.beginReconnect(original.id)
        if (failure === 'cancel') await runtime.cancelUserAuthorization(reconnect.authorizationSessionId)
        else
          await expect(runtime.completeUserAuthorization(reconnect.authorizationSessionId)).rejects.toMatchObject({
            code: 'transient'
          })
      }
      expect(connections.getById(original.id)).toEqual(original)
      await expect(credentials.read(original.credentialReference)).resolves.toEqual(bytes)
      await expect(runtime.acquireAccessToken(original.id)).resolves.toBe('access')
      await runtime.stop()
      const restarted = await start()
      await expect(restarted.acquireAccessToken(original.id)).resolves.toBe('access')
    }
  )

  it.each(['cancel', 'denied', 'expired', 'missing-scopes'])(
    'keeps dependent Sources active after optional reconnect %s',
    async (failure) => {
      const api = provider()
      const lifecycle = new ExternalKnowledgeSourceLifecycle({ requestSyncForTrigger: vi.fn() })
      const runtime = new ExternalKnowledgeRuntime({
        credentials,
        provider: api,
        now: () => 1_000,
        sleep: async () => {},
        hooks: { onReauthorizationRequired: (id) => lifecycle.pauseForReauthorization(id) },
        commitReauthorization: (id, input) => lifecycle.commitReauthorization(id, input)
      })
      runtimes.push(runtime)
      await runtime.start()
      const original = await connected(runtime)
      const baseId = '11111111-1111-4111-8111-111111111111'
      dbh.db
        .insert(knowledgeBaseTable)
        .values({
          id: baseId,
          orderKey: 'a0',
          name: 'Base',
          dimensions: null,
          embeddingModelId: null,
          status: 'completed',
          error: null,
          chunkSize: 1024,
          chunkOverlap: 200
        })
        .run()
      dbh.db
        .insert(externalKnowledgeSourceTable)
        .values({
          id: '0198f3f2-7d11-7abc-8def-123456789abc',
          baseId,
          connectionId: original.id,
          provider: 'feishu',
          tenantId: 'tenant',
          spaceId: 'space',
          scope: { kind: 'space' },
          name: 'Wiki',
          state: 'active',
          revision: 1
        })
        .run()
      const source = dbh.db.select().from(externalKnowledgeSourceTable).get()
      const reconnect = await runtime.beginReconnect(original.id, undefined, true)
      expect(dbh.db.select().from(externalKnowledgeSourceTable).get()).toEqual(source)
      if (failure === 'cancel') {
        await runtime.cancelUserAuthorization(reconnect.authorizationSessionId)
      } else {
        if (failure === 'missing-scopes')
          api.exchangeDeviceAuthorization.mockResolvedValue({ ...token, grantedScopes: [] })
        else
          api.exchangeDeviceAuthorization.mockRejectedValue(
            new FeishuProviderError(failure === 'denied' ? 'authorization-denied' : 'authorization-expired', true)
          )
        await expect(runtime.completeUserAuthorization(reconnect.authorizationSessionId)).rejects.toMatchObject({
          code: failure === 'missing-scopes' ? 'scope-missing' : 'authorization-failed'
        })
      }
      lifecycle.reconcilePersistedReauthorization()

      expect(dbh.db.select().from(externalKnowledgeSourceTable).get()).toEqual(source)
      await expect(runtime.acquireAccessToken(original.id)).resolves.toBe('access')
    }
  )

  it.each([
    ['denied', 'authorization-failed'],
    ['expired', 'authorization-failed'],
    ['invalid-candidate-token', 'reauthorization-required'],
    ['candidate-app-scope', 'scope-missing'],
    ['candidate-app-secret', 'reauthorization-required'],
    ['candidate-invalid-client', 'reauthorization-required'],
    ['candidate-grants', 'scope-missing'],
    ['candidate-identity-token', 'reauthorization-required'],
    ['candidate-identity-missing', 'identity-unverifiable'],
    ['candidate-account-mismatch', 'identity-conflict'],
    ['local-expiry', 'authorization-failed']
  ])('preserves the active account after candidate %s, including restart', async (failure, code) => {
    let now = 1_000
    const api = provider()
    const runtime = await start(api, () => now)
    const original = await connected(runtime)
    const originalCredential = await credentials.read(original.credentialReference)
    const reconnect = await runtime.beginReconnect(original.id)
    switch (failure) {
      case 'denied':
        api.exchangeDeviceAuthorization.mockRejectedValue(new FeishuProviderError('authorization-denied', true))
        break
      case 'expired':
        api.exchangeDeviceAuthorization.mockRejectedValue(new FeishuProviderError('authorization-expired', true))
        break
      case 'invalid-candidate-token':
        api.exchangeDeviceAuthorization.mockRejectedValue(new FeishuProviderError('reauthorization-required', true))
        break
      case 'candidate-app-secret':
      case 'candidate-invalid-client':
        vi.mocked(net.fetch).mockResolvedValueOnce(
          Response.json(failure === 'candidate-app-secret' ? { code: 20002 } : { error: 'invalid_client' }, {
            status: 400
          })
        )
        api.exchangeDeviceAuthorization.mockImplementation(() => exchangeDeviceAuthorization(app, device.deviceCode))
        break
      case 'candidate-app-scope':
        api.exchangeDeviceAuthorization.mockRejectedValue(new FeishuProviderError('app-scope-missing', true))
        break
      case 'candidate-grants':
        api.exchangeDeviceAuthorization.mockResolvedValue({ ...token, grantedScopes: [] })
        break
      case 'candidate-identity-token':
        api.getUserIdentity.mockRejectedValue(new FeishuProviderError('reauthorization-required', true))
        break
      case 'candidate-identity-missing':
        api.getUserIdentity.mockRejectedValue(new FeishuProviderError('identity-unverifiable', true))
        break
      case 'candidate-account-mismatch':
        api.getUserIdentity.mockResolvedValue({ ...identity, accountUserId: 'another-user' })
        break
      case 'local-expiry':
        now += device.expiresIn * 1_000 + 1
        break
    }

    await expect(runtime.completeUserAuthorization(reconnect.authorizationSessionId)).rejects.toMatchObject({ code })
    expect(connections.getById(original.id)).toEqual(original)
    await expect(credentials.read(original.credentialReference)).resolves.toEqual(originalCredential)
    expect((await fixture.store.listSummaries({ kind: 'user-authorization' })).map((entry) => entry.id)).toEqual([
      original.credentialReference
    ])
    await expect(runtime.acquireAccessToken(original.id)).resolves.toBe('access')
    await runtime.stop()
    const restarted = await start()
    await expect(restarted.acquireAccessToken(original.id)).resolves.toBe('access')
  })

  it('preserves PersonalAgent authorization when candidate consent grants excess scopes', async () => {
    const reference = randomUUID()
    const original = connections.create({
      appId: app.appId,
      appCredentialSource: 'personal-agent',
      credentialReference: reference
    })
    const active = connections.markConnected(original.id, { ...identity, grantedScopes: token.grantedScopes })
    await credentials.put(reference, {
      appId: app.appId,
      appSecret: app.appSecret,
      accessToken: 'access',
      refreshToken: 'refresh',
      accessTokenExpiresAt: 7_201_000,
      refreshTokenExpiresAt: 604_801_000,
      grantedScopes: token.grantedScopes
    })
    const api = provider()
    const runtime = await start(api)
    const reconnect = await runtime.beginReconnect(original.id)
    api.exchangeDeviceAuthorization.mockResolvedValue({
      ...token,
      grantedScopes: [...token.grantedScopes, 'im:message']
    })

    await expect(runtime.completeUserAuthorization(reconnect.authorizationSessionId)).rejects.toMatchObject({
      code: 'automatic-scope-mismatch'
    })
    expect(connections.getById(original.id)).toEqual(active)
    await expect(runtime.acquireAccessToken(original.id)).resolves.toBe('access')
  })

  it.each(['begin', 'cancel'] as const)('preserves in-flight token rotation when reconnect %s runs', async (stage) => {
    let now = 1_000
    const api = provider()
    const runtime = await start(api, () => now)
    const original = await connected(runtime)
    const reconnect = stage === 'cancel' ? await runtime.beginReconnect(original.id) : undefined
    now += token.expiresIn * 1_000
    const entered = deferred()
    const release = deferred()
    api.refreshUserToken.mockImplementationOnce(async () => {
      entered.resolve()
      await release.promise
      return { ...token, accessToken: 'rotated-access', refreshToken: 'rotated-refresh' }
    })
    const refreshing = runtime.acquireAccessToken(original.id).catch((error: unknown) => error)
    await entered.promise

    if (reconnect) {
      const cancelling = runtime.cancelUserAuthorization(reconnect.authorizationSessionId)
      release.resolve()
      await cancelling
    } else {
      const read = credentials.read.bind(credentials)
      vi.spyOn(credentials, 'read').mockImplementationOnce(async (reference) => {
        const stored = await read(reference)
        queueMicrotask(release.resolve)
        return stored
      })
      const begun = await runtime.beginReconnect(original.id)
      await runtime.cancelUserAuthorization(begun.authorizationSessionId)
    }
    await expect(refreshing).resolves.toBe('rotated-access')
    expect(connections.getById(original.id)?.authorizationStatus).toBe('connected')
    await expect(credentials.read(original.credentialReference)).resolves.toMatchObject({
      status: 'ok',
      credential: { accessToken: 'rotated-access', refreshToken: 'rotated-refresh' }
    })
    await runtime.stop()
    const restarted = await start(api, () => now)
    await expect(restarted.acquireAccessToken(original.id)).resolves.toBe('rotated-access')
  })

  it('still invalidates active credentials when token refresh loses required scopes', async () => {
    let now = 1_000
    const api = provider()
    const runtime = await start(api, () => now)
    const original = await connected(runtime)
    now += token.expiresIn * 1_000
    api.refreshUserToken.mockResolvedValue({ ...token, grantedScopes: [] })

    await expect(runtime.acquireAccessToken(original.id)).rejects.toMatchObject({ code: 'scope-missing' })
    expect(connections.getById(original.id)?.authorizationStatus).toBe('reauthorization-required')
  })

  it('does not restore an authorization invalidated while reconnect is pending', async () => {
    const api = provider()
    const runtime = await start(api)
    const original = await connected(runtime)
    const reconnect = await runtime.beginReconnect(original.id)
    api.getUserIdentity.mockRejectedValue(new FeishuProviderError('reauthorization-required', true))
    await expect(runtime.validateConnection(original.id)).rejects.toMatchObject({ code: 'reauthorization-required' })
    await runtime.cancelUserAuthorization(reconnect.authorizationSessionId)

    expect(connections.getById(original.id)?.authorizationStatus).toBe('reauthorization-required')
    await expect(runtime.acquireAccessToken(original.id)).rejects.toMatchObject({ code: 'reauthorization-required' })
  })

  it('fences old credential requests when a reconnect commits', async () => {
    const runtime = await start()
    const original = await connected(runtime)
    const reconnect = await runtime.beginReconnect(original.id)
    const requestEntered = deferred()
    const releaseRequest = deferred()
    const stale = runtime
      .runAuthorizedRequest(original.id, async () => {
        requestEntered.resolve()
        await releaseRequest.promise
        throw new FeishuProviderError('reauthorization-required', true)
      })
      .catch((error: unknown) => error)
    await requestEntered.promise
    const current = await runtime.completeUserAuthorization(reconnect.authorizationSessionId)
    releaseRequest.resolve()

    await expect(stale).resolves.toMatchObject({ name: 'AbortError' })
    expect(connections.getById(original.id)).toEqual(current)
    await expect(runtime.acquireAccessToken(original.id)).resolves.toBe('access')
  })

  it('does not let a late cancellation undo a newer successful reconnect', async () => {
    const runtime = await start()
    const original = await connected(runtime)
    const old = await runtime.beginReconnect(original.id)
    const cleanupEntered = deferred()
    const releaseCleanup = deferred()
    const remove = credentials.remove.bind(credentials)
    vi.spyOn(credentials, 'remove').mockImplementationOnce(async (reference, release) => {
      cleanupEntered.resolve()
      await releaseCleanup.promise
      return remove(reference, release)
    })
    const cancelling = runtime.cancelUserAuthorization(old.authorizationSessionId)
    await cleanupEntered.promise
    const replacement = await runtime.beginReconnect(original.id)
    const current = await runtime.completeUserAuthorization(replacement.authorizationSessionId)
    releaseCleanup.resolve()
    await cancelling

    expect(connections.getById(original.id)).toEqual(current)
    await expect(runtime.acquireAccessToken(original.id)).resolves.toBe('access')
  })
})
