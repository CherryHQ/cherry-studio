import { randomUUID } from 'node:crypto'

import { delay } from 'es-toolkit'

import { externalKnowledgeConnectionService } from '@data/services/ExternalKnowledgeConnectionService'
import { registrationBegin, registrationPoll } from '@main/services/feishuAppRegistration'
import type { ExternalKnowledgeConnection } from '@shared/data/types/externalKnowledgeConnection'

import {
  externalKnowledgeCredentialStore,
  type ExternalKnowledgeCredential,
  type ExternalKnowledgeCredentialReadResult,
  type ExternalKnowledgeTokenSet,
  type TokenRotationResult
} from './ExternalKnowledgeCredentialStore'
import {
  beginDeviceAuthorization,
  exchangeDeviceAuthorization,
  FEISHU_AUTOMATIC_ALLOWED_SCOPES,
  FEISHU_KNOWLEDGE_USER_SCOPES,
  FeishuProviderError,
  getUserIdentity,
  missingKnowledgeScopes,
  refreshUserToken,
  revokeUserToken,
  type FeishuApplicationCredentials,
  type FeishuDeviceAuthorization,
  type FeishuUserIdentity,
  type FeishuUserTokenSet
} from './feishuKnowledgeProvider'

const ACCESS_TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000
const MAX_REQUEST_ATTEMPTS = 3

type ConnectionStore = Pick<
  typeof externalKnowledgeConnectionService,
  'list' | 'getById' | 'create' | 'markConnected' | 'markValidated' | 'markReauthorizationRequired' | 'remove'
>

type CredentialStore = {
  read(credentialReference: string): Promise<ExternalKnowledgeCredentialReadResult>
  put(credentialReference: string, credential: ExternalKnowledgeCredential): Promise<void>
  rotateTokens(
    credentialReference: string,
    expectedRefreshToken: string,
    tokens: ExternalKnowledgeTokenSet
  ): Promise<TokenRotationResult>
  remove(credentialReference: string): Promise<void>
}

type Provider = {
  beginDeviceAuthorization(
    credentials: FeishuApplicationCredentials,
    signal?: AbortSignal
  ): Promise<FeishuDeviceAuthorization>
  exchangeDeviceAuthorization(
    credentials: FeishuApplicationCredentials,
    deviceCode: string,
    signal?: AbortSignal
  ): Promise<FeishuUserTokenSet>
  refreshUserToken(
    credentials: FeishuApplicationCredentials,
    refreshToken: string,
    signal?: AbortSignal
  ): Promise<FeishuUserTokenSet>
  getUserIdentity(accessToken: string, signal?: AbortSignal): Promise<FeishuUserIdentity>
  revokeUserToken(credentials: FeishuApplicationCredentials, refreshToken: string, signal?: AbortSignal): Promise<void>
}

type Registration = {
  begin: typeof registrationBegin
  poll: typeof registrationPoll
}

type Sleep = (milliseconds: number, signal?: AbortSignal) => Promise<void>

type RuntimeOptions = {
  connections?: ConnectionStore
  credentials?: CredentialStore
  provider?: Provider
  registration?: Registration
  now?: () => number
  sleep?: Sleep
}

type RegistrationSession = {
  controller: AbortController
  poll: Promise<{ appId: string; appSecret: string }>
}

type AuthorizationSession = {
  controller: AbortController
  connectionId: string
  credentialReference: string
  appCredentialSource: ExternalKnowledgeConnection['appCredentialSource']
  credentials: FeishuApplicationCredentials
  device: FeishuDeviceAuthorization
  expiresAt: number
  initial: boolean
  completion?: Promise<ExternalKnowledgeConnection>
}

export type BeginUserAuthorizationInput =
  | { kind: 'personal-agent'; registrationSessionId: string }
  | { kind: 'custom-app'; appId: string; appSecret: string; applicationName?: string }

export type BeginAuthorizationResult = {
  authorizationSessionId: string
  connection: ExternalKnowledgeConnection
  userCode: string
  verificationUri: string
  expiresAt: string
}

export type BeginAppRegistrationResult = {
  registrationSessionId: string
  verificationUri: string
  expiresAt: string
}

