import { randomUUID } from 'node:crypto'

import { delay } from 'es-toolkit'

import {
  type CommitExternalKnowledgeReauthorizationInput,
  externalKnowledgeConnectionService
} from '@data/services/ExternalKnowledgeConnectionService'
import { loggerService } from '@logger'
import { registrationBegin, registrationPoll } from '@main/services/feishuAppRegistration'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'
import type { FeishuExternalKnowledgeScope } from '@shared/data/types/externalKnowledge'
import type { ExternalKnowledgeConnection } from '@shared/data/types/externalKnowledgeConnection'
import type {
  ExternalKnowledgeDocumentRead,
  ExternalKnowledgeScopePreview,
  ExternalKnowledgeScopeResolution
} from '@shared/data/types/externalKnowledgeRead'

import {
  externalKnowledgeCredentialStore,
  type ExternalKnowledgeCredential,
  type ExternalKnowledgeCredentialReferenceListResult,
  type ExternalKnowledgeCredentialReadResult,
  type ExternalKnowledgeTokenSet,
  type TokenRotationResult
} from './ExternalKnowledgeCredentialStore'
import {
  beginDeviceAuthorization,
  exchangeDeviceAuthorization,
  FEISHU_AUTOMATIC_ALLOWED_SCOPES,
  FEISHU_READ_ENDPOINT_BUDGETS,
  FEISHU_REQUIRED_USER_SCOPES,
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
  scanFeishuKnowledgeSource,
  type FeishuKnowledgeReadOperations,
  type FeishuKnowledgeReference,
  type FeishuKnowledgeSourceScanResult
} from './feishuKnowledgeReadAdapter'

const ACCESS_TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000
const MAX_REQUEST_ATTEMPTS = 3
const logger = loggerService.withContext('ExternalKnowledgeRuntime')

function logAuthorizationFailure(stage: 'begin' | 'complete', error: unknown): void {
  if (!(error instanceof FeishuProviderError)) return
  logger.warn('Feishu authorization failed', { stage, category: error.code, ...error.diagnostics })
}

type ConnectionStore = Pick<
  typeof externalKnowledgeConnectionService,
  | 'list'
  | 'getById'
  | 'create'
  | 'markConnected'
  | 'markValidated'
  | 'markReauthorizationRequired'
  | 'commitReauthorization'
  | 'remove'
  | 'assertUnreferenced'
  | 'removeUnreferenced'
>

type CredentialStore = {
  assertAvailable(): void
  listReferences(): Promise<ExternalKnowledgeCredentialReferenceListResult>
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
  getWikiNode(
    accessToken: string,
    input: { token: string; objType: 'wiki' | 'docx' },
    signal?: AbortSignal
  ): Promise<FeishuWikiNode>
  listWikiChildNodes(
    accessToken: string,
    spaceId: string,
    parentNodeToken?: string,
    pageToken?: string,
    signal?: AbortSignal
  ): Promise<FeishuWikiNodePage>
  getDocxMarkdown(accessToken: string, documentToken: string, signal?: AbortSignal): Promise<string>
}

type Registration = {
  begin: typeof registrationBegin
  poll: typeof registrationPoll
}

type Sleep = (milliseconds: number, signal?: AbortSignal) => Promise<void>

export type ExternalKnowledgeRuntimeHooks = {
  onReauthorizationRequired?(connectionId: string): void
}

export type ExternalKnowledgeReauthorizationCommit = {
  connection: ExternalKnowledgeConnection
  afterCommit(): void
}

type RuntimeOptions = {
  connections?: ConnectionStore
  credentials?: CredentialStore
  provider?: Provider
  registration?: Registration
  now?: () => number
  sleep?: Sleep
  hooks?: ExternalKnowledgeRuntimeHooks
  commitReauthorization?(
    connectionId: string,
    input: CommitExternalKnowledgeReauthorizationInput
  ): ExternalKnowledgeReauthorizationCommit
}

type RegistrationSession = {
  controller: AbortController
  poll: Promise<{ appId: string; appSecret: string }>
  claimed: boolean
  expiryTimer?: ReturnType<typeof setTimeout>
}

