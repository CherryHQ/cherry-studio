import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { cherryCloudSessionService } from '@data/services/CherryCloudSessionService'
import { modelService } from '@data/services/ModelService'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import {
  CHERRY_CLOUD_MODEL_GROUP,
  CHERRYAI_DEFAULT_MODEL_ID,
  CHERRYAI_PROVIDER_ID
} from '@shared/data/presets/cherryai'
import { createUniqueModelId, ENDPOINT_TYPE, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { CherryCloudStatus } from '@shared/ipc/schemas/cherryCloud'
import { app, net, shell } from 'electron'
import type { ZodType } from 'zod'

import { CherryCloudLoopbackCallback } from './CherryCloudLoopbackCallback'
import {
  accountSnapshotSchema,
  cloudModelListSchema,
  createDesktopAuthorizationResponseSchema,
  exchangeDesktopAuthorizationResponseSchema,
  refreshProductSessionResponseSchema
} from './contracts'
import { createAuthorizationSecrets, createDeviceKeyPair, createDeviceSignature, createIdempotencyKey } from './crypto'

const logger = loggerService.withContext('CherryCloudService')
const DEVELOPMENT_API_ORIGIN = 'http://127.0.0.1:8084'
const PRODUCTION_API_ORIGIN = 'https://cloud.cherryai.com.cn'
const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000
const CLOUD_CONTROL_REQUEST_TIMEOUT_MS = 30_000
const CLOUD_MODEL_SYNC_CACHE_TTL_MS = 60_000

type CherryCloudRequestInit = Omit<RequestInit, 'body'> & { body?: string }
type CherryCloudDevice = ReturnType<typeof createDeviceKeyPair>
type AuthorizationOperation = {
  controller: AbortController
  cancelled: boolean
}
type PendingAuthorization = {
  authorizationId: string
  state: string
  codeVerifier: string
  expiresAt: string
  operation: AuthorizationOperation
}
type ProductSession = {
  accessToken: string
  accessExpiresAt: number
  refreshToken: string
  sessionId: string
  sessionExpiresAt: number
  deviceId: string
  accountId: string
  displayName: string | null
}
type CherryCloudState = {
  device: CherryCloudDevice | null
  pending: PendingAuthorization | null
  session: ProductSession | null
}
type CloudModelSyncResult = {
  modelCount: number
  quotaExhaustedModelIds: UniqueModelId[]
}

function emptyState(): CherryCloudState {
  return { device: null, pending: null, session: null }
}

function resolveApiOrigin(): string {
  return app.isPackaged ? PRODUCTION_API_ORIGIN : DEVELOPMENT_API_ORIGIN
}

function platformName(): 'darwin' | 'windows' | 'linux' {
  if (process.platform === 'darwin' || process.platform === 'linux') return process.platform
  if (process.platform === 'win32') return 'windows'
  throw new Error(`Cherry Cloud login is not supported on ${process.platform}`)
}

function accessExpiresAt(expiresIn: number): number {
  return Date.now() + expiresIn * 1000
}

export class CherryCloudLoginUnavailableError extends Error {
  constructor() {
    super('Cherry Cloud login service is unavailable')
    this.name = 'CherryCloudLoginUnavailableError'
  }
}

class CherryCloudSessionRequiredError extends Error {
  constructor() {
    super('Cherry Cloud account is not signed in')
    this.name = 'CherryCloudSessionRequiredError'
  }
}

@Injectable('CherryCloudService')
@ServicePhase(Phase.WhenReady)
export class CherryCloudService extends BaseService {
  private cloudState = emptyState()
  private lifecycleGeneration = 0
  private authorizationOperation: AuthorizationOperation | null = null
  private loginPromise: Promise<CherryCloudStatus> | null = null
  private refreshPromise: { session: ProductSession; promise: Promise<ProductSession> } | null = null
  private modelSyncPromise: {
    controller: AbortController
    generation: number
    promise: Promise<CloudModelSyncResult>
  } | null = null
  private modelSyncCache: {
    generation: number
    syncedAt: number
    result: CloudModelSyncResult
  } | null = null
  private sessionGeneration = 0
  private loopbackCallback: CherryCloudLoopbackCallback | null = null
  private pendingExpiryTimer: ReturnType<typeof setTimeout> | null = null
  private sessionExpiryTimer: ReturnType<typeof setTimeout> | null = null
  private exchangePromise: {
    authorizationId: string
    state: string
    promise: Promise<void>
  } | null = null

  protected async onInit(): Promise<void> {
    this.lifecycleGeneration += 1
    this.registerDisposable(() => {
      this.authorizationOperation?.controller.abort()
      this.authorizationOperation = null
      this.invalidateModelSync()
      this.loopbackCallback?.dispose()
      this.loopbackCallback = null
      this.clearPendingExpiryTimer()
      this.clearSessionExpiryTimer()
    })
    await this.restoreSession()
    if (this.cloudState.session) void this.syncEntitledModels().catch(() => undefined)
  }

  protected onStop(): void {
    this.lifecycleGeneration += 1
    this.authorizationOperation?.controller.abort()
    this.authorizationOperation = null
    this.loginPromise = null
    this.exchangePromise = null
    this.refreshPromise = null
    this.invalidateModelSync()
    const pending = this.cloudState.pending
    if (pending) this.clearPendingAuthorization(pending)
    this.clearSessionExpiryTimer()
    if (this.cloudState.session) this.sessionGeneration += 1
    this.cloudState = emptyState()
  }

  public async getStatus(): Promise<CherryCloudStatus> {
    await this.pruneExpiredState()
    return this.currentStatus()
  }

  public getApiOrigin(): string {
    return resolveApiOrigin()
  }

  public async startLogin(): Promise<CherryCloudStatus> {
    if (this.loginPromise) return this.loginPromise
    if (this.authorizationOperation) return this.getStatus()

    const operation = { controller: new AbortController(), cancelled: false }
    this.authorizationOperation = operation
    const login = this.createLogin(operation)
      .catch((error) => {
        if (operation.cancelled) return this.currentStatus()
        throw error
      })
      .finally(() => {
        if (this.loginPromise === login) this.loginPromise = null
        if (this.authorizationOperation === operation && !this.cloudState.pending) {
          this.authorizationOperation = null
        }
      })
    this.loginPromise = login
    return login
  }

  public async cancelLogin(): Promise<CherryCloudStatus> {
    const operation = this.authorizationOperation
    if (!operation) return this.getStatus()

    const login = this.loginPromise
    const exchange = this.exchangePromise?.promise
    operation.cancelled = true
    operation.controller.abort()
    if (this.authorizationOperation === operation) this.authorizationOperation = null
    this.loopbackCallback?.dispose()
    this.loopbackCallback = null
    const pending = this.cloudState.pending
    if (pending?.operation === operation) this.clearPendingAuthorization(pending)

    await Promise.allSettled([login, exchange])
    return this.currentStatus()
  }

  private async createLogin(operation: AuthorizationOperation): Promise<CherryCloudStatus> {
    const lifecycleGeneration = this.lifecycleGeneration
    const current = await this.getStatus()
    this.assertLifecycleGeneration(lifecycleGeneration)
    this.assertAuthorizationOperation(operation)
    if (current.phase !== 'signed-out') return current

    const device = this.cloudState.device ?? createDeviceKeyPair()
    const secrets = createAuthorizationSecrets()
    const loopbackCallback = await this.openLoopbackCallback(lifecycleGeneration, operation)
    if (this.lifecycleGeneration !== lifecycleGeneration) {
      loopbackCallback.dispose()
      if (this.loopbackCallback === loopbackCallback) this.loopbackCallback = null
      this.assertLifecycleGeneration(lifecycleGeneration)
    }
    let pending: PendingAuthorization | null = null

    try {
      const created = await this.postJson(
        '/api/v1/desktop/authorizations',
        {
          state: secrets.state,
          code_challenge: secrets.codeChallenge,
          code_challenge_method: 'S256',
          device_public_key: device.publicKey,
          platform: platformName(),
          client_version: app.getVersion().replace(/^v/, ''),
          ...(loopbackCallback ? { callback_port: loopbackCallback.port } : {})
        },
        createDesktopAuthorizationResponseSchema,
        operation.controller.signal
      )
      this.assertLifecycleGeneration(lifecycleGeneration)
      this.assertAuthorizationOperation(operation)
      loopbackCallback.setExpiresAt(created.expires_at)
      pending = {
        authorizationId: created.authorization_id,
        state: secrets.state,
        codeVerifier: secrets.codeVerifier,
        expiresAt: created.expires_at,
        operation
      }
      this.cloudState = { ...this.cloudState, device, pending }
      this.schedulePendingExpiry(pending)
      this.emitStatus()

      await shell.openExternal(created.authorization_url)
      this.assertLifecycleGeneration(lifecycleGeneration)
      this.assertAuthorizationOperation(operation)
    } catch (error) {
      loopbackCallback.dispose()
      if (this.loopbackCallback === loopbackCallback) this.loopbackCallback = null
      if (pending) this.clearPendingAuthorization(pending)
      else {
        operation.controller.abort()
        if (this.authorizationOperation === operation) this.authorizationOperation = null
      }
      this.assertLifecycleGeneration(lifecycleGeneration)
      throw error
    }

    return this.currentStatus()
  }

  private async openLoopbackCallback(
    lifecycleGeneration: number,
    operation: AuthorizationOperation
  ): Promise<CherryCloudLoopbackCallback> {
    this.loopbackCallback?.dispose()
    const receiver = await CherryCloudLoopbackCallback.open(async (url) => {
      await this.handleCallback(url)
      if (this.loopbackCallback === receiver) this.loopbackCallback = null
    }, resolveApiOrigin())
    if (this.lifecycleGeneration !== lifecycleGeneration) {
      receiver.dispose()
      this.assertLifecycleGeneration(lifecycleGeneration)
    }
    if (!this.isAuthorizationOperationActive(operation)) {
      receiver.dispose()
      throw new Error('Cherry Cloud authorization is no longer active')
    }
    this.loopbackCallback = receiver
    return receiver
  }

  public async handleCallback(url: URL): Promise<void> {
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/cloud-auth/callback') {
      throw new Error('Invalid Cherry Cloud callback')
    }

    const pending = this.cloudState.pending
    const authorizationId = url.searchParams.get('authorization_id')
    const callbackState = url.searchParams.get('state')
    if (!pending || authorizationId !== pending.authorizationId || callbackState !== pending.state) {
      throw new Error('Cherry Cloud callback does not match an active authorization')
    }

    if (
      this.exchangePromise?.authorizationId === pending.authorizationId &&
      this.exchangePromise.state === pending.state
    ) {
      return this.exchangePromise.promise
    }

    if (Date.parse(pending.expiresAt) <= Date.now()) {
      this.clearPendingAuthorization(pending)
      throw new Error('Cherry Cloud authorization has expired')
    }

    if (url.searchParams.has('error')) {
      this.clearPendingAuthorization(pending)
      return
    }

    const handoffCode = url.searchParams.get('handoff_code')
    if (!handoffCode) {
      this.clearPendingAuthorization(pending)
      throw new Error('Cherry Cloud callback is missing the handoff code')
    }

    const exchange = this.exchangeCallback(pending, handoffCode).finally(() => {
      if (this.exchangePromise?.promise === exchange) this.exchangePromise = null
    })
    this.exchangePromise = {
      authorizationId: pending.authorizationId,
      state: pending.state,
      promise: exchange
    }
    return exchange
  }

  private async exchangeCallback(pending: PendingAuthorization, handoffCode: string) {
    try {
      const exchanged = await this.postJson(
        `/api/v1/desktop/authorizations/${encodeURIComponent(pending.authorizationId)}/exchange`,
        {
          state: pending.state,
          handoff_code: handoffCode,
          code_verifier: pending.codeVerifier
        },
        exchangeDesktopAuthorizationResponseSchema,
        pending.operation.controller.signal
      )
      if (
        !this.isAuthorizationOperationActive(pending.operation) ||
        this.cloudState.pending !== pending ||
        Date.parse(pending.expiresAt) <= Date.now()
      ) {
        throw new Error('Cherry Cloud authorization is no longer active')
      }

      const tokenSet = exchanged.token_set
      const session = {
        accessToken: tokenSet.access_token,
        accessExpiresAt: accessExpiresAt(tokenSet.expires_in),
        refreshToken: tokenSet.refresh_token,
        sessionId: tokenSet.session_id,
        sessionExpiresAt: Date.parse(tokenSet.session_expires_at),
        deviceId: exchanged.account.device.id,
        accountId: exchanged.account.account.id,
        displayName: exchanged.account.account.display_name ?? null
      }
      const device = this.cloudState.device
      if (!device) throw new Error('Cherry Cloud device credentials are unavailable')

      this.persistSession(device, session)
      this.clearPendingExpiryTimer()
      if (this.authorizationOperation === pending.operation) this.authorizationOperation = null
      this.invalidateModelSync()
      this.sessionGeneration += 1
      this.cloudState = {
        ...this.cloudState,
        pending: null,
        session
      }
      this.scheduleSessionExpiry(session)
      this.emitStatus()
      void this.syncEntitledModels().catch(() => undefined)
    } catch (error) {
      this.clearPendingAuthorization(pending)
      if (pending.operation.cancelled) return
      throw error
    }
  }

  private clearPendingAuthorization(pending: PendingAuthorization): void {
    const current = this.cloudState.pending
    if (!current || current.authorizationId !== pending.authorizationId || current.state !== pending.state) return

    this.clearPendingExpiryTimer()
    current.operation.controller.abort()
    if (this.authorizationOperation === current.operation) this.authorizationOperation = null
    this.cloudState = { ...this.cloudState, pending: null }
    this.emitStatus()
  }

  private schedulePendingExpiry(pending: PendingAuthorization): void {
    this.clearPendingExpiryTimer()
    const remaining = Date.parse(pending.expiresAt) - Date.now()
    const timer = setTimeout(
      () => {
        if (this.cloudState.pending !== pending) return
        if (Date.parse(pending.expiresAt) > Date.now()) {
          this.schedulePendingExpiry(pending)
          return
        }
        this.loopbackCallback?.dispose()
        this.loopbackCallback = null
        this.clearPendingAuthorization(pending)
      },
      Math.max(0, Math.min(remaining, 2_147_483_647))
    )
    timer.unref()
    this.pendingExpiryTimer = timer
  }

  private clearPendingExpiryTimer(): void {
    if (!this.pendingExpiryTimer) return
    clearTimeout(this.pendingExpiryTimer)
    this.pendingExpiryTimer = null
  }

  private scheduleSessionExpiry(session: ProductSession): void {
    this.clearSessionExpiryTimer()
    const remaining = session.sessionExpiresAt - Date.now()
    const timer = setTimeout(
      () => {
        if (this.cloudState.session !== session) return
        if (session.sessionExpiresAt > Date.now()) {
          this.scheduleSessionExpiry(session)
          return
        }
        void this.clearSession(session).catch((error) => {
          logger.warn('Cherry Cloud Session expiry cleanup failed', {
            reason: error instanceof Error ? error.message : String(error)
          })
        })
      },
      Math.max(0, Math.min(remaining, 2_147_483_647))
    )
    timer.unref()
    this.sessionExpiryTimer = timer
  }

  private clearSessionExpiryTimer(): void {
    if (!this.sessionExpiryTimer) return
    clearTimeout(this.sessionExpiryTimer)
    this.sessionExpiryTimer = null
  }

  private assertLifecycleGeneration(expected: number): void {
    if (this.lifecycleGeneration !== expected) throw new Error('Cherry Cloud service stopped during login')
  }

  private isAuthorizationOperationActive(operation: AuthorizationOperation): boolean {
    return this.authorizationOperation === operation && !operation.controller.signal.aborted
  }

  private assertAuthorizationOperation(operation: AuthorizationOperation): void {
    if (!this.isAuthorizationOperationActive(operation)) {
      throw new Error('Cherry Cloud authorization is no longer active')
    }
  }

  private currentStatus(): CherryCloudStatus {
    if (this.cloudState.session) {
      return { phase: 'signed-in', displayName: this.cloudState.session.displayName }
    }
    if (this.cloudState.pending) {
      return { phase: 'authorizing', displayName: null }
    }
    return { phase: 'signed-out', displayName: null }
  }

  private emitStatus(): void {
    application.get('IpcApiService').broadcast('cherry_cloud.status_changed', this.currentStatus())
  }

  private invalidateModelSync(): void {
    this.modelSyncPromise?.controller.abort()
    this.modelSyncPromise = null
    this.modelSyncCache = null
  }

  public async syncEntitledModels(): Promise<CloudModelSyncResult> {
    await this.pruneExpiredState()
    const generation = this.sessionGeneration
    if (this.modelSyncPromise?.generation === generation) return this.modelSyncPromise.promise

    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(CLOUD_CONTROL_REQUEST_TIMEOUT_MS)])
    const sync = this.syncEntitledModelsOnce(generation, signal)
      .then((result) => {
        if (this.sessionGeneration === generation) {
          this.modelSyncCache = { generation, syncedAt: Date.now(), result }
        }
        return result
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          logger.warn('Cherry Cloud entitled model sync failed', {
            reason: error instanceof Error ? error.message : String(error)
          })
        }
        throw error
      })
      .finally(() => {
        if (this.modelSyncPromise?.promise === sync) this.modelSyncPromise = null
      })
    this.modelSyncPromise = { controller, generation, promise: sync }
    return sync
  }

  public async syncEntitledModelsIfStale(): Promise<CloudModelSyncResult> {
    await this.pruneExpiredState()
    const cached = this.modelSyncCache
    if (cached?.generation === this.sessionGeneration && Date.now() - cached.syncedAt < CLOUD_MODEL_SYNC_CACHE_TTL_MS) {
      return cached.result
    }
    return this.syncEntitledModels()
  }

  private async syncEntitledModelsOnce(sessionGeneration: number, signal: AbortSignal): Promise<CloudModelSyncResult> {
    if (!this.cloudState.session) {
      this.reconcileEntitledModels([])
      return { modelCount: 0, quotaExhaustedModelIds: [] }
    }

    const [account, catalog] = await Promise.all([
      this.getAuthenticatedJson('/api/v1/account', accountSnapshotSchema, { signal }),
      this.getAuthenticatedJson('/v1/models?limit=1000', cloudModelListSchema, {
        headers: { 'anthropic-version': '2023-06-01' },
        signal
      })
    ])
    signal.throwIfAborted()
    if (this.sessionGeneration !== sessionGeneration || !this.cloudState.session) {
      throw new DOMException('Cherry Cloud model sync was superseded', 'AbortError')
    }

    const entitledModelIds = new Set(
      account.entitlements
        .filter((entitlement) => entitlement.status === 'active')
        .flatMap((entitlement) => entitlement.model_ids)
    )
    const models = catalog.data.filter((model) => entitledModelIds.has(model.id))
    const quotaAvailableByModelId = new Map<string, boolean>()
    for (const pool of account.quota_pools) {
      const poolAvailable = pool.windows.every((window) => window.remaining_units > 0)
      for (const modelId of pool.model_ids) {
        quotaAvailableByModelId.set(modelId, (quotaAvailableByModelId.get(modelId) ?? false) || poolAvailable)
      }
    }
    const quotaExhaustedModelIds = [
      ...new Set(
        models
          .filter((model) => quotaAvailableByModelId.get(model.id) === false)
          .map((model) => createUniqueModelId(CHERRYAI_PROVIDER_ID, model.id))
      )
    ]
    this.reconcileEntitledModels(models)
    return { modelCount: models.length, quotaExhaustedModelIds }
  }

  private reconcileEntitledModels(
    models: Array<{ id: string; display_name: string; context_window: number; max_output_tokens: number }>
  ): void {
    const current = modelService.list({ providerId: CHERRYAI_PROVIDER_ID })
    const currentByModelId = new Map(current.map((model) => [parseUniqueModelId(model.id).modelId, model]))
    const remoteByModelId = new Map(models.map((model) => [model.id, model]))
    const missing = models.filter((model) => !currentByModelId.has(model.id))
    const removed = current.flatMap((model) => {
      const modelId = parseUniqueModelId(model.id).modelId
      return modelId !== CHERRYAI_DEFAULT_MODEL_ID &&
        model.group === CHERRY_CLOUD_MODEL_GROUP &&
        !remoteByModelId.has(modelId)
        ? [{ providerId: CHERRYAI_PROVIDER_ID, modelId }]
        : []
    })
    const collisions = models.filter((model) => {
      const existing = currentByModelId.get(model.id)
      return existing && existing.group !== CHERRY_CLOUD_MODEL_GROUP
    })
    if (collisions.length > 0) {
      logger.warn('Skipped Cherry Cloud models that collide with existing CherryAI models', {
        modelIds: collisions.map((model) => model.id)
      })
    }
    const updates = current.flatMap((model) => {
      const modelId = parseUniqueModelId(model.id).modelId
      if (modelId === CHERRYAI_DEFAULT_MODEL_ID || model.group !== CHERRY_CLOUD_MODEL_GROUP) return []
      const remote = remoteByModelId.get(modelId)
      if (!remote) return []
      if (
        model.name === remote.display_name &&
        model.group === CHERRY_CLOUD_MODEL_GROUP &&
        model.endpointTypes?.length === 1 &&
        model.endpointTypes[0] === ENDPOINT_TYPE.ANTHROPIC_MESSAGES &&
        model.contextWindow === remote.context_window &&
        model.maxOutputTokens === remote.max_output_tokens &&
        model.supportsStreaming &&
        model.isEnabled
      ) {
        return []
      }
      return [
        {
          providerId: CHERRYAI_PROVIDER_ID,
          modelId,
          patch: {
            name: remote.display_name,
            group: CHERRY_CLOUD_MODEL_GROUP,
            endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
            contextWindow: remote.context_window,
            maxOutputTokens: remote.max_output_tokens,
            supportsStreaming: true,
            isEnabled: true
          }
        }
      ]
    })

    if (missing.length > 0) {
      modelService.create(
        missing.map((model) => ({
          dto: {
            providerId: CHERRYAI_PROVIDER_ID,
            modelId: model.id,
            name: model.display_name,
            group: CHERRY_CLOUD_MODEL_GROUP,
            endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
            contextWindow: model.context_window,
            maxOutputTokens: model.max_output_tokens,
            supportsStreaming: true
          }
        }))
      )
    }
    if (updates.length > 0) modelService.bulkUpdate(updates)
    if (removed.length > 0) modelService.bulkDelete(removed)
    if (missing.length > 0 || updates.length > 0 || removed.length > 0) {
      notifyDataApiDataChange([{ endpoint: '/models', kind: 'membership' }])
    }
  }

  public async authenticatedFetch(path: string, init?: CherryCloudRequestInit): Promise<Response> {
    let session: ProductSession
    try {
      session = await this.activeSession()
    } catch (error) {
      if (!(error instanceof CherryCloudSessionRequiredError)) throw error
      return new Response(
        JSON.stringify({
          type: 'error',
          error: { type: 'authentication_error', message: error.message }
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }
    const url = this.resolveRequestUrl(path)
    const headers = new Headers(init?.headers)
    const idempotencyKey =
      url.pathname === '/v1/messages' ? (headers.get('Idempotency-Key') ?? createIdempotencyKey()) : undefined
    const response = await this.signedFetch(url, init, session, { bearer: true, idempotencyKey })
    if (response.status === 401) await this.clearSession(session)
    return response
  }

  public async revokeCurrentSession(): Promise<CherryCloudStatus> {
    await this.pruneExpiredState()
    const session = this.cloudState.session
    if (!session) return this.currentStatus()
    await this.clearSession(session)

    const url = this.resolveRequestUrl('/api/v1/product-sessions/current')
    void this.signedFetch(
      url,
      {
        method: 'DELETE',
        signal: AbortSignal.timeout(CLOUD_CONTROL_REQUEST_TIMEOUT_MS)
      },
      session,
      { bearer: true }
    )
      .then((response) => {
        if (response.ok || response.status === 401) return
        logger.warn('Cherry Cloud remote Session revocation failed after local logout', {
          reason: `Cherry Cloud logout failed (${response.status})`
        })
      })
      .catch((error) => {
        logger.warn('Cherry Cloud remote Session revocation failed after local logout', {
          reason: error instanceof Error ? error.message : String(error)
        })
      })

    return this.currentStatus()
  }

  private async getAuthenticatedJson<T>(
    path: string,
    schema: ZodType<T>,
    init?: Pick<CherryCloudRequestInit, 'headers' | 'signal'>
  ): Promise<T> {
    const response = await this.authenticatedFetch(path, { method: 'GET', ...init })
    if (!response.ok) throw new Error(`Cherry Cloud request failed (${response.status})`)
    return schema.parse(await response.json())
  }

  private async activeSession(): Promise<ProductSession> {
    await this.pruneExpiredState()
    const session = this.cloudState.session
    if (!session) throw new CherryCloudSessionRequiredError()
    if (session.accessExpiresAt - ACCESS_TOKEN_REFRESH_SKEW_MS > Date.now()) return session
    if (this.refreshPromise?.session === session) return this.refreshPromise.promise

    const refresh = this.refreshSession(session).finally(() => {
      if (this.refreshPromise?.promise === refresh) this.refreshPromise = null
    })
    this.refreshPromise = { session, promise: refresh }
    return refresh
  }

  private async refreshSession(session: ProductSession): Promise<ProductSession> {
    const body = JSON.stringify({ session_id: session.sessionId, refresh_token: session.refreshToken })
    const url = new URL('/api/v1/product-sessions/refresh', `${resolveApiOrigin()}/`)
    const response = await this.signedFetch(
      url,
      {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(CLOUD_CONTROL_REQUEST_TIMEOUT_MS)
      },
      session,
      {
        bearer: false
      }
    )
    if (!response.ok) {
      if (response.status === 401) {
        await this.clearSession(session)
        throw new CherryCloudSessionRequiredError()
      }
      throw new Error(`Cherry Cloud session refresh failed (${response.status})`)
    }
    const refreshPayload = refreshProductSessionResponseSchema.safeParse(await response.json())
    if (!refreshPayload.success) {
      logger.warn('Cherry Cloud session refresh response is invalid', {
        issues: refreshPayload.error.issues.map((issue) => ({ code: issue.code, path: issue.path.join('.') }))
      })
      throw new Error('Cherry Cloud session refresh returned an invalid response')
    }
    const refreshed = refreshPayload.data.token_set
    const next = {
      ...session,
      accessToken: refreshed.access_token,
      accessExpiresAt: accessExpiresAt(refreshed.expires_in),
      refreshToken: refreshed.refresh_token,
      sessionId: refreshed.session_id,
      sessionExpiresAt: Date.parse(refreshed.session_expires_at)
    }
    if (this.cloudState.session !== session) {
      throw new Error('Cherry Cloud session changed while refresh was in progress')
    }
    const device = this.cloudState.device
    if (!device) throw new Error('Cherry Cloud device credentials are unavailable')
    try {
      this.persistSession(device, next)
    } catch (error) {
      try {
        await this.clearSession(session)
      } catch (clearError) {
        logger.warn('Cherry Cloud Session cleanup failed after persistence failure', {
          reason: clearError instanceof Error ? clearError.message : String(clearError)
        })
      }
      throw error
    }
    this.cloudState = { ...this.cloudState, session: next }
    this.scheduleSessionExpiry(next)
    return next
  }

  private async clearSession(expectedSession?: ProductSession): Promise<void> {
    const currentSession = this.cloudState.session
    if (!currentSession || (expectedSession && currentSession !== expectedSession)) return

    this.invalidateModelSync()
    this.cloudState = { ...this.cloudState, session: null }
    this.sessionGeneration += 1
    this.clearSessionExpiryTimer()
    let cleanupError: unknown
    try {
      cherryCloudSessionService.clear()
    } catch (error) {
      cleanupError = error
    }
    this.finishSessionCleanup(cleanupError)
  }

  private finishSessionCleanup(cleanupError: unknown): void {
    try {
      this.reconcileEntitledModels([])
    } catch (error) {
      cleanupError ??= error
    }
    try {
      this.emitStatus()
    } catch (error) {
      cleanupError ??= error
    }
    if (cleanupError) throw cleanupError
  }

  private resolveRequestUrl(path: string): URL {
    const url = new URL(path, `${resolveApiOrigin()}/`)
    if (url.origin !== new URL(resolveApiOrigin()).origin) {
      throw new Error('Cherry Cloud signed requests must stay on the configured API origin')
    }
    return url
  }

  private async signedFetch(
    url: URL,
    init: CherryCloudRequestInit | undefined,
    session: ProductSession,
    options: { bearer: boolean; idempotencyKey?: string }
  ): Promise<Response> {
    const device = this.cloudState.device
    if (!device) throw new Error('Cherry Cloud device credentials are unavailable')
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = Buffer.from(init?.body ?? '', 'utf8')
    const headers = new Headers(init?.headers)
    for (const name of [
      'Cherry-Device-ID',
      'Cherry-Request-ID',
      'Cherry-Timestamp',
      'Cherry-Body-SHA256',
      'Cherry-Signature-Version',
      'Cherry-Signature'
    ]) {
      headers.delete(name)
    }
    headers.delete('Content-Encoding')
    headers.set('Cherry-Device-ID', session.deviceId)
    if (options.bearer) headers.set('Authorization', `Bearer ${session.accessToken}`)
    else headers.delete('Authorization')
    if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey)
    const requestTarget = `${url.pathname}${url.search}`
    const signature = createDeviceSignature({
      privateKey: device.privateKey,
      method,
      requestTarget,
      body,
      idempotencyKey: options.idempotencyKey
    })
    for (const [name, value] of Object.entries(signature)) headers.set(name, value)

    return net.fetch(url.toString(), {
      ...init,
      method,
      redirect: 'error',
      headers,
      body: body.byteLength > 0 ? Buffer.from(body) : undefined
    })
  }

  private async pruneExpiredState(): Promise<void> {
    const now = Date.now()
    const pending = this.cloudState.pending
    const session = this.cloudState.session
    if (pending && Date.parse(pending.expiresAt) <= now) this.clearPendingAuthorization(pending)
    if (session && session.sessionExpiresAt <= now) await this.clearSession(session)
  }

  private async restoreSession(): Promise<void> {
    const stored = cherryCloudSessionService.get()
    if (!stored) return

    this.cloudState = {
      device: { publicKey: stored.devicePublicKey, privateKey: stored.devicePrivateKey },
      pending: null,
      session: {
        accessToken: stored.accessToken,
        accessExpiresAt: stored.accessExpiresAt,
        refreshToken: stored.refreshToken,
        sessionId: stored.sessionId,
        sessionExpiresAt: stored.sessionExpiresAt,
        deviceId: stored.deviceId,
        accountId: stored.accountId,
        displayName: stored.displayName ?? null
      }
    }
    this.sessionGeneration += 1
    if (this.cloudState.session) this.scheduleSessionExpiry(this.cloudState.session)
    await this.pruneExpiredState()
  }

  private persistSession(device: CherryCloudDevice, session: ProductSession): void {
    cherryCloudSessionService.replace({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      accessExpiresAt: session.accessExpiresAt,
      sessionId: session.sessionId,
      sessionExpiresAt: session.sessionExpiresAt,
      deviceId: session.deviceId,
      accountId: session.accountId,
      displayName: session.displayName,
      devicePublicKey: device.publicKey,
      devicePrivateKey: device.privateKey
    })
  }

  private async postJson<T>(path: string, body: unknown, schema: ZodType<T>, signal?: AbortSignal): Promise<T> {
    let response: Response
    try {
      const timeoutSignal = AbortSignal.timeout(CLOUD_CONTROL_REQUEST_TIMEOUT_MS)
      response = await net.fetch(`${resolveApiOrigin()}${path}`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
      })
    } catch (error) {
      if (signal?.aborted) throw error
      logger.warn('Cherry Cloud login request could not reach the service', {
        path,
        reason: error instanceof Error ? error.message : String(error)
      })
      throw new CherryCloudLoginUnavailableError()
    }
    if (response.status === 404 || response.status >= 500) {
      logger.warn('Cherry Cloud login service returned an unavailable response', { path, status: response.status })
      throw new CherryCloudLoginUnavailableError()
    }
    if (!response.ok) {
      throw new Error(`Cherry Cloud login request failed (${response.status})`)
    }
    try {
      return schema.parse(await response.json())
    } catch {
      throw new Error('Cherry Cloud login response was invalid')
    }
  }
}