export type ExternalKnowledgeRuntimeErrorCode =
  | 'stopped'
  | 'not-found'
  | 'session-not-found'
  | 'credential-unavailable'
  | 'scope-missing'
  | 'automatic-scope-mismatch'
  | 'reauthorization-required'
  | 'authorization-failed'

export class ExternalKnowledgeRuntimeError extends Error {
  constructor(readonly code: ExternalKnowledgeRuntimeErrorCode) {
    super(`External Knowledge operation failed: ${code}`)
    this.name = 'ExternalKnowledgeRuntimeError'
  }
}

const defaultProvider: Provider = {
  beginDeviceAuthorization,
  exchangeDeviceAuthorization,
  refreshUserToken,
  getUserIdentity,
  revokeUserToken
}

const defaultRegistration: Registration = { begin: registrationBegin, poll: registrationPoll }

export class ExternalKnowledgeRuntime {
  private readonly connections: ConnectionStore
  private readonly credentials: CredentialStore
  private readonly provider: Provider
  private readonly registration: Registration
  private readonly now: () => number
  private readonly sleep: Sleep
  private lifetime = new AbortController()
  private accepting = false
  private readonly registrationSessions = new Map<string, RegistrationSession>()
  private readonly authorizationSessions = new Map<string, AuthorizationSession>()
  private readonly refreshFlights = new Map<string, Promise<string>>()
  private readonly requestTails = new Map<string, Promise<void>>()
  private readonly credentialControllers = new Map<string, AbortController>()
  private readonly inFlight = new Set<Promise<unknown>>()

  constructor(options: RuntimeOptions = {}) {
    this.connections = options.connections ?? externalKnowledgeConnectionService
    this.credentials = options.credentials ?? externalKnowledgeCredentialStore
    this.provider = options.provider ?? defaultProvider
    this.registration = options.registration ?? defaultRegistration
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? ((milliseconds, signal) => delay(milliseconds, { signal }))
  }

  async start(): Promise<void> {
    if (this.accepting) return
    this.lifetime = new AbortController()
    this.accepting = true
    try {
      await this.reconcileConnections()
    } catch (error) {
      this.accepting = false
      this.lifetime.abort()
      this.credentialControllers.clear()
      throw error
    }
  }

  async stop(): Promise<void> {
    if (!this.accepting && this.lifetime.signal.aborted) return
    this.accepting = false
    this.lifetime.abort()
    for (const controller of this.credentialControllers.values()) controller.abort()
    for (const session of this.registrationSessions.values()) session.controller.abort()
    for (const session of this.authorizationSessions.values()) session.controller.abort()
    this.registrationSessions.clear()
    this.authorizationSessions.clear()
    await Promise.allSettled([...this.inFlight])
    this.refreshFlights.clear()
    this.requestTails.clear()
    this.credentialControllers.clear()
  }

  async beginAppRegistration(): Promise<BeginAppRegistrationResult> {
    this.assertAccepting()
    const controller = new AbortController()
    const signal = AbortSignal.any([this.lifetime.signal, controller.signal])
    const begun = await this.track(
      this.registration.begin('feishu', {
        signal,
        verification: {
          source: 'cherry-knowledge',
          createOnly: true,
          name: 'Cherry Studio Knowledge',
          description: 'Read Feishu Wiki nodes and document content',
          addons: {
            preset: false,
            userScopes: [...FEISHU_KNOWLEDGE_USER_SCOPES]
          }
        }
      })
    )
    const registrationSessionId = randomUUID()
    const poll = this.track(
      this.registration.poll('feishu', begun.deviceCode, {
        interval: begun.interval,
        expiresIn: begun.expiresIn,
        signal
      })
    )
    void poll.catch(() => undefined)
    this.registrationSessions.set(registrationSessionId, { controller, poll })
    return {
      registrationSessionId,
      verificationUri: begun.verificationUri,
      expiresAt: new Date(this.now() + begun.expiresIn * 1000).toISOString()
    }
  }

  async cancelAppRegistration(registrationSessionId: string): Promise<void> {
    const session = this.registrationSessions.get(registrationSessionId)
    if (!session) return
    this.registrationSessions.delete(registrationSessionId)
    session.controller.abort()
    await Promise.allSettled([session.poll])
  }

