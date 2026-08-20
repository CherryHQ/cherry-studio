import { readFile } from 'node:fs/promises'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { modelService } from '@data/services/ModelService'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { atomicWriteFile } from '@main/utils/file'
import { CHERRYAI_DEFAULT_MODEL_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { ENDPOINT_TYPE, parseUniqueModelId } from '@shared/data/types/model'
import type { CherryCloudStatus } from '@shared/ipc/schemas/cherryCloud'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { app, net, safeStorage, shell } from 'electron'
import type { ZodType } from 'zod'

import {
  accountSnapshotSchema,
  cloudModelListSchema,
  createDesktopAuthorizationResponseSchema,
  EMPTY_STORED_CHERRY_CLOUD_STATE,
  exchangeDesktopAuthorizationResponseSchema,
  refreshProductSessionResponseSchema,
  type StoredCherryCloudState,
  storedCherryCloudStateSchema
} from './contracts'
import { createAuthorizationSecrets, createDeviceKeyPair, createDeviceSignature, createIdempotencyKey } from './crypto'
import { CherryCloudLoopbackCallback } from './loopbackCallback'

const logger = loggerService.withContext('CherryCloudService')
const DEFAULT_API_ORIGIN = 'http://127.0.0.1:8080'
const SESSION_FILE_MODE = 0o600
const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000
const CLOUD_MODEL_GROUP = 'Cherry Cloud'
const EMPTY_BODY = new Uint8Array()

function isLoopbackHttp(url: URL): boolean {
  return (
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]')
  )
}

function resolveApiOrigin(): string {
  const raw = process.env.CHERRY_CLOUD_API_ORIGIN?.trim() || DEFAULT_API_ORIGIN
  const url = new URL(raw)
  const isLocalHttp = isLoopbackHttp(url)

  if (url.protocol !== 'https:' && !isLocalHttp) {
    throw new Error('Cherry Cloud API origin must use HTTPS or a local HTTP address')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Cherry Cloud API origin must not include credentials, query, or fragment')
  }

  return url.toString().replace(/\/$/, '')
}

function shouldUseLoopbackCallback(): boolean {
  const configured = process.env.CHERRY_CLOUD_LOOPBACK_CALLBACK?.trim()
  if (!configured || configured === 'false') return false
  if (configured !== 'true') throw new Error('CHERRY_CLOUD_LOOPBACK_CALLBACK must be true or false')
  if (app.isPackaged) throw new Error('Cherry Cloud loopback callbacks are only available in development')
  if (!isLoopbackHttp(new URL(resolveApiOrigin()))) {
    throw new Error('Cherry Cloud loopback callbacks require a local HTTP backend')
  }
  return true
}

function platformName(): 'darwin' | 'windows' | 'linux' {
  if (process.platform === 'darwin' || process.platform === 'linux') return process.platform
  if (process.platform === 'win32') return 'windows'
  throw new Error(`Cherry Cloud login is not supported on ${process.platform}`)
}

function accessExpiresAt(expiresIn: number): string {
  return new Date(Date.now() + expiresIn * 1000).toISOString()
}

function requestHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  new Headers(init?.headers).forEach((value, name) => headers.set(name, value))
  return headers
}

async function requestBody(input: RequestInfo | URL, init?: RequestInit): Promise<Uint8Array> {
  const body = init?.body
  if (body == null) {
    if (input instanceof Request && input.body) return new Uint8Array(await input.clone().arrayBuffer())
    return EMPTY_BODY
  }
  if (typeof body === 'string') return Buffer.from(body, 'utf8')
  if (body instanceof URLSearchParams) return Buffer.from(body.toString(), 'utf8')
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
  throw new Error('Cherry Cloud requests require a replayable byte body')
}

export class CherryCloudLoginUnavailableError extends Error {
  constructor() {
    super('Cherry Cloud login service is unavailable')
    this.name = 'CherryCloudLoginUnavailableError'
  }
}

@Injectable('CherryCloudService')
@ServicePhase(Phase.WhenReady)
export class CherryCloudService extends BaseService {
  private storedState: StoredCherryCloudState = structuredClone(EMPTY_STORED_CHERRY_CLOUD_STATE)
  private loginPromise: Promise<CherryCloudStatus> | null = null
  private refreshPromise: Promise<NonNullable<StoredCherryCloudState['session']>> | null = null
  private modelSyncPromise: Promise<{ modelCount: number }> | null = null
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
    await this.restoreState()
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
    this.assertEncryptionAvailable()

    const device = this.storedState.device ?? createDeviceKeyPair()
    const secrets = createAuthorizationSecrets()
    const loopbackCallback = shouldUseLoopbackCallback() ? await this.openLoopbackCallback() : null
    let pending: NonNullable<StoredCherryCloudState['pending']> | null = null

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
      this.storedState = { ...this.storedState, device, pending }
      await this.persistState()
      this.emitStatus()

