import { randomUUID } from 'node:crypto'

import { delay } from 'es-toolkit'

import { externalKnowledgeConnectionService } from '@data/services/ExternalKnowledgeConnectionService'
import type { ExternalKnowledgeConnection } from '@data/services/ExternalKnowledgeConnectionService'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'
import type {
  ExternalKnowledgeDocumentRead,
  ExternalKnowledgeScopePreview,
  ExternalKnowledgeScopeResolution
} from '@shared/data/types/externalKnowledgeRead'

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
  FEISHU_READ_ENDPOINT_BUDGETS,
  FeishuProviderError,
  getDocxMarkdown,
  getUserIdentity,
  getWikiNode,
  listWikiChildNodes,
  missingKnowledgeScopes,
  refreshUserToken,
  revokeUserToken,
  type FeishuApplicationCredentials,
  type FeishuDeviceAuthorization,
  type FeishuUserAuthorization,
  type FeishuUserIdentity,
  type FeishuUserTokenSet,
  type FeishuWikiNode,
  type FeishuWikiNodePage
} from './feishuKnowledgeProvider'
import {
  FeishuKnowledgeReadError,
  parseFeishuKnowledgeUrl,
  previewFeishuKnowledgeScope,
  readFeishuDocx,
  resolveFeishuKnowledgeScope,
  type FeishuKnowledgeReadOperations,
  type FeishuKnowledgeReference
} from './feishuKnowledgeReadAdapter'

const ACCESS_TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000
const MAX_REQUEST_ATTEMPTS = 3

type ConnectionStore = Pick<
  typeof externalKnowledgeConnectionService,
  | 'list'
  | 'getById'
  | 'create'
  | 'markConnected'
  | 'markValidated'
  | 'markReauthorizationRequired'
  | 'commitReauthorization'
  | 'assertUnreferenced'
  | 'removeUnreferenced'
>

type ApplicationCredentials = FeishuApplicationCredentials & Pick<ExternalKnowledgeCredential, 'applicationSnapshot'>

type CredentialStore = {
  readApplication(id: string): Promise<ApplicationCredentials & { applicationName: string }>
  commit<T>(
    reference: string,
    expected: FeishuApplicationCredentials,
    commit: () => T extends PromiseLike<unknown> ? never : T
  ): Promise<T>
  read(credentialReference: string): Promise<ExternalKnowledgeCredentialReadResult>
  put(credentialReference: string, credential: ExternalKnowledgeCredential): Promise<void>
  rotateTokens(
    credentialReference: string,
    expected: ExternalKnowledgeCredential,
    tokens: ExternalKnowledgeTokenSet
  ): Promise<TokenRotationResult>
  remove(credentialReference: string, release?: () => void): Promise<void>
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
  getUserIdentity(authorization: FeishuUserAuthorization, signal?: AbortSignal): Promise<FeishuUserIdentity>
  revokeUserToken(credentials: FeishuApplicationCredentials, refreshToken: string, signal?: AbortSignal): Promise<void>
  getWikiNode(
    authorization: FeishuUserAuthorization,
    input: { token: string; objType: 'wiki' | 'docx' },
    signal?: AbortSignal
  ): Promise<FeishuWikiNode>
  listWikiChildNodes(
    authorization: FeishuUserAuthorization,
    spaceId: string,
    parentNodeToken: string,
    pageToken?: string,
    signal?: AbortSignal
  ): Promise<FeishuWikiNodePage>
  getDocxMarkdown(authorization: FeishuUserAuthorization, documentToken: string, signal?: AbortSignal): Promise<string>
}

type Sleep = (milliseconds: number, signal?: AbortSignal) => Promise<void>

type RuntimeOptions = {
  isConnectionBlocked?: (id: string) => boolean
  connections?: ConnectionStore
  credentials?: CredentialStore
  provider?: Provider
  now?: () => number
  sleep?: Sleep
}

type ResolvedApplicationCredentials = {
  source: ExternalKnowledgeConnection['appCredentialSource']
  credentials: ApplicationCredentials
  applicationName?: string
}

type AuthorizationSession = {
  controller: AbortController
  signal: AbortSignal
  generation: number
  connectionId: string
  stateCredentialReference: string
  candidateCredentialReference: string
  expectedCredentialReference: string | null
  appCredentialSource: ExternalKnowledgeConnection['appCredentialSource']
  applicationName: string | null
  credentials: ApplicationCredentials
  device: FeishuDeviceAuthorization
  expiresAt: number
  initial: boolean
  candidateCommitted: boolean
  completion?: Promise<ExternalKnowledgeConnection>
  expiryTimer?: ReturnType<typeof setTimeout>
}

type CredentialRuntimeState = {
  phase: 'active' | 'removing'
  generation: number
  controller: AbortController
  refreshFlight?: Promise<string>
  validationFlight?: Promise<ExternalKnowledgeConnection>
  validatedGeneration?: number
  requestTail?: Promise<void>
  nextAllowedAt: number
  endpointNextAllowedAt: Map<string, number>
}

type EndpointBudget = { key: string; minimumIntervalMs: number }

type AuthorizedReadContext = {
  authorization: FeishuUserAuthorization
  connection: ExternalKnowledgeConnection
  signal: AbortSignal
  request<T>(budget: EndpointBudget, operation: () => Promise<T>): Promise<T>
}

export type BeginUserAuthorizationInput =
  | {
      kind: 'saved-application'
      applicationCredentialId: string
      source?: ExternalKnowledgeConnection['appCredentialSource']
    }
  | { kind: 'custom-app'; appId: string; appSecret: string; applicationName?: string }