  async beginUserAuthorization(input: BeginUserAuthorizationInput): Promise<BeginAuthorizationResult> {
    this.assertAccepting()
    let appCredentialSource: ExternalKnowledgeConnection['appCredentialSource']
    let appCredentials: FeishuApplicationCredentials
    let applicationName: string | undefined

    if (input.kind === 'personal-agent') {
      const registration = this.registrationSessions.get(input.registrationSessionId)
      if (!registration) throw new ExternalKnowledgeRuntimeError('session-not-found')
      try {
        appCredentials = await registration.poll
      } catch (error) {
        throw this.authorizationError(error)
      } finally {
        this.registrationSessions.delete(input.registrationSessionId)
      }
      appCredentialSource = 'personal-agent'
      applicationName = 'Cherry Studio Knowledge'
    } else {
      appCredentialSource = 'custom-app'
      appCredentials = { appId: input.appId, appSecret: input.appSecret }
      applicationName = input.applicationName
    }

    return await this.track(
      this.beginAuthorization({ appCredentialSource, appCredentials, applicationName, initial: true })
    )
  }

  async beginReconnect(connectionId: string): Promise<BeginAuthorizationResult> {
    this.assertAccepting()
    const connection = this.requireConnection(connectionId)
    const stored = await this.readCredential(connection)
    return await this.track(
      this.beginAuthorization({
        appCredentialSource: connection.appCredentialSource,
        appCredentials: { appId: stored.appId, appSecret: stored.appSecret },
        applicationName: connection.applicationName ?? undefined,
        initial: false,
        connection
      })
    )
  }

  completeUserAuthorization(authorizationSessionId: string): Promise<ExternalKnowledgeConnection> {
    this.assertAccepting()
    const session = this.authorizationSessions.get(authorizationSessionId)
    if (!session) return Promise.reject(new ExternalKnowledgeRuntimeError('session-not-found'))
    if (!session.completion) {
      session.completion = this.track(this.completeAuthorization(authorizationSessionId, session))
    }
    return session.completion
  }

  async cancelUserAuthorization(authorizationSessionId: string): Promise<void> {
    const session = this.authorizationSessions.get(authorizationSessionId)
    if (!session) return
    this.authorizationSessions.delete(authorizationSessionId)
    session.controller.abort()
    if (session.completion) await Promise.allSettled([session.completion])
    if (session.initial) {
      this.connections.remove(session.connectionId)
      await this.credentials.remove(session.credentialReference)
    }
  }

  async acquireAccessToken(connectionId: string, upstreamSignal?: AbortSignal): Promise<string> {
    this.assertAccepting()
    const connection = this.requireConnection(connectionId)
    const signal = this.credentialSignal(connection.credentialReference, upstreamSignal)
    if (connection.authorizationStatus === 'reauthorization-required') {
      throw new ExternalKnowledgeRuntimeError('reauthorization-required')
    }
    const stored = await this.readCredential(connection)
    if (stored.accessToken && (stored.accessTokenExpiresAt ?? 0) > this.now() + ACCESS_TOKEN_REFRESH_WINDOW_MS) {
      return stored.accessToken
    }
    if (!stored.refreshToken || (stored.refreshTokenExpiresAt ?? 0) <= this.now()) {
      this.markReauthorizationRequired(connection.id)
      throw new ExternalKnowledgeRuntimeError('reauthorization-required')
    }

    const existing = this.refreshFlights.get(connection.credentialReference)
    if (existing) return await existing
    const flight = this.track(this.refresh(connection, stored, signal))
    this.refreshFlights.set(connection.credentialReference, flight)
    try {
      return await flight
    } finally {
      if (this.refreshFlights.get(connection.credentialReference) === flight) {
        this.refreshFlights.delete(connection.credentialReference)
      }
    }
  }