      await shell.openExternal(created.authorization_url)
    } catch (error) {
      loopbackCallback?.dispose()
      if (this.loopbackCallback === loopbackCallback) this.loopbackCallback = null
      if (pending) await this.clearPendingAuthorization(pending)
      throw error
    }

    return this.currentStatus()
  }

  private async openLoopbackCallback(): Promise<CherryCloudLoopbackCallback> {
    this.loopbackCallback?.dispose()
    const receiver = await CherryCloudLoopbackCallback.open(async (url) => {
      try {
        await this.handleCallback(url)
      } finally {
        if (this.loopbackCallback === receiver) this.loopbackCallback = null
      }
    }, resolveApiOrigin())
    this.loopbackCallback = receiver
    return receiver
  }

  public async handleCallback(url: URL): Promise<void> {
    if (url.hostname.toLowerCase() !== 'cloud-auth' || url.pathname !== '/callback') {
      throw new Error('Invalid Cherry Cloud callback')
    }

    const pending = this.storedState.pending
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
      await this.clearPendingAuthorization(pending)
      throw new Error('Cherry Cloud authorization has expired')
    }

    if (url.searchParams.has('error')) {
      await this.clearPendingAuthorization(pending)
      return
    }

    const handoffCode = url.searchParams.get('handoff_code')
    if (!handoffCode) {
      await this.clearPendingAuthorization(pending)
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

  private async exchangeCallback(pending: NonNullable<StoredCherryCloudState['pending']>, handoffCode: string) {
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
      this.storedState = {
        ...this.storedState,
        pending: null,
        session: {
          accessToken: tokenSet.access_token,
          accessExpiresAt: accessExpiresAt(tokenSet.expires_in),
          refreshToken: tokenSet.refresh_token,
          sessionId: tokenSet.session_id,
          sessionExpiresAt: tokenSet.session_expires_at,
          deviceId: exchanged.account.device.id,
          accountId: exchanged.account.account.id,
          displayName: exchanged.account.account.display_name ?? null
        }
      }
      await this.persistState()
      this.emitStatus()
      void this.syncFreeModels().catch((error) => {
        logger.warn('Cherry Cloud model sync failed after login', {
          reason: error instanceof Error ? error.message : String(error)
        })
      })
    } catch (error) {
      await this.clearPendingAuthorization(pending)
      throw error
    }
  }

  private async clearPendingAuthorization(pending: NonNullable<StoredCherryCloudState['pending']>): Promise<void> {
    const current = this.storedState.pending
    if (!current || current.authorizationId !== pending.authorizationId || current.state !== pending.state) return

    this.storedState = { ...this.storedState, pending: null }
    await this.persistState()
    this.emitStatus()
  }

  private currentStatus(): CherryCloudStatus {
    if (this.storedState.session) {
      return { phase: 'signed-in', displayName: this.storedState.session.displayName }
    }
    if (this.storedState.pending) {
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
    if (!this.storedState.session) {
      this.reconcileFreeModels([])
      return { modelCount: 0 }
    }

    const [account, catalog] = await Promise.all([
      this.getAuthenticatedJson('/api/v1/account', accountSnapshotSchema),
      this.getAuthenticatedJson('/v1/models?limit=1000', cloudModelListSchema, {
        'anthropic-version': '2023-06-01'
      })
    ])
    const freeModelIds = new Set(
      account.entitlements
        .filter((entitlement) => entitlement.status === 'active' && entitlement.is_free)
        .flatMap((entitlement) => entitlement.model_ids)
    )
    const models = catalog.data.filter((model) => freeModelIds.has(model.id))
    this.reconcileFreeModels(models)
    return { modelCount: models.length }
  }

  private reconcileFreeModels(models: Array<{ id: string; display_name: string }>): void {
    const current = modelService.list({ providerId: CHERRYAI_PROVIDER_ID })
    const currentByModelId = new Map(current.map((model) => [parseUniqueModelId(model.id).modelId, model]))
    const remoteByModelId = new Map(models.map((model) => [model.id, model]))
    const missing = models.filter((model) => !currentByModelId.has(model.id))
    const updates = current.flatMap((model) => {
      const modelId = parseUniqueModelId(model.id).modelId
      if (
        modelId === CHERRYAI_DEFAULT_MODEL_ID ||
        (model.group !== CLOUD_MODEL_GROUP && !remoteByModelId.has(modelId))
      ) {
        return []
      }
      const remote = remoteByModelId.get(modelId)
      const enabled = Boolean(remote)
      if (
        model.name === (remote?.display_name ?? model.name) &&
        model.group === CLOUD_MODEL_GROUP &&
        model.endpointTypes?.length === 1 &&
        model.endpointTypes[0] === ENDPOINT_TYPE.ANTHROPIC_MESSAGES &&
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
            group: CLOUD_MODEL_GROUP,
            endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
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
            group: CLOUD_MODEL_GROUP,
            endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
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

  public async authenticatedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const session = await this.activeSession()
    const url = this.resolveRequestUrl(input)
    const headers = requestHeaders(input, init)
    const idempotencyKey =
      url.pathname === '/v1/messages' ? (headers.get('Idempotency-Key') ?? createIdempotencyKey()) : undefined
    const response = await this.signedFetch(url, input, init, session, { bearer: true, idempotencyKey })
    if (response.status === 401) await this.clearSession()
    return response
  }

  public getModelApiBaseUrl(): string {
    return `${resolveApiOrigin()}/v1`
  }

  private async getAuthenticatedJson<T>(path: string, schema: ZodType<T>, headers?: HeadersInit): Promise<T> {
    const response = await this.authenticatedFetch(path, { method: 'GET', headers })
    if (!response.ok) throw new Error(`Cherry Cloud request failed (${response.status})`)
    return schema.parse(await response.json())
  }

  private async activeSession(): Promise<NonNullable<StoredCherryCloudState['session']>> {
    await this.pruneExpiredState()
    const session = this.storedState.session
    if (!session) throw new Error('Cherry Cloud account is not signed in')
    if (Date.parse(session.accessExpiresAt) - ACCESS_TOKEN_REFRESH_SKEW_MS > Date.now()) return session
    if (this.refreshPromise) return this.refreshPromise

    const refresh = this.refreshSession(session).finally(() => {
      if (this.refreshPromise === refresh) this.refreshPromise = null
    })
    this.refreshPromise = refresh
    return refresh
  }

  private async refreshSession(
    session: NonNullable<StoredCherryCloudState['session']>
  ): Promise<NonNullable<StoredCherryCloudState['session']>> {
    const body = JSON.stringify({ session_id: session.sessionId, refresh_token: session.refreshToken })
    const url = new URL('/api/v1/product-sessions/refresh', `${resolveApiOrigin()}/`)
    const response = await this.signedFetch(
      url,
      url,
      { method: 'POST', body, headers: { 'Content-Type': 'application/json' } },
      session,
      {
        bearer: false
      }
    )
    if (!response.ok) {
      if (response.status === 401) await this.clearSession()
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
      sessionExpiresAt: refreshed.session_expires_at
    }
    this.storedState = { ...this.storedState, session: next }
    await this.persistState()
    return next
  }

  private async clearSession(): Promise<void> {
    this.storedState = { ...this.storedState, session: null }
    await this.persistState()
    this.reconcileFreeModels([])
    this.emitStatus()
  }

  private resolveRequestUrl(input: RequestInfo | URL): URL {
    const url = new URL(input instanceof Request ? input.url : input.toString(), `${resolveApiOrigin()}/`)
    if (url.origin !== new URL(resolveApiOrigin()).origin) {
      throw new Error('Cherry Cloud signed requests must stay on the configured API origin')
    }
    return url
  }

  private async signedFetch(
    url: URL,
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    session: NonNullable<StoredCherryCloudState['session']>,
    options: { bearer: boolean; idempotencyKey?: string }
  ): Promise<Response> {
    const device = this.storedState.device
    if (!device) throw new Error('Cherry Cloud device credentials are unavailable')
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const body = await requestBody(input, init)
    const headers = requestHeaders(input, init)
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
    const pendingExpired = this.storedState.pending && Date.parse(this.storedState.pending.expiresAt) <= now
    const sessionExpired = this.storedState.session && Date.parse(this.storedState.session.sessionExpiresAt) <= now
    if (!pendingExpired && !sessionExpired) return

    this.storedState = {
      ...this.storedState,
      pending: pendingExpired ? null : this.storedState.pending,
      session: sessionExpired ? null : this.storedState.session
    }
    await this.persistState()
    this.emitStatus()
  }

  private async restoreState(): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) return

    try {
      const encrypted = await readFile(this.sessionFilePath())
      const serialized = safeStorage.decryptString(encrypted)
      this.storedState = storedCherryCloudStateSchema.parse(JSON.parse(serialized))
      await this.pruneExpiredState()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Failed to restore Cherry Cloud login state')
      }
    }
  }

  private assertEncryptionAvailable(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure credential storage is unavailable')
    }
  }

  private async persistState(): Promise<void> {
    this.assertEncryptionAvailable()
    const serialized = JSON.stringify(storedCherryCloudStateSchema.parse(this.storedState))
    const encrypted = safeStorage.encryptString(serialized)
    await atomicWriteFile(this.sessionFilePath(), encrypted, {
      mode: SESSION_FILE_MODE
    })
  }

  private sessionFilePath() {
    return AbsoluteFilePathSchema.parse(application.getPath('feature.cherry_cloud.session_file'))
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