export type BeginAuthorizationResult = {
  authorizationSessionId: string
  connection: ExternalKnowledgeConnection
  userCode: string
  verificationUri: string
  expiresAt: string
}

export type ExternalKnowledgeRuntimeErrorCode =
  | 'stopped'
  | 'not-found'
  | 'connection-in-use'
  | 'session-not-found'
  | 'credential-unavailable'
  | 'scope-missing'
  | 'automatic-scope-mismatch'
  | 'identity-conflict'
  | 'identity-unverifiable'
  | 'reauthorization-required'
  | 'authorization-failed'
  | 'invalid-scope-url'
  | 'resource-permission-denied'
  | 'scope-not-found'
  | 'unsupported-resource'
  | 'transient'
  | 'invalid-provider-response'

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
  revokeUserToken,
  getWikiNode,
  listWikiChildNodes,
  getDocxMarkdown
}

export class ExternalKnowledgeRuntime {
  private readonly connections: ConnectionStore
  private readonly credentials: CredentialStore
  private readonly provider: Provider
  private readonly now: () => number
  private readonly sleep: Sleep
  private lifetime = new AbortController()
  private accepting = false
  private readonly authorizationSessions = new Map<string, AuthorizationSession>()
  private readonly isConnectionBlocked: (id: string) => boolean
  private readonly applicationIds = new Map<string, string>()
  private readonly credentialStates = new Map<string, CredentialRuntimeState>()
  private readonly inFlight = new Set<Promise<unknown>>()
  private startFlight?: Promise<void>

  constructor(options: RuntimeOptions = {}) {
    this.connections = options.connections ?? externalKnowledgeConnectionService
    this.credentials = options.credentials ?? externalKnowledgeCredentialStore
    this.isConnectionBlocked = options.isConnectionBlocked ?? (() => false)
    this.provider = options.provider ?? defaultProvider
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? ((milliseconds, signal) => delay(milliseconds, { signal }))
  }

  async start(): Promise<void> {
    if (this.accepting) return
    if (this.startFlight) return await this.startFlight
    this.lifetime = new AbortController()
    const lifetime = this.lifetime
    const flight = this.reconcileConnections().then(() => {
      if (!lifetime.signal.aborted) this.accepting = true
    })
    this.startFlight = flight
    try {
      await flight
    } catch (error) {
      this.accepting = false
      lifetime.abort()
      this.credentialStates.clear()
      throw error
    } finally {
      if (this.startFlight === flight) this.startFlight = undefined
    }
  }

  async stop(): Promise<void> {
    if (!this.accepting && this.lifetime.signal.aborted) return
    const startFlight = this.startFlight
    this.accepting = false
    this.lifetime.abort()
    for (const state of this.credentialStates.values()) state.controller.abort()
    for (const session of this.authorizationSessions.values()) {
      this.clearSessionExpiry(session)
      session.controller.abort()
    }
    this.authorizationSessions.clear()
    await Promise.allSettled([...(startFlight ? [startFlight] : []), ...this.inFlight])
    this.credentialStates.clear()
  }

  applicationChanged(applicationCredentialId: string): void {
    const appId = this.applicationIds.get(applicationCredentialId)
    if (!appId) return
    for (const connection of this.connections.list()) {
      if (connection.appId !== appId) continue
      const state = this.credentialStates.get(connection.credentialReference)
      if (state) this.advanceCredentialGeneration(connection.credentialReference, state)
    }
    for (const session of this.authorizationSessions.values()) {
      if (session.credentials.appId === appId) session.controller.abort()
    }
  }

  async beginUserAuthorization(
    input: BeginUserAuthorizationInput,
    signal?: AbortSignal
  ): Promise<BeginAuthorizationResult> {
    this.assertAccepting()
    const applicationCredentials = await this.resolveApplicationCredentials(input)
    this.assertAccepting()

    return await this.track(
      this.beginAuthorization({
        appCredentialSource: applicationCredentials.source,
        appCredentials: applicationCredentials.credentials,
        applicationName: applicationCredentials.applicationName,
        initial: true,
        beginSignal: signal
      })
    )
  }