  async runAuthorizedRequest<T>(
    connectionId: string,
    operation: (accessToken: string, signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    this.assertAccepting()
    const connection = this.requireConnection(connectionId)
    const previous = this.requestTails.get(connection.credentialReference) ?? Promise.resolve()
    const signal = this.credentialSignal(connection.credentialReference)
    const task = previous
      .catch(() => undefined)
      .then(async () => {
        signal.throwIfAborted()
        const accessToken = await this.acquireAccessToken(connectionId, signal)
        for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt++) {
          try {
            return await operation(accessToken, signal)
          } catch (error) {
            if (!(error instanceof FeishuProviderError)) throw error
            if (error.terminal) {
              this.markReauthorizationRequired(connectionId)
              throw new ExternalKnowledgeRuntimeError(
                error.code === 'app-scope-missing' ? 'scope-missing' : 'reauthorization-required'
              )
            }
            if (error.code !== 'transient' || attempt === MAX_REQUEST_ATTEMPTS) throw error
            await this.sleep(error.retryAfterMs ?? 500 * 2 ** (attempt - 1), signal)
          }
        }
        throw new ExternalKnowledgeRuntimeError('authorization-failed')
      })
    const tail = task.then(
      () => undefined,
      () => undefined
    )
    this.requestTails.set(connection.credentialReference, tail)
    void tail.finally(() => {
      if (this.requestTails.get(connection.credentialReference) === tail) {
        this.requestTails.delete(connection.credentialReference)
      }
    })
    return await this.track(task)
  }

  async validateConnection(connectionId: string): Promise<ExternalKnowledgeConnection> {
    const connection = this.requireConnection(connectionId)
    return await this.runAuthorizedRequest(connectionId, async (accessToken, signal) => {
      const identity = await this.provider.getUserIdentity(accessToken, signal)
      if (connection.authorizationStatus === 'connected' && this.identityChanged(connection, identity)) {
        this.markReauthorizationRequired(connectionId)
        throw new ExternalKnowledgeRuntimeError('reauthorization-required')
      }
      const current = await this.readCredential(connection)
      const validated = { ...identity, grantedScopes: current.grantedScopes }
      return connection.authorizationStatus === 'pending-authorization'
        ? this.connections.markConnected(connectionId, validated)
        : this.connections.markValidated(connectionId, validated)
    })
  }

  async removeUnreferencedConnection(connectionId: string): Promise<void> {
    this.assertAccepting()
    const connection = this.requireConnection(connectionId)
    const authorizationCompletions: Promise<unknown>[] = []
    for (const [sessionId, session] of this.authorizationSessions) {
      if (session.connectionId !== connectionId) continue
      this.authorizationSessions.delete(sessionId)
      session.controller.abort()
      if (session.completion) authorizationCompletions.push(session.completion)
    }
    this.credentialControllers.get(connection.credentialReference)?.abort()
    const pendingRequest = this.requestTails.get(connection.credentialReference)
    const pendingRefresh = this.refreshFlights.get(connection.credentialReference)
    await Promise.allSettled([
      ...authorizationCompletions,
      ...(pendingRequest ? [pendingRequest] : []),
      ...(pendingRefresh ? [pendingRefresh] : [])
    ])
    this.credentialControllers.delete(connection.credentialReference)
    const stored = await this.credentials.read(connection.credentialReference)
    if (stored.status === 'ok' && stored.credential.refreshToken) {
      try {
        await this.track(
          this.provider.revokeUserToken(
            { appId: stored.credential.appId, appSecret: stored.credential.appSecret },
            stored.credential.refreshToken,
            this.lifetime.signal
          )
        )
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error
      }
    }
    await this.credentials.remove(connection.credentialReference)
    this.connections.remove(connectionId)
  }

  private async beginAuthorization(input: {
    appCredentialSource: ExternalKnowledgeConnection['appCredentialSource']
    appCredentials: FeishuApplicationCredentials
    applicationName?: string
    initial: boolean
    connection?: ExternalKnowledgeConnection
  }): Promise<BeginAuthorizationResult> {
    const controller = new AbortController()
    const signal = AbortSignal.any([this.lifetime.signal, controller.signal])
    const credentialReference = input.connection?.credentialReference ?? `feishu:${randomUUID()}`
    let connection = input.connection

    if (input.initial) {
      await this.credentials.put(credentialReference, {
        ...input.appCredentials,
        grantedScopes: []
      })
    }

    let device: FeishuDeviceAuthorization
    try {
      device = await this.track(this.provider.beginDeviceAuthorization(input.appCredentials, signal))
    } catch (error) {
      if (input.initial) await this.credentials.remove(credentialReference)
      throw error
    }

    if (input.initial) {
      try {
        connection = this.connections.create({
          appId: input.appCredentials.appId,
          appCredentialSource: input.appCredentialSource,
          credentialReference,
          applicationName: input.applicationName ?? null
        })
      } catch (error) {
        await this.credentials.remove(credentialReference)
        throw error
      }
    }
    if (!connection) throw new ExternalKnowledgeRuntimeError('not-found')

    const authorizationSessionId = randomUUID()
    const expiresAt = this.now() + device.expiresIn * 1000
    this.authorizationSessions.set(authorizationSessionId, {
      controller,
      connectionId: connection.id,
      credentialReference,
      appCredentialSource: input.appCredentialSource,
      credentials: input.appCredentials,
      device,
      expiresAt,
      initial: input.initial
    })
    return {
      authorizationSessionId,
      connection,
      userCode: device.userCode,
      verificationUri: device.verificationUri,
      expiresAt: new Date(expiresAt).toISOString()
    }
  }

