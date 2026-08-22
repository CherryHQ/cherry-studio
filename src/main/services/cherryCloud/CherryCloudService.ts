import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { cherryCloudSessionService } from '@data/services/CherryCloudSessionService'
import { modelService } from '@data/services/ModelService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import {
  CHERRY_CLOUD_MODEL_GROUP,
  CHERRYAI_DEFAULT_MODEL_ID,
  CHERRYAI_PROVIDER_ID
} from '@shared/data/presets/cherryai'
import { ENDPOINT_TYPE, parseUniqueModelId } from '@shared/data/types/model'
import type { CherryCloudStatus } from '@shared/ipc/schemas/cherryCloud'
import { app, net, shell } from 'electron'
import type { ZodType } from 'zod'

import {
  accountSnapshotSchema,
  cloudModelListSchema,
  createDesktopAuthorizationResponseSchema,
  exchangeDesktopAuthorizationResponseSchema,
  refreshProductSessionResponseSchema
} from './contracts'
import { createAuthorizationSecrets, createDeviceKeyPair, createDeviceSignature, createIdempotencyKey } from './crypto'
import { CherryCloudLoopbackCallback } from './loopbackCallback'

const logger = loggerService.withContext('CherryCloudService')
const DEVELOPMENT_API_ORIGIN = 'http://127.0.0.1:8084'
const PRODUCTION_API_ORIGIN = 'https://cloud.cherryai.com.cn'
const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000

type CherryCloudRequestInit = Omit<RequestInit, 'body'> & { body?: string }
type CherryCloudDevice = ReturnType<typeof createDeviceKeyPair>
type PendingAuthorization = {
  authorizationId: string
  state: string
  codeVerifier: string
  expiresAt: string
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

@Injectable('CherryCloudService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ApiGatewayService'])
export class CherryCloudService extends BaseService {
  private cloudState = emptyState()
  private loginPromise: Promise<CherryCloudStatus> | null = null
  private refreshPromise: Promise<ProductSession> | null = null
  private modelSyncPromise: Promise<{ modelCount: number }> | null = null
  private agentGatewayLeasePromise: Promise<void> | null = null
  private hasAgentGatewayLease = false
  private sessionGeneration = 0
  private loopbackCallback: CherryCloudLoopbackCallback | null = null
  private exchangePromise: {
    authorizationId: string
    state: string
    promise: Promise<void>
  } | null = null

  protected async onInit(): Promise<void> {
    this.registerDisposable(() => {
      this.loopbackCallback?.dispose()
      this.loopbackCallback = null
    })
    await this.restoreSession()
  }

  protected async onStop(): Promise<void> {
    await this.releaseAgentGatewayLease()
  }

  public async getStatus(): Promise<CherryCloudStatus> {
    await this.pruneExpiredState()
    return this.currentStatus()
  }

  public async startLogin(): Promise<CherryCloudStatus> {
    if (this.loginPromise) return this.loginPromise

    const login = this.createLogin().finally(() => {
      if (this.loginPromise === login) this.loginPromise = null
    })
    this.loginPromise = login
    return login
  }

  private async createLogin(): Promise<CherryCloudStatus> {
    const current = await this.getStatus()
    if (current.phase !== 'signed-out') return current

    const device = this.cloudState.device ?? createDeviceKeyPair()
    const secrets = createAuthorizationSecrets()
    const loopbackCallback = app.isPackaged ? null : await this.openLoopbackCallback()
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
        createDesktopAuthorizationResponseSchema
      )
      loopbackCallback?.setExpiresAt(created.expires_at)
      pending = {
        authorizationId: created.authorization_id,
        state: secrets.state,
        codeVerifier: secrets.codeVerifier,
        expiresAt: created.expires_at
      }
      this.cloudState = { ...this.cloudState, device, pending }
      this.emitStatus()