  async beginReconnect(
    connectionId: string,
    replacement?: BeginUserAuthorizationInput,
    signal?: AbortSignal
  ): Promise<BeginAuthorizationResult> {
    this.assertAccepting()
    let connection = this.requireConnection(connectionId)
    const state = this.getCredentialState(connection.credentialReference)
    const currentGeneration = state.generation
    const applicationCredentials = replacement
      ? await this.resolveApplicationCredentials(replacement)
      : await this.readStoredApplicationCredentials(connection, { state, generation: currentGeneration })
    // A consumed refresh token must be replaced on disk before fencing the active credential.
    while (state.refreshFlight && this.isCurrentCredentialGeneration(state, currentGeneration)) {
      await Promise.allSettled([state.refreshFlight])
    }
    this.assertAccepting()
    this.assertCredentialGeneration(state, currentGeneration)
    connection = this.requireConnection(connectionId)
    if (connection.authorizationStatus === 'pending-authorization') {
      connection = this.connections.markReauthorizationRequired(connectionId)
    }
    const generation = this.advanceCredentialGeneration(connection.credentialReference, state)
    return await this.track(
      this.beginAuthorization({
        appCredentialSource: applicationCredentials.source,
        appCredentials: applicationCredentials.credentials,
        applicationName: applicationCredentials.applicationName,
        initial: false,
        connection,
        generation,
        beginSignal: signal
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
    await this.track(this.cancelAuthorization(authorizationSessionId))
  }

  private async cancelAuthorization(authorizationSessionId: string): Promise<void> {
    const session = this.authorizationSessions.get(authorizationSessionId)
    if (!session) return
    this.authorizationSessions.delete(authorizationSessionId)
    this.clearSessionExpiry(session)
    session.controller.abort()
    const state = this.credentialStates.get(session.stateCredentialReference)
    while (state?.refreshFlight && this.isCurrentCredentialGeneration(state, session.generation)) {
      await Promise.allSettled([state.refreshFlight])
    }
    const cleanupGeneration =
      state && this.isCurrentCredentialGeneration(state, session.generation)
        ? this.advanceCredentialGeneration(session.stateCredentialReference, state)
        : undefined
    if (session.completion) await Promise.allSettled([session.completion])
    if (
      !session.candidateCommitted &&
      (!session.initial || this.ownsInitialAuthorization(session, state, cleanupGeneration))
    ) {
      try {
        await this.credentials.remove(session.candidateCredentialReference, () => {
          if (session.initial && this.ownsInitialAuthorization(session, state, cleanupGeneration)) {
            this.connections.removeUnreferenced(session.connectionId)
            this.credentialStates.delete(session.stateCredentialReference)
          }
        })
      } catch {
        // Keep an unreferenced candidate if its file cannot be removed.
      }
    }
  }

  private ownsInitialAuthorization(
    session: AuthorizationSession,
    state: CredentialRuntimeState | undefined,
    generation: number | undefined
  ): boolean {
    return (
      !session.candidateCommitted &&
      state !== undefined &&
      generation !== undefined &&
      this.credentialStates.get(session.stateCredentialReference) === state &&
      this.isCurrentCredentialGeneration(state, generation) &&
      this.connections.getById(session.connectionId)?.credentialReference === session.candidateCredentialReference
    )
  }

  async acquireAccessToken(connectionId: string, upstreamSignal?: AbortSignal): Promise<string> {
    this.assertAccepting()
    const connection = this.requireConnection(connectionId)
    const state = this.getCredentialState(connection.credentialReference)
    const generation = state.generation
    const signal = this.credentialSignal(state, upstreamSignal)
    if (connection.authorizationStatus === 'reauthorization-required') {
      throw new ExternalKnowledgeRuntimeError('reauthorization-required')
    }
    const stored = await this.readCredential(connection, { state, generation })
    if (stored.accessToken && (stored.accessTokenExpiresAt ?? 0) > this.now() + ACCESS_TOKEN_REFRESH_WINDOW_MS) {
      return stored.accessToken
    }
    if (!stored.refreshToken || (stored.refreshTokenExpiresAt ?? 0) <= this.now()) {
      this.markReauthorizationRequiredIfCurrent(connection.id, state, generation)
      throw new ExternalKnowledgeRuntimeError('reauthorization-required')
    }

    const existing = state.refreshFlight
    if (existing) return await existing
    const flight = this.track(this.refresh(connection, stored, signal, state, generation))
    state.refreshFlight = flight
    try {
      return await flight
    } finally {
      if (state.refreshFlight === flight) {
        state.refreshFlight = undefined
      }
    }
  }

  async runAuthorizedRequest<T>(
    connectionId: string,
    operation: (accessToken: string, signal: AbortSignal, assertCurrent: () => void) => Promise<T>
  ): Promise<T> {
    this.assertAccepting()
    const connection = this.requireConnection(connectionId)
    const state = this.getCredentialState(connection.credentialReference)
    const generation = state.generation
    const assertCurrent = () => this.assertCredentialGeneration(state, generation)
    const previous = state.requestTail ?? Promise.resolve()
    const signal = this.credentialSignal(state)
    const task = previous
      .catch(() => undefined)
      .then(async () => {
        assertCurrent()
        await this.waitForCredentialBackoff(state, signal)
        assertCurrent()
        try {
          const accessToken = await this.acquireAccessToken(connectionId, signal)
          assertCurrent()
          await this.ensureConnectionValidated(connection, accessToken, state, generation, signal)
          assertCurrent()
          return await this.runCredentialRequest(state, generation, signal, () =>
            operation(accessToken, signal, assertCurrent)
          )
        } catch (error) {
          assertCurrent()
          if (!(error instanceof FeishuProviderError) || !error.terminal) throw error
          this.markReauthorizationRequiredIfCurrent(connectionId, state, generation)
          throw new ExternalKnowledgeRuntimeError(
            error.code === 'app-scope-missing'
              ? 'scope-missing'
              : error.code === 'identity-unverifiable'
                ? 'identity-unverifiable'
                : 'reauthorization-required'
          )
        }
      })
    const tail = task.then(
      () => undefined,
      () => undefined
    )
    state.requestTail = tail
    void tail.finally(() => {
      if (state.requestTail === tail) {
        state.requestTail = undefined
      }
    })
    return await this.track(task)
  }

  async resolveFeishuScope(connectionId: string, url: string): Promise<ExternalKnowledgeScopeResolution> {
    this.assertAccepting()
    this.assertValidFeishuScopeUrl(url)
    return await this.runAuthorizedRead(connectionId, async (context) => {
      const resolved = await resolveFeishuKnowledgeScope(
        { connection: context.connection, url },
        this.feishuReadOperations(context),
        context.signal
      )
      return resolved.resolution
    })
  }

  async previewFeishuScope(connectionId: string, url: string): Promise<ExternalKnowledgeScopePreview> {
    this.assertAccepting()
    this.assertValidFeishuScopeUrl(url)
    return await this.runAuthorizedRead(connectionId, async (context) => {
      const result = await previewFeishuKnowledgeScope(
        { connection: context.connection, url },
        this.feishuReadOperations(context),
        context.signal
      )
      return result.preview
    })
  }

  async readFeishuDocument(
    connectionId: string,
    reference: FeishuKnowledgeReference
  ): Promise<ExternalKnowledgeDocumentRead> {
    return await this.runAuthorizedRead(connectionId, async (context) =>
      readFeishuDocx(reference, this.feishuReadOperations(context), context.signal)
    )
  }

  private async runAuthorizedRead<T>(
    connectionId: string,
    operation: (context: AuthorizedReadContext) => Promise<T>
  ): Promise<T> {
    this.assertAccepting()
    const connection = this.requireConnection(connectionId)
    const state = this.getCredentialState(connection.credentialReference)
    const generation = state.generation
    const assertCurrent = () => this.assertCredentialGeneration(state, generation)
    const previous = state.requestTail ?? Promise.resolve()
    const signal = this.credentialSignal(state)
    const task = previous
      .catch(() => undefined)
      .then(async () => {
        assertCurrent()
        try {
          const accessToken = await this.acquireAccessToken(connectionId, signal)
          assertCurrent()
          const validatedConnection = await this.ensureConnectionValidated(
            connection,
            accessToken,
            state,
            generation,
            signal
          )
          assertCurrent()
          const credential = await this.readCredential(connection, { state, generation })
          const authorization = { appId: credential.appId, appSecret: credential.appSecret, accessToken }
          return await operation({
            authorization,
            connection: validatedConnection,
            signal,
            request: (budget, request) =>
              this.runCredentialRequest(
                state,
                generation,
                signal,
                async () => {
                  authorization.accessToken = await this.acquireAccessToken(connectionId, signal)
                  assertCurrent()
                  return await request()
                },
                budget
              )
          })
        } catch (error) {
          assertCurrent()
          throw this.readOperationError(error, connectionId, state, generation)
        }
      })
    const tail = task.then(
      () => undefined,
      () => undefined
    )
    state.requestTail = tail
    void tail.finally(() => {
      if (state.requestTail === tail) state.requestTail = undefined
    })
    return await this.track(task)
  }

  private assertValidFeishuScopeUrl(url: string): void {
    try {
      parseFeishuKnowledgeUrl(url)
    } catch (error) {
      if (error instanceof FeishuKnowledgeReadError) throw new ExternalKnowledgeRuntimeError(error.code)
      throw error
    }
  }

  private feishuReadOperations(context: AuthorizedReadContext): FeishuKnowledgeReadOperations {
    return {
      getNode: (token, objType, signal) =>
        context.request(FEISHU_READ_ENDPOINT_BUDGETS.getWikiNode, () =>
          this.provider.getWikiNode(context.authorization, { token, objType }, signal ?? context.signal)
        ),
      listChildNodes: (spaceId, parentNodeToken, pageToken, signal) =>
        context.request(FEISHU_READ_ENDPOINT_BUDGETS.listWikiNodes, () =>
          this.provider.listWikiChildNodes(
            context.authorization,
            spaceId,
            parentNodeToken,
            pageToken,
            signal ?? context.signal
          )
        ),
      getDocumentMarkdown: (documentToken, signal) =>
        context.request(FEISHU_READ_ENDPOINT_BUDGETS.getDocxMarkdown, () =>
          this.provider.getDocxMarkdown(context.authorization, documentToken, signal ?? context.signal)
        )
    }
  }

  private readOperationError(
    error: unknown,
    connectionId: string,
    state: CredentialRuntimeState,
    generation: number
  ): unknown {
    if (error instanceof FeishuKnowledgeReadError) return new ExternalKnowledgeRuntimeError(error.code)
    if (!(error instanceof FeishuProviderError)) return error
    if (error.terminal) {
      this.markReauthorizationRequiredIfCurrent(connectionId, state, generation)
      return new ExternalKnowledgeRuntimeError(
        error.code === 'app-scope-missing'
          ? 'scope-missing'
          : error.code === 'identity-unverifiable'
            ? 'identity-unverifiable'
            : 'reauthorization-required'
      )
    }
    switch (error.code) {
      case 'resource-permission-denied':
      case 'scope-not-found':
      case 'transient':
        return new ExternalKnowledgeRuntimeError(error.code)
      case 'invalid-response':
        return new ExternalKnowledgeRuntimeError('invalid-provider-response')
      default:
        return error
    }
  }

  async validateConnection(connectionId: string): Promise<ExternalKnowledgeConnection> {
    this.assertAccepting()
    const connection = this.requireConnection(connectionId)
    const state = this.getCredentialState(connection.credentialReference)
    state.validatedGeneration = undefined
    return await this.runAuthorizedRequest(connectionId, async () => this.requireConnection(connectionId))
  }

  async removeUnreferencedConnection(connectionId: string): Promise<void> {
    this.assertAccepting()
    await this.track(this.removeConnection(connectionId))
  }

  private async removeConnection(connectionId: string): Promise<void> {
    const connection = this.requireConnection(connectionId)
    try {
      this.connections.assertUnreferenced(connectionId)
    } catch (error) {
      if (isDataApiError(error) && error.code === ErrorCode.INVALID_OPERATION) {
        throw new ExternalKnowledgeRuntimeError('connection-in-use')
      }
      throw error
    }
    const state = this.getCredentialState(connection.credentialReference)
    state.phase = 'removing'
    state.generation++
    state.controller.abort()
    const authorizationCompletions: Promise<unknown>[] = []
    for (const [sessionId, session] of this.authorizationSessions) {
      if (session.connectionId !== connectionId) continue
      this.authorizationSessions.delete(sessionId)
      this.clearSessionExpiry(session)
      session.controller.abort()
      if (session.completion) authorizationCompletions.push(session.completion)
    }
    const pendingRequest = state.requestTail
    const pendingRefresh = state.refreshFlight
    await Promise.allSettled([
      ...authorizationCompletions,
      ...(pendingRequest ? [pendingRequest] : []),
      ...(pendingRefresh ? [pendingRefresh] : [])
    ])
    try {
      this.connections.removeUnreferenced(connectionId)
      this.credentialStates.delete(connection.credentialReference)
      await this.retireCredential(connection.credentialReference, this.lifetime.signal)
    } catch (error) {
      if (this.connections.getById(connectionId)) {
        state.phase = 'active'
        this.advanceCredentialGeneration(connection.credentialReference, state)
      }
      if (isDataApiError(error) && error.code === ErrorCode.INVALID_OPERATION) {
        throw new ExternalKnowledgeRuntimeError('connection-in-use')
      }
      throw error
    }
  }

  private async beginAuthorization(input: {
    appCredentialSource: ExternalKnowledgeConnection['appCredentialSource']
    appCredentials: ApplicationCredentials
    applicationName?: string
    initial: boolean
    connection?: ExternalKnowledgeConnection
    generation?: number
    beginSignal?: AbortSignal
  }): Promise<BeginAuthorizationResult> {
    const controller = new AbortController()
    const candidateCredentialReference = randomUUID()
    const expectedCredentialReference = input.connection?.credentialReference ?? null
    const stateCredentialReference = expectedCredentialReference ?? candidateCredentialReference
    const state = this.getCredentialState(stateCredentialReference)
    const generation = input.generation ?? this.advanceCredentialGeneration(stateCredentialReference, state)
    this.assertCredentialGeneration(state, generation)
    const signal = AbortSignal.any([this.lifetime.signal, state.controller.signal, controller.signal])
    let connection = input.connection

    try {
      input.beginSignal?.throwIfAborted()
      const beginSignal = input.beginSignal ? AbortSignal.any([signal, input.beginSignal]) : signal
      const device: FeishuDeviceAuthorization = await this.runCredentialRequest(state, generation, beginSignal, () =>
        this.provider.beginDeviceAuthorization(input.appCredentials, beginSignal)
      )
      this.assertCredentialGeneration(state, generation)

      input.beginSignal?.throwIfAborted()
      if (input.initial) {
        connection = this.connections.create({
          appId: input.appCredentials.appId,
          appCredentialSource: input.appCredentialSource,
          credentialReference: candidateCredentialReference,
          applicationName: input.applicationName ?? null
        })
      }
      if (!connection) throw new ExternalKnowledgeRuntimeError('not-found')

      const authorizationSessionId = randomUUID()
      const expiresAt = this.now() + device.expiresIn * 1000
      const session: AuthorizationSession = {
        controller,
        signal,
        generation,
        connectionId: connection.id,
        stateCredentialReference,
        candidateCredentialReference,
        expectedCredentialReference,
        appCredentialSource: input.appCredentialSource,
        applicationName: input.applicationName ?? null,
        credentials: input.appCredentials,
        device,
        expiresAt,
        initial: input.initial,
        candidateCommitted: false
      }
      this.authorizationSessions.set(authorizationSessionId, session)
      session.expiryTimer = this.scheduleSessionExpiry(expiresAt, () => {
        if (this.authorizationSessions.get(authorizationSessionId) !== session) return
        void this.track(this.cancelAuthorization(authorizationSessionId)).catch(() => undefined)
      })
      return {
        authorizationSessionId,
        connection,
        userCode: device.userCode,
        verificationUri: device.verificationUri,
        expiresAt: new Date(expiresAt).toISOString()
      }
    } catch (error) {
      try {
        await this.credentials.remove(candidateCredentialReference)
      } catch {
        // Keep an unreferenced candidate if its file cannot be removed.
      } finally {
        if (input.initial && !connection) this.credentialStates.delete(stateCredentialReference)
      }
      throw error instanceof FeishuProviderError && error.terminal ? this.authorizationError(error) : error
    }
  }

  private async completeAuthorization(
    authorizationSessionId: string,
    session: AuthorizationSession
  ): Promise<ExternalKnowledgeConnection> {
    const state = this.getCredentialState(session.stateCredentialReference)
    const signal = session.signal
    let interval = session.device.interval * 1000
    try {
      while (this.now() < session.expiresAt) {
        this.assertCredentialGeneration(state, session.generation)
        let token: FeishuUserTokenSet
        try {
          token = await this.runCredentialRequest(state, session.generation, signal, () =>
            this.provider.exchangeDeviceAuthorization(session.credentials, session.device.deviceCode, signal)
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
          throw error
        }

        this.assertCredentialGeneration(state, session.generation)
        this.assertScopes(token.grantedScopes, session.appCredentialSource)
        const identity = await this.runCredentialRequest(state, session.generation, signal, () =>
          this.provider.getUserIdentity({ ...session.credentials, accessToken: token.accessToken }, signal)
        )
        this.assertCredentialGeneration(state, session.generation)
        const connection = this.requireConnection(session.connectionId)
        if (!session.initial) this.assertReconnectIdentity(connection, identity)
        await this.credentials.put(session.candidateCredentialReference, {
          ...session.credentials,
          ...this.absoluteTokens(token)
        })
        this.assertCredentialGeneration(state, session.generation)
        const connected = await this.credentials.commit(
          session.candidateCredentialReference,
          session.credentials,
          () => {
            this.assertCredentialGeneration(state, session.generation)
            return session.initial
              ? this.connections.markConnected(session.connectionId, {
                  ...identity,
                  grantedScopes: token.grantedScopes
                })
              : this.connections.commitReauthorization(session.connectionId, {
                  expectedCredentialReference: session.expectedCredentialReference!,
                  candidateCredentialReference: session.candidateCredentialReference,
                  appId: session.credentials.appId,
                  appCredentialSource: session.appCredentialSource,
                  applicationName: session.applicationName,
                  identity: { ...identity, grantedScopes: token.grantedScopes }
                })
          }
        )
        session.candidateCommitted = true
        if (session.expectedCredentialReference) {
          this.rekeyCredentialState(
            session.expectedCredentialReference,
            session.candidateCredentialReference,
            state,
            session.generation
          )
        }
        state.validatedGeneration = state.generation
        if (session.expectedCredentialReference) {
          await this.retireCredential(session.expectedCredentialReference, this.credentialSignal(state))
        }
        return connected
      }
      throw new ExternalKnowledgeRuntimeError('authorization-failed')
    } catch (error) {
      let authorizationFailure = error
      if (error instanceof FeishuProviderError && error.terminal) {
        authorizationFailure = this.authorizationError(error)
      }
      if (
        !session.candidateCommitted &&
        (!session.initial || this.ownsInitialAuthorization(session, state, session.generation))
      ) {
        try {
          await this.credentials.remove(session.candidateCredentialReference, () => {
            if (session.initial && this.ownsInitialAuthorization(session, state, session.generation)) {
              this.connections.removeUnreferenced(session.connectionId)
              this.credentialStates.delete(session.stateCredentialReference)
            }
          })
        } catch {
          // Keep an unreferenced candidate if its file cannot be removed.
        }
      }
      throw authorizationFailure
    } finally {
      if (this.authorizationSessions.get(authorizationSessionId) === session) {
        this.authorizationSessions.delete(authorizationSessionId)
      }
      this.clearSessionExpiry(session)
    }
  }

  private async refresh(
    connection: ExternalKnowledgeConnection,
    stored: ExternalKnowledgeCredential,
    signal: AbortSignal,
    state: CredentialRuntimeState,
    generation: number
  ): Promise<string> {
    try {
      const token = await this.runCredentialRequest(state, generation, signal, () =>
        this.provider.refreshUserToken(
          { appId: stored.appId, appSecret: stored.appSecret },
          stored.refreshToken!,
          signal
        )
      )
      this.assertCredentialGeneration(state, generation)
      this.assertScopes(token.grantedScopes, connection.appCredentialSource)
      const rotation = await this.credentials.rotateTokens(
        connection.credentialReference,
        stored,
        this.absoluteTokens(token)
      )
      this.assertCredentialGeneration(state, generation)
      if (rotation === 'updated') return token.accessToken
      if (rotation === 'stale') {
        const current = await this.readCredential(connection, { state, generation })
        if (current.accessToken && (current.accessTokenExpiresAt ?? 0) > this.now()) return current.accessToken
      }
      this.markReauthorizationRequiredIfCurrent(connection.id, state, generation)
      throw new ExternalKnowledgeRuntimeError('credential-unavailable')
    } catch (error) {
      if (
        error instanceof ExternalKnowledgeRuntimeError &&
        (error.code === 'scope-missing' || error.code === 'automatic-scope-mismatch')
      ) {
        this.markReauthorizationRequiredIfCurrent(connection.id, state, generation)
      }
      if (error instanceof FeishuProviderError && error.terminal) {
        this.markReauthorizationRequiredIfCurrent(connection.id, state, generation)
        throw new ExternalKnowledgeRuntimeError(
          error.code === 'app-scope-missing' ? 'scope-missing' : 'reauthorization-required'
        )
      }
      throw error
    }
  }

  private rekeyCredentialState(
    expectedReference: string,
    candidateReference: string,
    state: CredentialRuntimeState,
    generation: number
  ): void {
    this.assertCredentialGeneration(state, generation)
    if (this.credentialStates.get(expectedReference) !== state) {
      throw new DOMException('External Knowledge credential operation was superseded', 'AbortError')
    }
    this.advanceCredentialGeneration(expectedReference, state)
    this.credentialStates.delete(expectedReference)
    this.credentialStates.set(candidateReference, state)
  }

  private async retireCredential(credentialReference: string, signal: AbortSignal): Promise<void> {
    const stored = await this.credentials.read(credentialReference).catch(() => null)
    if (stored?.status === 'ok' && stored.credential.refreshToken) {
      try {
        await this.provider.revokeUserToken(
          { appId: stored.credential.appId, appSecret: stored.credential.appSecret },
          stored.credential.refreshToken,
          signal
        )
      } catch {
        // Credential retirement is best-effort after the durable reference swap.
      }
    }
    try {
      await this.credentials.remove(credentialReference)
    } catch {
      // Keep an unreferenced candidate if its file cannot be removed.
    }
  }

  private async reconcileConnections(): Promise<void> {
    const connections = this.connections.list()
    for (const connection of connections) {
      if (this.isConnectionBlocked(connection.id) || connection.authorizationStatus === 'reauthorization-required')
        continue
      const stored = await this.credentials.read(connection.credentialReference)
      if (stored.status !== 'ok' || stored.credential.appId !== connection.appId) {
        this.markReauthorizationRequired(connection.id)
        continue
      }
      if (stored.credential.applicationSnapshot)
        this.applicationIds.set(stored.credential.applicationSnapshot.applicationCredentialId, stored.credential.appId)
      if (!stored.credential.refreshToken || (stored.credential.refreshTokenExpiresAt ?? 0) <= this.now()) {
        this.markReauthorizationRequired(connection.id)
        continue
      }
      try {
        this.assertScopes(stored.credential.grantedScopes, connection.appCredentialSource)
      } catch (error) {
        if (error instanceof ExternalKnowledgeRuntimeError) {
          this.markReauthorizationRequired(connection.id)
        }
      }
    }
  }

  private async readCredential(
    connection: ExternalKnowledgeConnection,
    expected?: { state: CredentialRuntimeState; generation: number }
  ): Promise<ExternalKnowledgeCredential> {
    if (this.isConnectionBlocked(connection.id)) throw new ExternalKnowledgeRuntimeError('credential-unavailable')
    const stored = await this.credentials.read(connection.credentialReference)
    if (expected) this.assertCredentialGeneration(expected.state, expected.generation)
    if (stored.status !== 'ok' || stored.credential.appId !== connection.appId) {
      if (expected) {
        this.markReauthorizationRequiredIfCurrent(connection.id, expected.state, expected.generation)
      } else {
        this.markReauthorizationRequired(connection.id)
      }
      throw new ExternalKnowledgeRuntimeError('credential-unavailable')
    }
    if (stored.credential.applicationSnapshot)
      this.applicationIds.set(stored.credential.applicationSnapshot.applicationCredentialId, stored.credential.appId)
    return stored.credential
  }

  private async ensureConnectionValidated(
    connection: ExternalKnowledgeConnection,
    accessToken: string,
    state: CredentialRuntimeState,
    generation: number,
    signal: AbortSignal
  ): Promise<ExternalKnowledgeConnection> {
    if (state.validatedGeneration === generation) return this.requireConnection(connection.id)
    if (state.validationFlight) return await state.validationFlight

    const flight = this.track(this.validateIdentity(connection, accessToken, state, generation, signal))
    state.validationFlight = flight
    try {
      const validated = await flight
      this.assertCredentialGeneration(state, generation)
      state.validatedGeneration = generation
      return validated
    } finally {
      if (state.validationFlight === flight) state.validationFlight = undefined
    }
  }

  private async validateIdentity(
    connection: ExternalKnowledgeConnection,
    accessToken: string,
    state: CredentialRuntimeState,
    generation: number,
    signal: AbortSignal
  ): Promise<ExternalKnowledgeConnection> {
    const credential = await this.readCredential(connection, { state, generation })
    const identity = await this.runCredentialRequest(state, generation, signal, () =>
      this.provider.getUserIdentity({ appId: credential.appId, appSecret: credential.appSecret, accessToken }, signal)
    )
    this.assertCredentialGeneration(state, generation)
    if (connection.accountUserId !== null && this.identityChanged(connection, identity)) {
      this.markReauthorizationRequiredIfCurrent(connection.id, state, generation)
      throw new ExternalKnowledgeRuntimeError('reauthorization-required')
    }
    const current = await this.readCredential(connection, { state, generation })
    this.assertCredentialGeneration(state, generation)
    const validated = { ...identity, grantedScopes: current.grantedScopes }
    return connection.authorizationStatus === 'pending-authorization'
      ? this.connections.markConnected(connection.id, validated)
      : this.connections.markValidated(connection.id, validated)
  }

  private async readStoredApplicationCredentials(
    connection: ExternalKnowledgeConnection,
    expected?: { state: CredentialRuntimeState; generation: number }
  ): Promise<ResolvedApplicationCredentials> {
    const stored = await this.readCredential(connection, expected)
    return {
      source: connection.appCredentialSource,
      credentials: {
        appId: stored.appId,
        appSecret: stored.appSecret,
        applicationSnapshot: stored.applicationSnapshot
      },
      applicationName: connection.applicationName ?? undefined
    }
  }

  private async resolveApplicationCredentials(
    input: BeginUserAuthorizationInput
  ): Promise<ResolvedApplicationCredentials> {
    if (input.kind === 'saved-application') {
      const stored = await this.credentials.readApplication(input.applicationCredentialId)
      this.applicationIds.set(input.applicationCredentialId, stored.appId)
      return {
        source: input.source ?? 'custom-app',
        credentials: {
          appId: stored.appId,
          appSecret: stored.appSecret,
          applicationSnapshot: stored.applicationSnapshot
        },
        applicationName: stored.applicationName
      }
    }
    if (input.kind === 'custom-app') {
      return {
        source: 'custom-app',
        credentials: { appId: input.appId, appSecret: input.appSecret },
        applicationName: input.applicationName
      }
    }

    throw new ExternalKnowledgeRuntimeError('authorization-failed')
  }

  private assertScopes(
    grantedScopes: readonly string[],
    source: ExternalKnowledgeConnection['appCredentialSource']
  ): void {
    if (missingKnowledgeScopes(grantedScopes).length > 0) {
      throw new ExternalKnowledgeRuntimeError('scope-missing')
    }
    if (source === 'personal-agent' && grantedScopes.some((scope) => !FEISHU_AUTOMATIC_ALLOWED_SCOPES.has(scope))) {
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

  private assertReconnectIdentity(connection: ExternalKnowledgeConnection, identity: FeishuUserIdentity): void {
    const neverAuthorized =
      connection.authorizedAt === null &&
      connection.lastValidatedAt === null &&
      connection.accountUserId === null &&
      connection.accountOpenId === null &&
      connection.accountUnionId === null &&
      connection.tenantKey === null &&
      connection.displayName === null &&
      connection.avatarUrl === null &&
      connection.grantedScopes.length === 0
    if (neverAuthorized && identity.accountUserId) return
    if (!connection.accountUserId || !identity.accountUserId) {
      throw new ExternalKnowledgeRuntimeError('identity-unverifiable')
    }
    if (connection.tenantKey !== identity.tenantKey || connection.accountUserId !== identity.accountUserId) {
      throw new ExternalKnowledgeRuntimeError('identity-conflict')
    }
  }

  private identityChanged(connection: ExternalKnowledgeConnection, identity: FeishuUserIdentity): boolean {
    return connection.accountUserId !== identity.accountUserId || connection.tenantKey !== identity.tenantKey
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

  private markReauthorizationRequiredIfCurrent(
    connectionId: string,
    state: CredentialRuntimeState,
    generation: number
  ): void {
    if (this.isCurrentCredentialGeneration(state, generation)) {
      this.markReauthorizationRequired(connectionId)
    }
  }

  private authorizationError(error: unknown): ExternalKnowledgeRuntimeError {
    if (error instanceof FeishuProviderError && error.code === 'app-scope-missing') {
      return new ExternalKnowledgeRuntimeError('scope-missing')
    }
    if (error instanceof FeishuProviderError && error.code === 'reauthorization-required') {
      return new ExternalKnowledgeRuntimeError('reauthorization-required')
    }
    if (error instanceof FeishuProviderError && error.code === 'identity-unverifiable') {
      return new ExternalKnowledgeRuntimeError('identity-unverifiable')
    }
    return new ExternalKnowledgeRuntimeError('authorization-failed')
  }

  private assertAccepting(): void {
    if (!this.accepting) throw new ExternalKnowledgeRuntimeError('stopped')
  }

  private getCredentialState(credentialReference: string): CredentialRuntimeState {
    const existing = this.credentialStates.get(credentialReference)
    if (existing) {
      if (existing.phase === 'removing') throw new ExternalKnowledgeRuntimeError('not-found')
      return existing
    }
    const state: CredentialRuntimeState = {
      phase: 'active',
      generation: 0,
      controller: new AbortController(),
      nextAllowedAt: 0,
      endpointNextAllowedAt: new Map()
    }
    this.credentialStates.set(credentialReference, state)
    return state
  }

  private advanceCredentialGeneration(credentialReference: string, state: CredentialRuntimeState): number {
    state.controller.abort()
    state.controller = new AbortController()
    state.generation++
    state.refreshFlight = undefined
    state.validationFlight = undefined
    state.validatedGeneration = undefined
    state.requestTail = undefined
    state.nextAllowedAt = 0
    state.endpointNextAllowedAt.clear()
    for (const [sessionId, session] of this.authorizationSessions) {
      if (session.stateCredentialReference !== credentialReference) continue
      this.authorizationSessions.delete(sessionId)
      this.clearSessionExpiry(session)
      session.controller.abort()
    }
    return state.generation
  }

  private scheduleSessionExpiry(expiresAt: number, expire: () => void): ReturnType<typeof setTimeout> {
    const timer = setTimeout(expire, Math.max(0, expiresAt - this.now()))
    timer.unref()
    return timer
  }

  private clearSessionExpiry(session: { expiryTimer?: ReturnType<typeof setTimeout> }): void {
    if (session.expiryTimer) clearTimeout(session.expiryTimer)
    session.expiryTimer = undefined
  }

  private isCurrentCredentialGeneration(state: CredentialRuntimeState, generation: number): boolean {
    return state.phase === 'active' && state.generation === generation && !state.controller.signal.aborted
  }

  private assertCredentialGeneration(state: CredentialRuntimeState, generation: number): void {
    if (!this.isCurrentCredentialGeneration(state, generation)) {
      throw new DOMException('External Knowledge credential operation was superseded', 'AbortError')
    }
  }

  private credentialSignal(state: CredentialRuntimeState, upstreamSignal?: AbortSignal): AbortSignal {
    return AbortSignal.any([this.lifetime.signal, state.controller.signal, ...(upstreamSignal ? [upstreamSignal] : [])])
  }

  private async waitForCredentialBackoff(state: CredentialRuntimeState, signal: AbortSignal): Promise<void> {
    const waitMs = state.nextAllowedAt - this.now()
    if (waitMs > 0) await this.sleep(waitMs, signal)
  }

  private async runCredentialRequest<T>(
    state: CredentialRuntimeState,
    generation: number,
    signal: AbortSignal,
    operation: () => Promise<T>,
    budget?: EndpointBudget
  ): Promise<T> {
    for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt++) {
      await this.waitForCredentialBackoff(state, signal)
      if (budget) {
        const endpointWaitMs = (state.endpointNextAllowedAt.get(budget.key) ?? 0) - this.now()
        if (endpointWaitMs > 0) await this.sleep(endpointWaitMs, signal)
      }
      this.assertCredentialGeneration(state, generation)
      if (budget) {
        state.endpointNextAllowedAt.set(budget.key, this.now() + budget.minimumIntervalMs)
      }
      try {
        const result = await operation()
        this.assertCredentialGeneration(state, generation)
        return result
      } catch (error) {
        this.assertCredentialGeneration(state, generation)
        if (!(error instanceof FeishuProviderError) || error.code !== 'transient') throw error
        const backoffMs = error.retryAfterMs ?? 500 * 2 ** (attempt - 1)
        state.nextAllowedAt = Math.max(state.nextAllowedAt, this.now() + backoffMs)
        if (attempt === MAX_REQUEST_ATTEMPTS) throw error
      }
    }
    throw new ExternalKnowledgeRuntimeError('authorization-failed')
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