  private async completeAuthorization(
    authorizationSessionId: string,
    session: AuthorizationSession
  ): Promise<ExternalKnowledgeConnection> {
    const signal = AbortSignal.any([this.lifetime.signal, session.controller.signal])
    let interval = session.device.interval * 1000
    try {
      while (this.now() < session.expiresAt) {
        let token: FeishuUserTokenSet
        try {
          token = await this.provider.exchangeDeviceAuthorization(
            session.credentials,
            session.device.deviceCode,
            signal
          )
        } catch (error) {
          if (!(error instanceof FeishuProviderError)) throw error
          if (error.code === 'authorization-pending') {
            await this.sleep(interval, signal)
            continue
          }
          if (error.code === 'authorization-slow-down') {
            interval = Math.max(interval + 5000, error.retryAfterMs ?? 0)
            await this.sleep(interval, signal)
            continue
          }
          if (error.terminal) {
            this.markReauthorizationRequired(session.connectionId)
            throw this.authorizationError(error)
          }
          throw error
        }

        this.assertScopes(token.grantedScopes, session.appCredentialSource, session.connectionId)
        const storedTokens = this.absoluteTokens(token)
        await this.credentials.put(session.credentialReference, {
          ...session.credentials,
          ...storedTokens
        })
        const identity = await this.provider.getUserIdentity(token.accessToken, signal)
        return this.connections.markConnected(session.connectionId, {
          ...identity,
          grantedScopes: token.grantedScopes
        })
      }
      this.markReauthorizationRequired(session.connectionId)
      throw new ExternalKnowledgeRuntimeError('authorization-failed')
    } catch (error) {
      if (error instanceof FeishuProviderError && error.terminal) {
        this.markReauthorizationRequired(session.connectionId)
        throw this.authorizationError(error)
      }
      throw error
    } finally {
      this.authorizationSessions.delete(authorizationSessionId)
    }
  }

  private async refresh(
    connection: ExternalKnowledgeConnection,
    stored: ExternalKnowledgeCredential,
    signal: AbortSignal
  ): Promise<string> {
    try {
      const token = await this.provider.refreshUserToken(
        { appId: stored.appId, appSecret: stored.appSecret },
        stored.refreshToken!,
        signal
      )
      this.assertScopes(token.grantedScopes, connection.appCredentialSource, connection.id)
      const rotation = await this.credentials.rotateTokens(
        connection.credentialReference,
        stored.refreshToken!,
        this.absoluteTokens(token)
      )
      if (rotation === 'updated') return token.accessToken
      if (rotation === 'stale') {
        const current = await this.readCredential(connection)
        if (current.accessToken && (current.accessTokenExpiresAt ?? 0) > this.now()) return current.accessToken
      }
      this.markReauthorizationRequired(connection.id)
      throw new ExternalKnowledgeRuntimeError('credential-unavailable')
    } catch (error) {
      if (error instanceof FeishuProviderError && error.terminal) {
        this.markReauthorizationRequired(connection.id)
        throw new ExternalKnowledgeRuntimeError(
          error.code === 'app-scope-missing' ? 'scope-missing' : 'reauthorization-required'
        )
      }
      throw error
    }
  }