type ResolvedApplicationCredentials = {
  source: ExternalKnowledgeConnection['appCredentialSource']
  credentials: FeishuApplicationCredentials
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
  credentials: FeishuApplicationCredentials
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
  accessToken: string
  connection: ExternalKnowledgeConnection
  signal: AbortSignal
  request<T>(budget: EndpointBudget, operation: () => Promise<T>): Promise<T>
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

const defaultRegistration: Registration = { begin: registrationBegin, poll: registrationPoll }

export class ExternalKnowledgeRuntime {
  private readonly connections: ConnectionStore
  private readonly credentials: CredentialStore
  private readonly provider: Provider
  private readonly registration: Registration
  private readonly now: () => number
  private readonly sleep: Sleep
  private readonly hooks: ExternalKnowledgeRuntimeHooks
  private readonly commitReauthorization: NonNullable<RuntimeOptions['commitReauthorization']>
  private lifetime = new AbortController()
  private accepting = false
  private readonly registrationSessions = new Map<string, RegistrationSession>()
  private readonly authorizationSessions = new Map<string, AuthorizationSession>()
  private readonly credentialStates = new Map<string, CredentialRuntimeState>()
  private readonly inFlight = new Set<Promise<unknown>>()
  private startFlight?: Promise<void>

  constructor(options: RuntimeOptions = {}) {
    this.connections = options.connections ?? externalKnowledgeConnectionService
    this.credentials = options.credentials ?? externalKnowledgeCredentialStore
    this.provider = options.provider ?? defaultProvider
    this.registration = options.registration ?? defaultRegistration
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? ((milliseconds, signal) => delay(milliseconds, { signal }))
    this.hooks = options.hooks ?? {}
    this.commitReauthorization =
      options.commitReauthorization ??
      ((connectionId, input) => ({
        connection: this.connections.commitReauthorization(connectionId, input),
        afterCommit: () => undefined
      }))
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
    for (const session of this.registrationSessions.values()) {
      this.clearSessionExpiry(session)
      session.controller.abort()
    }
    for (const session of this.authorizationSessions.values()) {
      this.clearSessionExpiry(session)
      session.controller.abort()
    }
    this.registrationSessions.clear()
    this.authorizationSessions.clear()
    await Promise.allSettled([...(startFlight ? [startFlight] : []), ...this.inFlight])
    this.credentialStates.clear()
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
            userScopes: [...FEISHU_REQUIRED_USER_SCOPES]
          }
        }
      })
    )
    this.assertAccepting()
    const registrationSessionId = randomUUID()
    const poll = this.track(
      this.registration.poll('feishu', begun.deviceCode, {
        interval: begun.interval,
        expiresIn: begun.expiresIn,
        signal
      })
    )
    void poll.catch(() => undefined)
    const expiresAt = this.now() + begun.expiresIn * 1000
    const session: RegistrationSession = { controller, poll, claimed: false }
    this.registrationSessions.set(registrationSessionId, session)
    session.expiryTimer = this.scheduleSessionExpiry(expiresAt, () => {
      if (this.registrationSessions.get(registrationSessionId) !== session) return
      this.registrationSessions.delete(registrationSessionId)
      session.controller.abort()
    })
    return {
      registrationSessionId,
      verificationUri: begun.verificationUri,
      expiresAt: new Date(expiresAt).toISOString()
    }
  }

  async cancelAppRegistration(registrationSessionId: string): Promise<void> {
    const session = this.registrationSessions.get(registrationSessionId)
    if (!session) return
    this.registrationSessions.delete(registrationSessionId)
    this.clearSessionExpiry(session)
    session.controller.abort()
    await Promise.allSettled([session.poll])
  }

  async beginUserAuthorization(input: BeginUserAuthorizationInput): Promise<BeginAuthorizationResult> {
    this.assertAccepting()
    const applicationCredentials = await this.resolveApplicationCredentials(input)
    this.assertAccepting()

    return await this.track(
      this.beginAuthorization({
        appCredentialSource: applicationCredentials.source,
        appCredentials: applicationCredentials.credentials,
        applicationName: applicationCredentials.applicationName,
        initial: true
      })
    )
  }

  async beginReconnect(
    connectionId: string,
    replacement?: BeginUserAuthorizationInput
  ): Promise<BeginAuthorizationResult> {
    this.assertAccepting()
    let connection = this.requireConnection(connectionId)
    const state = this.getCredentialState(connection.credentialReference)
    const currentGeneration = state.generation
    const applicationCredentials = replacement
      ? await this.resolveApplicationCredentials(replacement)
      : await this.readStoredApplicationCredentials(connection, { state, generation: currentGeneration })
    this.assertAccepting()
    this.assertCredentialGeneration(state, currentGeneration)
    connection = this.requireConnection(connectionId)
    if (connection.authorizationStatus !== 'reauthorization-required') {
      this.markReauthorizationRequired(connectionId)
      connection = this.requireConnection(connectionId)
    }
    const generation = this.advanceCredentialGeneration(connection.credentialReference, state)
    return await this.track(
      this.beginAuthorization({
        appCredentialSource: applicationCredentials.source,
        appCredentials: applicationCredentials.credentials,
        applicationName: applicationCredentials.applicationName,
        initial: false,
        connection,
        generation
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
    if (state && this.isCurrentCredentialGeneration(state, session.generation)) {
      this.advanceCredentialGeneration(session.stateCredentialReference, state)
    }
    if (session.completion) await Promise.allSettled([session.completion])
    if (!session.candidateCommitted) {
      try {
        await this.credentials.remove(session.candidateCredentialReference)
      } catch {
        // Startup reconciliation retries orphan cleanup.
      }
    }
    if (session.initial && !session.candidateCommitted) {
      this.connections.remove(session.connectionId)
      this.credentialStates.delete(session.stateCredentialReference)
    }
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
    reference: FeishuKnowledgeReference,
    signal?: AbortSignal
  ): Promise<ExternalKnowledgeDocumentRead> {
    return await this.runAuthorizedRead(
      connectionId,
      async (context) => readFeishuDocx(reference, this.feishuReadOperations(context), context.signal),
      signal
    )
  }

  async scanFeishuSource(
    connectionId: string,
    input: { spaceId: string; scope: FeishuExternalKnowledgeScope },
    signal?: AbortSignal
  ): Promise<FeishuKnowledgeSourceScanResult> {
    return await this.runAuthorizedRead(
      connectionId,
      async (context) => scanFeishuKnowledgeSource(input, this.feishuReadOperations(context), context.signal),
      signal
    )
  }

  private async runAuthorizedRead<T>(
    connectionId: string,
    operation: (context: AuthorizedReadContext) => Promise<T>,
    callerSignal?: AbortSignal
  ): Promise<T> {
    this.assertAccepting()
    const connection = this.requireConnection(connectionId)
    const state = this.getCredentialState(connection.credentialReference)
    const generation = state.generation
    const assertCurrent = () => this.assertCredentialGeneration(state, generation)
    const previous = state.requestTail ?? Promise.resolve()
    const signal = this.credentialSignal(state, callerSignal)
    const task = previous
      .catch(() => undefined)
      .then(async () => {
        assertCurrent()
        signal.throwIfAborted()
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
          return await operation({
            accessToken,
            connection: validatedConnection,
            signal,
            request: (budget, request) => this.runCredentialRequest(state, generation, signal, request, budget)
          })
        } catch (error) {
          if (callerSignal?.aborted) throw callerSignal.reason ?? error
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
    return await this.awaitCallerSignal(this.track(task), callerSignal)
  }

  private async awaitCallerSignal<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return await task
    signal.throwIfAborted()
    return await new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        signal.removeEventListener('abort', onAbort)
      }
      const onAbort = () => {
        cleanup()
        reject(signal.reason)
      }
      signal.addEventListener('abort', onAbort, { once: true })
      void task.then(
        (value) => {
          cleanup()
          resolve(value)
        },
        (error) => {
          cleanup()
          reject(error)
        }
      )
    })
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
          this.provider.getWikiNode(context.accessToken, { token, objType }, signal ?? context.signal)
        ),
      listChildNodes: (spaceId, parentNodeToken, pageToken, signal) =>
        context.request(FEISHU_READ_ENDPOINT_BUDGETS.listWikiNodes, () =>
          this.provider.listWikiChildNodes(
            context.accessToken,
            spaceId,
            parentNodeToken,
            pageToken,
            signal ?? context.signal
          )
        ),
      getDocumentMarkdown: (documentToken, signal) =>
        context.request(FEISHU_READ_ENDPOINT_BUDGETS.getDocxMarkdown, () =>
          this.provider.getDocxMarkdown(context.accessToken, documentToken, signal ?? context.signal)
        )
    }
  }

  private readOperationError(
    error: unknown,
    connectionId: string,
    state: CredentialRuntimeState,
    generation: number
  ): unknown {
    if (error instanceof FeishuKnowledgeReadError) {
      logger.warn('Feishu knowledge read failed', { origin: 'adapter', category: error.code })
      return new ExternalKnowledgeRuntimeError(error.code)
    }
    if (!(error instanceof FeishuProviderError)) return error
    logger.warn('Feishu knowledge read failed', { origin: 'provider', category: error.code, ...error.diagnostics })
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
    appCredentials: FeishuApplicationCredentials
    applicationName?: string
    initial: boolean
    connection?: ExternalKnowledgeConnection
    generation?: number
  }): Promise<BeginAuthorizationResult> {
    this.credentials.assertAvailable()
    const controller = new AbortController()
    const candidateCredentialReference = `feishu:${randomUUID()}`
    const expectedCredentialReference = input.connection?.credentialReference ?? null
    const stateCredentialReference = expectedCredentialReference ?? candidateCredentialReference
    const state = this.getCredentialState(stateCredentialReference)
    const generation = input.generation ?? this.advanceCredentialGeneration(stateCredentialReference, state)
    this.assertCredentialGeneration(state, generation)
    const signal = AbortSignal.any([this.lifetime.signal, state.controller.signal, controller.signal])
    let connection = input.connection

    try {
      const device: FeishuDeviceAuthorization = await this.runCredentialRequest(state, generation, signal, () =>
        this.provider.beginDeviceAuthorization(input.appCredentials, signal)
      )
      this.assertCredentialGeneration(state, generation)

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
      logAuthorizationFailure('begin', error)
      try {
        await this.credentials.remove(candidateCredentialReference)
      } catch {
        // Startup reconciliation retries orphan cleanup.
      } finally {
        if (input.initial && !connection) this.credentialStates.delete(stateCredentialReference)
      }
      throw error
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
          if (error.terminal) {
            logAuthorizationFailure('complete', error)
            this.markReauthorizationRequiredIfCurrent(session.connectionId, state, session.generation)
            throw this.authorizationError(error)
          }
          throw error
        }

        this.assertCredentialGeneration(state, session.generation)
        this.assertScopes(token.grantedScopes, session.appCredentialSource, session.connectionId, {
          state,
          generation: session.generation
        })
        const identity = await this.runCredentialRequest(state, session.generation, signal, () =>
          this.provider.getUserIdentity(token.accessToken, signal)
        )
        this.assertCredentialGeneration(state, session.generation)
        const connection = this.requireConnection(session.connectionId)
        if (!session.initial) this.assertMatchingIdentity(connection, identity)
        await this.credentials.put(session.candidateCredentialReference, {
          ...session.credentials,
          ...this.absoluteTokens(token)
        })
        this.assertCredentialGeneration(state, session.generation)
        let connected: ExternalKnowledgeConnection
        let afterCommit: () => void = () => undefined
        if (session.initial) {
          connected = this.connections.markConnected(session.connectionId, {
            ...identity,
            grantedScopes: token.grantedScopes
          })
        } else {
          const commit = this.commitReauthorization(session.connectionId, {
            expectedCredentialReference: session.expectedCredentialReference!,
            candidateCredentialReference: session.candidateCredentialReference,
            appId: session.credentials.appId,
            appCredentialSource: session.appCredentialSource,
            applicationName: session.applicationName,
            identity: { ...identity, grantedScopes: token.grantedScopes }
          })
          connected = commit.connection
          afterCommit = commit.afterCommit
        }
        session.candidateCommitted = true
        if (session.expectedCredentialReference) {
          this.rekeyCredentialState(
            session.expectedCredentialReference,
            session.candidateCredentialReference,
            state,
            session.generation
          )
        }
        state.validatedGeneration = session.generation
        afterCommit()
        if (session.expectedCredentialReference) {
          await this.retireCredential(session.expectedCredentialReference, signal)
        }
        return connected
      }
      this.markReauthorizationRequiredIfCurrent(session.connectionId, state, session.generation)
      throw new ExternalKnowledgeRuntimeError('authorization-failed')
    } catch (error) {
      logAuthorizationFailure('complete', error)
      if (error instanceof FeishuProviderError && error.terminal) {
        this.markReauthorizationRequiredIfCurrent(session.connectionId, state, session.generation)
        error = this.authorizationError(error)
      }
      if (!session.candidateCommitted) {
        try {
          await this.credentials.remove(session.candidateCredentialReference)
        } catch {
          // Startup reconciliation retries orphan cleanup.
        }
      }
      throw error
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
      this.assertScopes(token.grantedScopes, connection.appCredentialSource, connection.id, { state, generation })
      const rotation = await this.credentials.rotateTokens(
        connection.credentialReference,
        stored.refreshToken!,
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
      // Startup reconciliation retries orphan cleanup.
    }
  }

  private async reconcileConnections(): Promise<void> {
    const connections = this.connections.list()
    const referenced = new Set(connections.map((connection) => connection.credentialReference))
    for (const connection of connections) {
      if (connection.authorizationStatus === 'reauthorization-required') continue
      const stored = await this.credentials.read(connection.credentialReference)
      if (stored.status !== 'ok' || stored.credential.appId !== connection.appId) {
        this.markReauthorizationRequired(connection.id)
        continue
      }
      if (!stored.credential.refreshToken || (stored.credential.refreshTokenExpiresAt ?? 0) <= this.now()) {
        this.markReauthorizationRequired(connection.id)
        continue
      }
      try {
        this.assertScopes(stored.credential.grantedScopes, connection.appCredentialSource, connection.id)
      } catch (error) {
        if (error instanceof ExternalKnowledgeRuntimeError) {
          this.markReauthorizationRequired(connection.id)
        }
      }
    }

    const references = await this.credentials.listReferences()
    if (references.status !== 'ok') return
    for (const credentialReference of references.credentialReferences) {
      if (!referenced.has(credentialReference)) await this.credentials.remove(credentialReference)
    }
  }

  private async readCredential(
    connection: ExternalKnowledgeConnection,
    expected?: { state: CredentialRuntimeState; generation: number }
  ): Promise<ExternalKnowledgeCredential> {
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
    const identity = await this.runCredentialRequest(state, generation, signal, () =>
      this.provider.getUserIdentity(accessToken, signal)
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
      credentials: { appId: stored.appId, appSecret: stored.appSecret },
      applicationName: connection.applicationName ?? undefined
    }
  }

  private async resolveApplicationCredentials(
    input: BeginUserAuthorizationInput
  ): Promise<ResolvedApplicationCredentials> {
    if (input.kind === 'custom-app') {
      return {
        source: 'custom-app',
        credentials: { appId: input.appId, appSecret: input.appSecret },
        applicationName: input.applicationName
      }
    }

    const registration = this.registrationSessions.get(input.registrationSessionId)
    if (!registration || registration.claimed) throw new ExternalKnowledgeRuntimeError('session-not-found')
    registration.claimed = true
    try {
      return {
        source: 'personal-agent',
        credentials: await registration.poll,
        applicationName: 'Cherry Studio Knowledge'
      }
    } catch (error) {
      throw this.authorizationError(error)
    } finally {
      this.clearSessionExpiry(registration)
      if (this.registrationSessions.get(input.registrationSessionId) === registration) {
        this.registrationSessions.delete(input.registrationSessionId)
      }
    }
  }

  private assertScopes(
    grantedScopes: readonly string[],
    source: ExternalKnowledgeConnection['appCredentialSource'],
    connectionId: string,
    expected?: { state: CredentialRuntimeState; generation: number }
  ): void {
    if (missingKnowledgeScopes(grantedScopes).length > 0) {
      if (expected) {
        this.markReauthorizationRequiredIfCurrent(connectionId, expected.state, expected.generation)
      } else {
        this.markReauthorizationRequired(connectionId)
      }
      throw new ExternalKnowledgeRuntimeError('scope-missing')
    }
    if (source === 'personal-agent' && grantedScopes.some((scope) => !FEISHU_AUTOMATIC_ALLOWED_SCOPES.has(scope))) {
      if (expected) {
        this.markReauthorizationRequiredIfCurrent(connectionId, expected.state, expected.generation)
      } else {
        this.markReauthorizationRequired(connectionId)
      }
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

  private assertMatchingIdentity(connection: ExternalKnowledgeConnection, identity: FeishuUserIdentity): void {
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
      this.hooks.onReauthorizationRequired?.(connectionId)
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
      signal.throwIfAborted()
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