      await shell.openExternal(created.authorization_url)
    } catch (error) {
      loopbackCallback?.dispose()
      if (this.loopbackCallback === loopbackCallback) this.loopbackCallback = null
      if (pending) this.clearPendingAuthorization(pending)
      throw error
    }

    return this.currentStatus()
  }

  private async openLoopbackCallback(): Promise<CherryCloudLoopbackCallback> {
    this.loopbackCallback?.dispose()
    const receiver = await CherryCloudLoopbackCallback.open(async (url) => {
      await this.handleCallback(url)
      if (this.loopbackCallback === receiver) this.loopbackCallback = null
    }, resolveApiOrigin())
    this.loopbackCallback = receiver
    return receiver
  }

  public async handleCallback(url: URL): Promise<void> {
    if (url.hostname.toLowerCase() !== 'cloud-auth' || url.pathname !== '/callback') {
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
        exchangeDesktopAuthorizationResponseSchema
      )

      const tokenSet = exchanged.token_set
      this.cloudState = {
        ...this.cloudState,
        pending: null,
        session: {
          accessToken: tokenSet.access_token,
          accessExpiresAt: accessExpiresAt(tokenSet.expires_in),
          refreshToken: tokenSet.refresh_token,
          sessionId: tokenSet.session_id,
          sessionExpiresAt: Date.parse(tokenSet.session_expires_at),
          deviceId: exchanged.account.device.id,
          accountId: exchanged.account.account.id,
          displayName: exchanged.account.account.display_name ?? null
        }
      }
      this.persistSession()
      this.emitStatus()
      void this.syncFreeModels().catch((error) => {
        logger.warn('Cherry Cloud model sync failed after login', {
          reason: error instanceof Error ? error.message : String(error)
        })
      })
    } catch (error) {
      this.clearPendingAuthorization(pending)
      throw error
    }
  }

  private clearPendingAuthorization(pending: PendingAuthorization): void {
    const current = this.cloudState.pending
    if (!current || current.authorizationId !== pending.authorizationId || current.state !== pending.state) return

    this.cloudState = { ...this.cloudState, pending: null }
    this.emitStatus()
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

  public async syncFreeModels(): Promise<{ modelCount: number }> {
    if (this.modelSyncPromise) return this.modelSyncPromise

    const sync = this.syncFreeModelsOnce()
      .catch((error) => {
        logger.warn('Cherry Cloud free model sync failed', {
          reason: error instanceof Error ? error.message : String(error)
        })
        throw error
      })
      .finally(() => {
        if (this.modelSyncPromise === sync) this.modelSyncPromise = null
      })
    this.modelSyncPromise = sync
    return sync
  }

  private async syncFreeModelsOnce(): Promise<{ modelCount: number }> {
    await this.pruneExpiredState()
    if (!this.cloudState.session) {
      this.reconcileFreeModels([])
      return { modelCount: 0 }
    }
    const sessionGeneration = this.sessionGeneration

    const [account, catalog] = await Promise.all([
      this.getAuthenticatedJson('/api/v1/account', accountSnapshotSchema),
      this.getAuthenticatedJson('/v1/models?limit=1000', cloudModelListSchema, {
        'anthropic-version': '2023-06-01'
      })
    ])
    if (this.sessionGeneration !== sessionGeneration || !this.cloudState.session) return { modelCount: 0 }

    const freeModelIds = new Set(
      account.entitlements
        .filter((entitlement) => entitlement.status === 'active' && entitlement.is_free)
        .flatMap((entitlement) => entitlement.model_ids)
    )
    const models = catalog.data.filter((model) => freeModelIds.has(model.id))
    this.reconcileFreeModels(models)
    return { modelCount: models.length }
  }

  private reconcileFreeModels(
    models: Array<{ id: string; display_name: string; context_window: number; max_output_tokens: number }>
  ): void {
    const current = modelService.list({ providerId: CHERRYAI_PROVIDER_ID })
    const currentByModelId = new Map(current.map((model) => [parseUniqueModelId(model.id).modelId, model]))
    const remoteByModelId = new Map(models.map((model) => [model.id, model]))
    const missing = models.filter((model) => !currentByModelId.has(model.id))
    const updates = current.flatMap((model) => {
      const modelId = parseUniqueModelId(model.id).modelId
      if (
        modelId === CHERRYAI_DEFAULT_MODEL_ID ||
        (model.group !== CHERRY_CLOUD_MODEL_GROUP && !remoteByModelId.has(modelId))
      ) {
        return []
      }
      const remote = remoteByModelId.get(modelId)
      const enabled = Boolean(remote)
      if (
        model.name === (remote?.display_name ?? model.name) &&
        model.group === CHERRY_CLOUD_MODEL_GROUP &&
        model.endpointTypes?.length === 1 &&
        model.endpointTypes[0] === ENDPOINT_TYPE.ANTHROPIC_MESSAGES &&
        model.contextWindow === remote?.context_window &&
        model.maxOutputTokens === remote?.max_output_tokens &&
        model.supportsStreaming &&
        model.isEnabled === enabled
      ) {
        return []
      }
      return [
        {
          providerId: CHERRYAI_PROVIDER_ID,
          modelId,
          patch: {
            ...(remote ? { name: remote.display_name } : {}),
            group: CHERRY_CLOUD_MODEL_GROUP,
            endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
            ...(remote ? { contextWindow: remote.context_window, maxOutputTokens: remote.max_output_tokens } : {}),
            supportsStreaming: true,
            isEnabled: enabled
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
    if (missing.length > 0 || updates.length > 0) {
      notifyDataApiDataChange([{ endpoint: '/models', kind: 'membership' }])
    }
  }

  public async authenticatedFetch(path: string, init?: CherryCloudRequestInit): Promise<Response> {
    const session = await this.activeSession()
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
    if (!this.cloudState.session) return this.currentStatus()

    let response: Response
    try {
      response = await this.authenticatedFetch('/api/v1/product-sessions/current', { method: 'DELETE' })
    } catch (error) {
      if (!this.cloudState.session) return this.currentStatus()
      throw error
    }
    if (response.status === 401) return this.currentStatus()
    if (!response.ok) throw new Error(`Cherry Cloud logout failed (${response.status})`)

    await this.clearSession()
    return this.currentStatus()
  }

  public async ensureAgentGateway(): Promise<void> {
    await this.activeSession()
    if (this.hasAgentGatewayLease) return
    if (this.agentGatewayLeasePromise) return this.agentGatewayLeasePromise

    const acquire = application
      .get('ApiGatewayService')
      .acquireLease()
      .then(() => {
        this.hasAgentGatewayLease = true
      })
      .finally(() => {
        if (this.agentGatewayLeasePromise === acquire) this.agentGatewayLeasePromise = null
      })
    this.agentGatewayLeasePromise = acquire
    return acquire
  }

  public async getSessionGeneration(): Promise<number> {
    await this.pruneExpiredState()
    return this.sessionGeneration
  }

  private async getAuthenticatedJson<T>(path: string, schema: ZodType<T>, headers?: HeadersInit): Promise<T> {
    const response = await this.authenticatedFetch(path, { method: 'GET', headers })
    if (!response.ok) throw new Error(`Cherry Cloud request failed (${response.status})`)
    return schema.parse(await response.json())
  }

  private async activeSession(): Promise<ProductSession> {
    await this.pruneExpiredState()
    const session = this.cloudState.session
    if (!session) throw new Error('Cherry Cloud account is not signed in')
    if (session.accessExpiresAt - ACCESS_TOKEN_REFRESH_SKEW_MS > Date.now()) return session
    if (this.refreshPromise) return this.refreshPromise

    const refresh = this.refreshSession(session).finally(() => {
      if (this.refreshPromise === refresh) this.refreshPromise = null
    })
    this.refreshPromise = refresh
    return refresh
  }

  private async refreshSession(session: ProductSession): Promise<ProductSession> {
    const body = JSON.stringify({ session_id: session.sessionId, refresh_token: session.refreshToken })
    const url = new URL('/api/v1/product-sessions/refresh', `${resolveApiOrigin()}/`)
    const response = await this.signedFetch(
      url,
      { method: 'POST', body, headers: { 'Content-Type': 'application/json' } },
      session,
      {
        bearer: false
      }
    )
    if (!response.ok) {
      if (response.status === 401) await this.clearSession(session)
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
    this.cloudState = { ...this.cloudState, session: next }
    this.persistSession()
    return next
  }

  private async clearSession(expectedSession?: ProductSession): Promise<void> {
    const currentSession = this.cloudState.session
    if (!currentSession || (expectedSession && currentSession !== expectedSession)) return

    this.cloudState = { ...this.cloudState, session: null }
    this.sessionGeneration += 1
    cherryCloudSessionService.clear()
    await this.releaseAgentGatewayLease()
    this.reconcileFreeModels([])
    this.emitStatus()
  }

  private async releaseAgentGatewayLease(): Promise<void> {
    await this.agentGatewayLeasePromise?.catch(() => undefined)
    if (!this.hasAgentGatewayLease) return
    this.hasAgentGatewayLease = false
    application.get('ApiGatewayService').releaseLease()
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
      headers,
      body: body.byteLength > 0 ? Buffer.from(body) : undefined
    })
  }

  private async pruneExpiredState(): Promise<void> {
    const now = Date.now()
    const pendingExpired = this.cloudState.pending && Date.parse(this.cloudState.pending.expiresAt) <= now
    const sessionExpired = this.cloudState.session && this.cloudState.session.sessionExpiresAt <= now
    if (!pendingExpired && !sessionExpired) return

    this.cloudState = {
      ...this.cloudState,
      pending: pendingExpired ? null : this.cloudState.pending,
      session: sessionExpired ? null : this.cloudState.session
    }
    if (sessionExpired) this.sessionGeneration += 1
    if (sessionExpired) cherryCloudSessionService.clear()
    if (sessionExpired) await this.releaseAgentGatewayLease()
    this.emitStatus()
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
    await this.pruneExpiredState()
  }

  private persistSession(): void {
    const { device, session } = this.cloudState
    if (!device || !session) return

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

  private async postJson<T>(path: string, body: unknown, schema: ZodType<T>): Promise<T> {
    let response: Response
    try {
      response = await net.fetch(`${resolveApiOrigin()}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
    } catch (error) {
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