  private async reconcileConnections(): Promise<void> {
    for (const connection of this.connections.list()) {
      if (connection.authorizationStatus === 'reauthorization-required') continue
      const stored = await this.credentials.read(connection.credentialReference)
      if (stored.status !== 'ok' || stored.credential.appId !== connection.appId) {
        this.markReauthorizationRequired(connection.id)
        continue
      }
      if (!stored.credential.refreshToken) {
        this.markReauthorizationRequired(connection.id)
        continue
      }
      try {
        this.assertScopes(stored.credential.grantedScopes, connection.appCredentialSource, connection.id)
        const accessToken = await this.acquireAccessToken(connection.id)
        const identity = await this.provider.getUserIdentity(accessToken, this.lifetime.signal)
        const current = await this.readCredential(connection)
        if (connection.authorizationStatus === 'connected') {
          if (this.identityChanged(connection, identity)) {
            this.markReauthorizationRequired(connection.id)
          } else {
            this.connections.markValidated(connection.id, { ...identity, grantedScopes: current.grantedScopes })
          }
        } else {
          this.connections.markConnected(connection.id, {
            ...identity,
            grantedScopes: current.grantedScopes
          })
        }
      } catch (error) {
        if (
          error instanceof ExternalKnowledgeRuntimeError ||
          (error instanceof FeishuProviderError && error.terminal)
        ) {
          this.markReauthorizationRequired(connection.id)
        }
      }
    }
  }

  private async readCredential(connection: ExternalKnowledgeConnection): Promise<ExternalKnowledgeCredential> {
    const stored = await this.credentials.read(connection.credentialReference)
    if (stored.status !== 'ok' || stored.credential.appId !== connection.appId) {
      this.markReauthorizationRequired(connection.id)
      throw new ExternalKnowledgeRuntimeError('credential-unavailable')
    }
    return stored.credential
  }

  private assertScopes(
    grantedScopes: readonly string[],
    source: ExternalKnowledgeConnection['appCredentialSource'],
    connectionId: string
  ): void {
    if (missingKnowledgeScopes(grantedScopes).length > 0) {
      this.markReauthorizationRequired(connectionId)
      throw new ExternalKnowledgeRuntimeError('scope-missing')
    }
    if (source === 'personal-agent' && grantedScopes.some((scope) => !FEISHU_AUTOMATIC_ALLOWED_SCOPES.has(scope))) {
      this.markReauthorizationRequired(connectionId)
      throw new ExternalKnowledgeRuntimeError('automatic-scope-mismatch')
    }
  }

  private absoluteTokens(token: FeishuUserTokenSet): ExternalKnowledgeTokenSet {
    return {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      accessTokenExpiresAt: this.now() + token.expiresIn * 1000,
      refreshTokenExpiresAt: this.now() + token.refreshTokenExpiresIn * 1000,
      grantedScopes: token.grantedScopes
    }
  }

  private identityChanged(connection: ExternalKnowledgeConnection, identity: FeishuUserIdentity): boolean {
    return connection.accountOpenId !== identity.accountOpenId || connection.tenantKey !== identity.tenantKey
  }

  private requireConnection(connectionId: string): ExternalKnowledgeConnection {
    const connection = this.connections.getById(connectionId)
    if (!connection) throw new ExternalKnowledgeRuntimeError('not-found')
    return connection
  }

  private markReauthorizationRequired(connectionId: string): void {
    const connection = this.connections.getById(connectionId)
    if (connection && connection.authorizationStatus !== 'reauthorization-required') {
      this.connections.markReauthorizationRequired(connectionId)
    }
  }

  private authorizationError(error: unknown): ExternalKnowledgeRuntimeError {
    if (error instanceof FeishuProviderError && error.code === 'app-scope-missing') {
      return new ExternalKnowledgeRuntimeError('scope-missing')
    }
    if (error instanceof FeishuProviderError && error.code === 'reauthorization-required') {
      return new ExternalKnowledgeRuntimeError('reauthorization-required')
    }
    return new ExternalKnowledgeRuntimeError('authorization-failed')
  }

  private assertAccepting(): void {
    if (!this.accepting) throw new ExternalKnowledgeRuntimeError('stopped')
  }

  private credentialSignal(credentialReference: string, upstreamSignal?: AbortSignal): AbortSignal {
    let controller = this.credentialControllers.get(credentialReference)
    if (!controller || controller.signal.aborted) {
      controller = new AbortController()
      this.credentialControllers.set(credentialReference, controller)
    }
    return AbortSignal.any([this.lifetime.signal, controller.signal, ...(upstreamSignal ? [upstreamSignal] : [])])
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    this.inFlight.add(promise)
    void promise.then(
      () => this.inFlight.delete(promise),
      () => this.inFlight.delete(promise)
    )
    return promise
  }
}
