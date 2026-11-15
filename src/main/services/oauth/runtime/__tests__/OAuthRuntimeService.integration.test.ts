import type { Server } from 'node:http'

import { setupTestDatabase } from '@test-helpers/db'
import { net, shell } from 'electron'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'

import '@data/services/ProviderRegistryService'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { BaseService } from '@main/core/lifecycle'

import { OAuthServiceError, OAuthSignInCancelledError } from '../../errors'
import { LoopbackCallbackTransport } from '../LoopbackCallbackTransport'
import { OAuthRuntimeService } from '../OAuthRuntimeService'
import type * as ProviderDefinitions from '../providerDefinitions'

vi.mock('../providerDefinitions', async (importOriginal) => {
  const actual = await importOriginal<typeof ProviderDefinitions>()
  return {
    ...actual,
    resolveOAuthProviderDefinition: (providerId: string) => {
      const definition = actual.resolveOAuthProviderDefinition(providerId)
      return definition && { ...definition, transport: { ...definition.transport, port: 0 } }
    }
  }
})

class TestOAuthRuntimeService extends OAuthRuntimeService {
  stopForTest() {
    return this.onStop()
  }
}

describe('OAuth login with a real callback server and token store', () => {
  const dbh = setupTestDatabase()
  let service: TestOAuthRuntimeService
  let callbackWait: MockInstance<LoopbackCallbackTransport['waitForAuthorizationCode']>
  const tokenData = { access_token: 'private-token', refresh_token: 'private-refresh', expires_in: 3600 }

  beforeEach(() => {
    BaseService.resetInstances()
    service = new TestOAuthRuntimeService()
    dbh.db.insert(userProviderTable).values({ providerId: 'cherryin', name: 'CherryIN', orderKey: 'a0' }).run()
    vi.mocked(shell.openExternal).mockReset().mockResolvedValue()
    vi.mocked(net.fetch)
      .mockReset()
      .mockImplementation(async (input) => {
        const path = new URL(String(input)).pathname
        if (path === '/oauth2/token' || path === '/token') return Response.json(tokenData)
        if (path === '/api/v1/oauth/tokens') return Response.json(['private-key'])
        throw new Error(`Unexpected OAuth request: ${path}`)
      })
    callbackWait = vi.spyOn(LoopbackCallbackTransport.prototype, 'waitForAuthorizationCode')
  })

  afterEach(async () => {
    await service.stopForTest()
    vi.restoreAllMocks()
  })

  async function authorize(browserCall = 0, callbackPath = '/oauth/callback') {
    await vi.waitFor(() => expect(vi.mocked(shell.openExternal).mock.calls.length).toBeGreaterThan(browserCall))
    const authUrl = new URL(vi.mocked(shell.openExternal).mock.calls[browserCall][0])
    const transport = callbackWait.mock.contexts[browserCall] as { activeServers: Server[] }
    const address = transport.activeServers[0].address()
    if (!address || typeof address === 'string') throw new Error('Callback server is not listening')
    const callback = new URL(`http://127.0.0.1:${address.port}${callbackPath}`)
    callback.searchParams.set('state', authUrl.searchParams.get('state')!)
    callback.searchParams.set('code', 'test-code')
    const response = await fetch(callback)
    await response.text()
    expect(response.status).toBe(200)
  }

  it('delivers API keys only to the initiating window and account information to observers', async () => {
    const login = service.signIn('window-a', 'cherryin', 'owner')
    void login.catch(() => {})
    const repeated = service.signIn('window-a', 'cherryin', 'repeated')
    const observer = service.joinActiveSignIn('window-b', 'cherryin', 'observer')
    void observer.catch(() => {})
    await expect(service.signIn('window-b', 'cherryin', 'other')).rejects.toThrow(/another window/)

    await authorize()

    await expect(login).resolves.toEqual({ accountId: null, apiKeys: 'private-key' })
    await expect(repeated).resolves.toEqual({ accountId: null, apiKeys: 'private-key' })
    await expect(observer).resolves.toEqual({ status: 'completed', account: { accountId: null } })
    expect(dbh.db.select().from(userProviderTable).get()).toMatchObject({
      isEnabled: true,
      authConfig: { type: 'oauth', accessToken: 'private-token', refreshToken: 'private-refresh' }
    })
  })

  it('rejects a second CherryIN login to a different server without interrupting the first', async () => {
    const login = service.signIn('window-a', 'cherryin', 'owner', { apiHost: 'https://open.cherryin.ai' })
    void login.catch(() => {})
    await vi.waitFor(() => expect(shell.openExternal).toHaveBeenCalledOnce())

    await expect(
      service.signIn('window-a', 'cherryin', 'other', { apiHost: 'https://open.cherryin.dev' })
    ).rejects.toThrow(/another server/)

    await authorize()
    await expect(login).resolves.toEqual({ accountId: null, apiKeys: 'private-key' })
  })

  it('rejects callers without a managed window before starting or observing a login', async () => {
    await expect(service.signIn(null, 'cherryin', 'unknown')).rejects.toThrow(/managed window/)
    await expect(service.joinActiveSignIn(null, 'cherryin', 'unknown')).rejects.toThrow(/managed window/)
    await expect(service.cancelSignIn(null, 'cherryin', 'unknown')).rejects.toThrow(/managed window/)
    expect(shell.openExternal).not.toHaveBeenCalled()
    expect(dbh.db.select().from(userProviderTable).get()?.authConfig).toBeNull()
  })

  it.each(['window-a', 'window-b'])(
    'allows a registered %s to cancel without trusting another window’s request id',
    async (windowId) => {
      let outcome: unknown = 'pending'
      const login = service.signIn('window-a', 'cherryin', 'owner').catch((error: unknown) => {
        outcome = error
        return error
      })
      await vi.waitFor(() => expect(shell.openExternal).toHaveBeenCalledOnce())
      await service.cancelSignIn('window-b', 'cherryin', 'owner')
      expect(outcome).toBe('pending')

      const remounted = service.joinActiveSignIn('window-a', 'cherryin', 'remounted').catch((error: unknown) => error)
      const observer = service.joinActiveSignIn('window-b', 'cherryin', 'owner').catch((error: unknown) => error)
      await service.cancelSignIn(windowId, 'cherryin', windowId === 'window-a' ? 'remounted' : 'owner')
      for (const result of await Promise.all([login, remounted, observer])) {
        expect(result).toBeInstanceOf(OAuthSignInCancelledError)
      }

      const retry = service.signIn('window-a', 'cherryin', 'retry')
      void retry.catch(() => {})
      await service.cancelSignIn('window-a', 'cherryin', 'owner')
      await authorize(1)
      await expect(retry).resolves.toEqual({ accountId: null, apiKeys: 'private-key' })
    }
  )

  it('keeps a later callback server alive when a failed browser launch reaches its old timeout', async () => {
    const staleTimeout = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(staleTimeout.signal)
    const browserError = new Error('Browser launch failed')
    vi.mocked(shell.openExternal).mockRejectedValueOnce(browserError)
    await expect(service.signIn('window-a', 'cherryin', 'failed')).rejects.toHaveProperty('cause', browserError)

    const retry = service.signIn('window-a', 'cherryin', 'retry')
    void retry.catch(() => {})
    await vi.waitFor(() => expect(shell.openExternal).toHaveBeenCalledTimes(2))
    staleTimeout.abort()
    await authorize(1)
    await expect(retry).resolves.toEqual({ accountId: null, apiKeys: 'private-key' })
  })

  it('retains persisted tokens after an API-key timeout and allows another login', async () => {
    const timers = new Map<AbortSignal, AbortController>()
    let keyTimeout: AbortController | undefined
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const timer = new AbortController()
      timers.set(timer.signal, timer)
      return timer.signal
    })
    vi.mocked(net.fetch)
      .mockResolvedValueOnce(Response.json(tokenData))
      .mockImplementationOnce(
        (_url, options) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = options?.signal
            if (signal) keyTimeout = timers.get(signal)
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
      )
    const login = service.signIn('window-a', 'cherryin', 'timeout')
    void login.catch(() => {})
    await authorize()
    await vi.waitFor(() => expect(keyTimeout).toBeDefined())
    expect(dbh.db.select().from(userProviderTable).get()?.authConfig).toMatchObject({ accessToken: 'private-token' })
    const timeoutError = new DOMException('API-key request timed out', 'TimeoutError')
    keyTimeout!.abort(timeoutError)
    await expect(login).rejects.toHaveProperty('cause', timeoutError)
    expect(dbh.db.select().from(userProviderTable).get()?.authConfig).toMatchObject({
      accessToken: 'private-token',
      refreshToken: 'private-refresh'
    })

    const retry = service.signIn('window-a', 'cherryin', 'retry')
    void retry.catch(() => {})
    await authorize(1)
    await expect(retry).resolves.toEqual({ accountId: null, apiKeys: 'private-key' })
  })

  describe('Vertex AI sign in with Google', () => {
    const client = { type: 'authorized_user', clientId: 'cid', clientSecret: 'cs' }
    const vertexRow = () =>
      dbh.db
        .select()
        .from(userProviderTable)
        .all()
        .find((row) => row.providerId === 'vertexai')

    function seedVertex(credentials: Record<string, unknown>) {
      dbh.db
        .insert(userProviderTable)
        .values({
          providerId: 'vertexai',
          name: 'Vertex AI',
          orderKey: 'a1',
          isEnabled: false,
          authConfig: { type: 'iam-gcp', project: 'proj', location: 'global', credentials }
        })
        .run()
    }

    it('stores the session under the client that signed in', async () => {
      seedVertex(client)

      const login = service.signIn('window-a', 'vertexai', 'owner')
      void login.catch(() => {})
      await authorize(0, '/vertex/oauth/callback')

      await expect(login).resolves.toEqual({ accountId: null })
      expect(vertexRow()).toMatchObject({
        isEnabled: true,
        authConfig: { credentials: { ...client, accessToken: 'private-token', refreshToken: 'private-refresh' } }
      })
    })

    it('refuses a sign-in that completes after the saved OAuth client changed', async () => {
      seedVertex(client)

      const login = service.signIn('window-a', 'vertexai', 'owner')
      void login.catch(() => {})
      await vi.waitFor(() => expect(shell.openExternal).toHaveBeenCalledOnce())
      providerService.update('vertexai', {
        authConfig: {
          type: 'iam-gcp',
          project: 'proj',
          location: 'global',
          credentials: { ...client, clientId: 'cid-b' }
        }
      })
      await authorize(0, '/vertex/oauth/callback')

      const error = await login.catch((e: unknown) => e)
      expect(error).toBeInstanceOf(OAuthServiceError)
      expect((error as Error).message).toMatch(/client changed/)
      expect(vertexRow()).toMatchObject({
        isEnabled: false,
        authConfig: { credentials: { ...client, clientId: 'cid-b' } }
      })
      expect(vertexRow()?.authConfig).not.toHaveProperty('credentials.refreshToken')
    })

    it('stores a refreshed token for the saved client', async () => {
      seedVertex({ ...client, accessToken: 'old', refreshToken: 'refresh-1', expiresAt: Date.now() - 1_000 })

      await expect(service.getValidAccessToken('vertexai')).resolves.toEqual({
        accessToken: 'private-token',
        accountId: null
      })
      expect(vertexRow()?.authConfig).toMatchObject({
        credentials: { ...client, accessToken: 'private-token', refreshToken: 'private-refresh' }
      })
    })
  })
})
