import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { gunzipSync } from 'node:zlib'

import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { ExternalKnowledgeCredentialStore } from '@main/features/knowledge/external/ExternalKnowledgeCredentialStore'
import { ExternalKnowledgeRuntime } from '@main/features/knowledge/external/ExternalKnowledgeRuntime'
import * as knowledgeProvider from '@main/features/knowledge/external/feishuKnowledgeProvider'

import { applicationInput, setupCredentialStore } from '../credential/__tests__/credentialTestSetup'
import type * as RegistrationTransport from '../feishuAppRegistration'
import { registrationBegin, registrationPoll } from '../feishuAppRegistration'
import { FeishuRegistrationService } from '../FeishuRegistrationService'

vi.mock('../feishuAppRegistration', () => ({ registrationBegin: vi.fn(), registrationPoll: vi.fn() }))

describe('Feishu registration ownership and persistence', () => {
  const fixture = setupCredentialStore()
  let service: FeishuRegistrationService
  let window: EventEmitter & { isDestroyed: () => boolean }
  const begin = (overrides = {}) =>
    service.beginWindow('owner', {
      requestId: randomUUID(),
      domain: 'feishu',
      purpose: 'knowledge',
      userScopes: ['wiki:node:read'],
      ...overrides
    })

  beforeEach(async () => {
    window = Object.assign(new EventEmitter(), { isDestroyed: () => false })
    const fallback = vi.mocked(application.get).getMockImplementation()!
    vi.mocked(application.get).mockImplementation((name) => {
      if (name === 'CredentialStoreService') return fixture.store
      if (name === 'WindowManager') return { getWindow: () => window } as never
      return fallback(name)
    })
    vi.mocked(registrationBegin).mockResolvedValue({
      deviceCode: 'code',
      verificationUri: 'https://accounts.feishu.cn/verify',
      interval: 1,
      expiresIn: 600
    })
    vi.mocked(registrationPoll).mockResolvedValue({ appId: 'cli_new', appSecret: 'new-secret' })
    service = new FeishuRegistrationService()
    await service._doInit()
  })
  afterEach(async () => {
    await service._doStop()
    vi.useRealTimers()
  })

  it.each([
    { purpose: 'knowledge', existing: false },
    { purpose: 'knowledge', existing: true },
    { purpose: 'channel', existing: false },
    { purpose: 'channel', existing: true }
  ])(
    'allows application choice without changing presets: $purpose, selected=$existing',
    async ({ purpose, existing }) => {
      const transport = await vi.importActual<typeof RegistrationTransport>('../feishuAppRegistration')
      vi.mocked(registrationBegin).mockImplementationOnce(transport.registrationBegin)
      vi.mocked(net.fetch)
        .mockResolvedValueOnce(Response.json({}))
        .mockResolvedValueOnce(
          Response.json({
            device_code: 'code',
            verification_uri_complete: 'https://accounts.feishu.cn/verify',
            expires_in: 600
          })
        )
      const app = existing ? await fixture.store.create(applicationInput) : undefined
      const result = await begin({ purpose, applicationCredentialId: app?.id })
      const url = new URL(result.verificationUri)
      expect(url.searchParams.get('clientID')).toBe(existing ? applicationInput.payload.appId : null)
      expect(url.searchParams.has('createOnly')).toBe(false)
      expect(url.searchParams.has('name')).toBe(false)
      if (purpose === 'knowledge') {
        expect(JSON.parse(gunzipSync(Buffer.from(url.searchParams.get('addons')!, 'base64url')).toString())).toEqual({
          scopes: { user: ['wiki:node:read'] }
        })
      } else {
        expect(url.searchParams.has('addons')).toBe(false)
      }
    }
  )

  it.each([false, true])(
    'reuses a remotely selected application without losing channel configuration; secret conflict=%s',
    async (conflict) => {
      const app = await fixture.store.create(applicationInput)
      const original = await fixture.store.read(app.id)
      const { registrationSessionId: id } = await begin()
      vi.mocked(registrationPoll).mockResolvedValue({
        appId: applicationInput.payload.appId,
        appSecret: conflict ? 'other-secret' : applicationInput.payload.appSecret
      })
      if (conflict) {
        await expect(service.complete('owner', id)).rejects.toMatchObject({ code: 'conflict' })
      } else {
        expect(await service.complete('owner', id)).toEqual(app)
      }
      expect(await fixture.store.listSummaries()).toEqual([app])
      expect(await fixture.store.read(app.id)).toEqual(original)
    }
  )

  it.each([false, true])(
    'authorizes a remotely selected app with existing scopes and still requires Knowledge scopes; missing=%s',
    async (missing) => {
      const app = await fixture.store.create(applicationInput)
      vi.mocked(registrationPoll).mockResolvedValue({
        appId: applicationInput.payload.appId,
        appSecret: applicationInput.payload.appSecret
      })
      const runtime = new ExternalKnowledgeRuntime({
        credentials: new ExternalKnowledgeCredentialStore(fixture.store),
        sleep: async () => {},
        provider: {
          ...knowledgeProvider,
          beginDeviceAuthorization: async () => ({
            deviceCode: 'device',
            userCode: 'code',
            verificationUri: 'https://accounts.feishu.cn/verify',
            expiresIn: 600,
            interval: 1
          }),
          exchangeDeviceAuthorization: async () => ({
            accessToken: 'access',
            refreshToken: 'refresh',
            expiresIn: 7200,
            refreshTokenExpiresIn: 604800,
            grantedScopes: [...(missing ? [] : knowledgeProvider.FEISHU_REQUIRED_USER_SCOPES), 'im:message']
          }),
          getUserIdentity: async () => ({
            accountUserId: 'user',
            accountOpenId: 'open',
            accountUnionId: null,
            tenantKey: 'tenant',
            displayName: 'User',
            avatarUrl: null
          })
        }
      })
      await runtime.start()
      try {
        const registration = await begin()
        const authorization = await service.authorizeKnowledge(
          'owner',
          registration.registrationSessionId,
          (input, signal) => runtime.beginUserAuthorization(input, signal),
          (result) => runtime.cancelUserAuthorization(result.authorizationSessionId)
        )
        if (missing) {
          await expect(runtime.completeUserAuthorization(authorization.authorizationSessionId)).rejects.toMatchObject({
            code: 'scope-missing'
          })
        } else {
          const connection = await runtime.completeUserAuthorization(authorization.authorizationSessionId)
          expect(connection).toMatchObject({
            authorizationStatus: 'connected',
            appCredentialSource: 'custom-app',
            appId: applicationInput.payload.appId,
            accountUserId: 'user',
            tenantKey: 'tenant'
          })
          expect(await fixture.store.read(connection.credentialReference)).toMatchObject({
            status: 'ok',
            record: { payload: { applicationCredentialId: app.id } }
          })
        }
        expect(await fixture.store.listSummaries({ kind: 'application' })).toEqual([app])
      } finally {
        await runtime.stop()
      }
    }
  )

  it('deduplicates completion and exposes only a saved application summary to its owner', async () => {
    const { registrationSessionId: id } = await begin()
    expect(() => service.complete('other-window', id)).toThrow()
    service.cancel('other-window', id)
    const [first, second] = await Promise.all([service.complete('owner', id), service.complete('owner', id)])
    expect(first).toEqual(second)
    expect(await fixture.store.listSummaries()).toEqual([first])
    expect(await fixture.store.read(first.id)).toMatchObject({
      status: 'ok',
      record: { payload: { appSecret: 'new-secret' } }
    })
    expect(JSON.stringify(first)).not.toContain('new-secret')
  })

  it.each(['cancel', 'closed', 'shutdown'] as const)(
    'does not publish late provider results after %s',
    async (reason) => {
      const gate = Promise.withResolvers<{ appId: string; appSecret: string }>()
      vi.mocked(registrationPoll).mockReturnValue(gate.promise)
      const { registrationSessionId: id } = await begin()
      const result = service.complete('owner', id).catch((error) => error)
      let stopping: Promise<void> | undefined
      if (reason === 'cancel') service.cancel('owner', id)
      if (reason === 'closed') window.emit('closed')
      if (reason === 'shutdown') stopping = service._doStop()
      gate.resolve({ appId: 'cli_late', appSecret: 'late-secret' })
      expect(await result).toMatchObject({ code: 'stopped' })
      await stopping
      expect(await fixture.store.listSummaries()).toEqual([])
      expect(window.listenerCount('closed')).toBe(0)
    }
  )

  it('expires a session at the provider deadline', async () => {
    vi.useFakeTimers()
    const { registrationSessionId: id } = await begin()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(() => service.complete('owner', id)).toThrow()
    expect(window.listenerCount('closed')).toBe(0)
  })

  it('cancels a begin request before a session URL is returned', async () => {
    const gate = Promise.withResolvers<Awaited<ReturnType<typeof registrationBegin>>>()
    vi.mocked(registrationBegin).mockReturnValue(gate.promise)
    const requestId = randomUUID()
    const result = begin({ requestId }).catch((error) => error)
    service.cancel('owner', requestId)
    gate.resolve({
      deviceCode: 'late',
      verificationUri: 'https://accounts.feishu.cn/late',
      interval: 1,
      expiresIn: 600
    })
    expect(await result).toMatchObject({ code: 'stopped' })
    expect(window.listenerCount('closed')).toBe(0)
  })

  it.each(['switch', 'replace', 'remove', 'unchanged'] as const)(
    'preserves an existing application identity: %s',
    async (change) => {
      const app = await fixture.store.create(applicationInput)
      const { registrationSessionId: id } = await begin({ applicationCredentialId: app.id })
      vi.mocked(registrationPoll).mockResolvedValue({
        appId: change === 'switch' ? 'cli_other' : applicationInput.payload.appId,
        appSecret: applicationInput.payload.appSecret
      })
      if (change === 'remove') await fixture.store.remove(app.id, () => false)
      if (change === 'replace') await fixture.store.replaceApplication({ id: app.id, appSecret: 'rotated-secret' })
      if (change === 'unchanged') {
        expect(await service.complete('owner', id)).toEqual(app)
      } else {
        await expect(service.complete('owner', id)).rejects.toThrow()
      }
      const records = await fixture.store.listSummaries()
      expect(records.map((entry) => entry.id)).toEqual(change === 'remove' ? [] : [app.id])
      if (change === 'replace')
        expect(await fixture.store.read(app.id)).toMatchObject({
          status: 'ok',
          record: { payload: { appSecret: 'rotated-secret' } }
        })
    }
  )

  it('allows one knowledge handoff and cancels a late authorization result', async () => {
    const { registrationSessionId: id } = await begin()
    const entered = Promise.withResolvers<AbortSignal>()
    const gate = Promise.withResolvers<string>()
    const active = new Set<string>()
    const result = service
      .authorizeKnowledge(
        'owner',
        id,
        async (_input, signal) => {
          entered.resolve(signal)
          const authorization = await gate.promise
          active.add(authorization)
          return authorization
        },
        async (authorization) => {
          active.delete(authorization)
        }
      )
      .catch((error) => error)
    const signal = await entered.promise
    await expect(
      service.authorizeKnowledge(
        'owner',
        id,
        async () => 'duplicate',
        async () => {}
      )
    ).rejects.toThrow()
    service.cancel('owner', id)
    expect(signal.aborted).toBe(true)
    gate.resolve('pending-authorization')
    expect(await result).toMatchObject({ code: 'stopped' })
    expect(active.size).toBe(0)
  })
})
