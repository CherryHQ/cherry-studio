import { app, net, shell } from 'electron'
import type { infer as Infer, ZodType } from 'zod'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { modelService } from '@data/services/ModelService'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { loggerService } from '@logger'
import { SignatureClient } from '@main/ai/provider/cherryai'
import {
  BaseService,
  DependsOn,
  Emitter,
  type Event,
  Injectable,
  Phase,
  ServicePhase,
  Signal
} from '@main/core/lifecycle'
import { t } from '@main/i18n'
import { getAppEdition } from '@main/utils/appEdition'
import { CHERRY_CLOUD_MODEL_GROUP, CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
import {
  createUniqueModelId,
  type EndpointType,
  type ModelCapability,
  parseUniqueModelId
} from '@shared/data/types/model'
import {
  type CherryCloudAccountReceipt,
  type CherryCloudEndpointFact,
  type CherryCloudAccountRefreshResult,
  type CherryCloudLoginResult,
  type CherryCloudRefreshReason,
  type CherryCloudModelSyncResult,
  type CherryCloudPublicPlanCatalog,
  cherryCloudPublicPlanCatalogSchema,
  type CherryCloudStatus
} from '@shared/ipc/schemas/cherryCloud'
import type { InputFor, WindowId } from '@shared/ipc/types'
import { Sequencer } from '@shared/utils/async'

import { cherryAccountCredentialStore } from './CherryAccountCredentialStore'
import { CherryCloudLoopbackCallback } from './CherryCloudLoopbackCallback'
import {
  accountSnapshotSchema,
  accountPlansSchema,
  cloudModelListSchema,
  createDesktopAuthorizationResponseSchema,
  exchangeDesktopAuthorizationResponseSchema,
  refreshProductSessionResponseSchema
} from './contracts'
import { createAuthorizationSecrets, createDeviceKeyPair, createDeviceSignature, createIdempotencyKey } from './crypto'
import { getMachineCode } from './machineCode'
import { trackCherryCloudAnalyticsEvent } from './subscriptionAnalytics'

const logger = loggerService.withContext('CherryCloudService')
const PRODUCTION_API_ORIGINS = {
  cn: 'https://cloud.cherryai.com.cn',
  global: 'https://cloud.cherryai.com'
} as const
const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000
const CLOUD_CONTROL_REQUEST_TIMEOUT_MS = 30_000
const CLOUD_MODEL_SYNC_CACHE_TTL_MS = 60_000

type CherryCloudRequestInit = Omit<RequestInit, 'body'> & { body?: string }
type CherryCloudDevice = ReturnType<typeof createDeviceKeyPair>
type AuthorizationOperation = {
  controller: AbortController
  cancelled: boolean
  completion: Signal<LoginSettlement>
}
type LoginSettlement = CherryCloudLoginResult | { outcome: 'failed'; error: unknown }
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
function emptyState(): CherryCloudState {
  return { device: null, pending: null, session: null }
}

export function resolveCherryCloudApiOrigin(): string {
  const configuredOrigin = import.meta.env.MAIN_VITE_CHERRY_CLOUD_API_ORIGIN?.trim()
  if (configuredOrigin) return new URL(configuredOrigin).origin
  return PRODUCTION_API_ORIGINS[getAppEdition()]
}

function platformName(): 'darwin' | 'windows' | 'linux' {
  if (process.platform === 'darwin' || process.platform === 'linux') return process.platform
  if (process.platform === 'win32') return 'windows'
  throw new Error(`Cherry Cloud login is not supported on ${process.platform}`)
}

function accessExpiresAt(expiresIn: number): number {
  return Date.now() + expiresIn * 1000
}

/** The server refused a browser sign-in: expired, already used, or the account cannot sign in. */
class CherryCloudAuthorizationRejectedError extends Error {
  constructor() {
    super('Cherry Cloud rejected the desktop authorization')
    this.name = 'CherryCloudAuthorizationRejectedError'
  }
}

export class CherryCloudLoginUnavailableError extends Error {
  constructor() {
    super('Cherry Cloud login service is unavailable')
    this.name = 'CherryCloudLoginUnavailableError'
  }
}

export class CherryCloudUpgradeRequiredError extends Error {
  constructor() {
    super('Update Cherry Studio to sign in to Cherry Cloud')
    this.name = 'CherryCloudUpgradeRequiredError'
  }
}

export class CherryCloudPortalOpenError extends Error {
  constructor(cause: unknown) {
    super('Cherry Cloud account portal could not be opened', { cause })
    this.name = 'CherryCloudPortalOpenError'
  }
}

class CherryCloudSessionRequiredError extends Error {
  constructor() {
    super('Cherry Cloud account is not signed in')
    this.name = 'CherryCloudSessionRequiredError'
  }
}

class CherryCloudRefreshError extends Error {
  constructor(readonly response: Response) {
    super(`Cherry Cloud session refresh failed (${response.status})`)
    this.name = 'CherryCloudRefreshError'
  }
}

/** Why the client signed the user out without being asked to; each reason gets its own notice. */
type SignOutReason = 'expired' | 'revoked' | 'disabled'

function signOutReason(response: Response): SignOutReason {
  return response.headers.get('Cherry-Error-Code') === 'SESSION_EXPIRED' ? 'expired' : 'revoked'
}

function isAccountDisabled(response: Response): boolean {
  return response.headers.get('Cherry-Error-Code') === 'ACCOUNT_DISABLED'
}

function requiresLogin(response: Response): boolean {
  const code = response.headers.get('Cherry-Error-Code')
  return response.status === 401 && (code === 'SESSION_EXPIRED' || code === 'REAUTH_REQUIRED')
}

function discardResponse(response: Response): void {
  void response.body?.cancel().catch(() => undefined)
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) {
    void promise.catch(() => undefined)
    return Promise.reject(signal.reason)
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

@Injectable('CherryCloudService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['PowerService', 'AnalyticsService'])
export class CherryCloudService extends BaseService {
  private readonly _onStatusChanged = new Emitter<CherryCloudStatus>()
  public readonly onStatusChanged: Event<CherryCloudStatus> = this._onStatusChanged.event
  private cloudState = emptyState()
  private machineCode: string | null = null
  private lifecycleGeneration = 0
  private authorizationOperation: AuthorizationOperation | null = null
  private loginPromise: { operation: AuthorizationOperation; promise: Promise<CherryCloudLoginResult> } | null = null
  private subscriptionPromise: Promise<void> | null = null
  private revision = 0
  private readonly accountRefreshQueue = new Sequencer()
  private readonly accountRefreshes = new Set<AbortController>()
  private receiptReason: CherryCloudRefreshReason = 'initial'
  private accountFact: CherryCloudAccountReceipt['account'] = { freshness: 'unknown', error: null }
  private modelFact: CherryCloudAccountReceipt['models'] = { freshness: 'unknown', error: null }
  private plansFact: CherryCloudAccountReceipt['plans'] = { freshness: 'unknown', error: null }
  private refreshPromise: { session: ProductSession; promise: Promise<ProductSession> } | null = null
  private modelSyncPromise: {
    controller: AbortController
    generation: number
    promise: Promise<CherryCloudModelSyncResult>
  } | null = null
  private modelSyncCache: {
    generation: number
    syncedAt: number
    result: CherryCloudModelSyncResult
  } | null = null
  private sessionGeneration = 0
  // The gateway may refuse a request its quota cannot cover while windows still show units left; until a
  // window grows, a pool it refused stays exhausted. Pools are keyed by their model IDs.
  private quotaRefusals: { generation: number; models: Set<string>; floors: Map<string, number[]> } | null = null
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
    // A plan can end while the machine sleeps, so the snapshot taken before sleep is not reused.
    this.registerDisposable(application.get('PowerService').onResume(() => (this.modelSyncCache = null)))
    await this.restoreSession()
    if (this.cloudState.session) void this.syncEntitledModels().catch(() => undefined)
  }

  protected onStop(): void {
    const operation = this.authorizationOperation
    if (operation) operation.cancelled = true
    this.lifecycleGeneration += 1
    this.invalidateAccountRefreshes()
    this.revision += 1
    this.exchangePromise = null
    this.refreshPromise = null
    this.invalidateModelSync()
    this.clearPendingExpiryTimer()
    this.clearSessionExpiryTimer()
    this.loopbackCallback?.dispose()
    this.loopbackCallback = null
    if (this.cloudState.session) this.sessionGeneration += 1
    this.cloudState = emptyState()
    this.machineCode = null
    this.resetAccountFacts()
    if (operation) {
      this.settleAuthorization(operation, { outcome: 'stopped', status: this.currentStatus() })
      operation.controller.abort()
    }
    this.authorizationOperation = null
    this.loginPromise = null
    this.subscriptionPromise = null
  }

  protected async onDestroy(): Promise<void> {
    this.settleActiveAuthorization('stopped')
    this._onStatusChanged.dispose()
  }

  public async getStatus(): Promise<CherryCloudStatus> {
    await this.pruneExpiredState()
    return this.currentStatus()
  }

  public getApiOrigin(): string {
    return resolveCherryCloudApiOrigin()
  }

  // The account center must stay on the API origin, where browser sign-in sets its session cookie.
  public getAccountOrigin(): string {
    return resolveCherryCloudApiOrigin()
  }

  public startLogin(): Promise<CherryCloudLoginResult> {
    if (this.loginPromise) return this.loginPromise.promise
    const operation: AuthorizationOperation = {
      controller: new AbortController(),
      cancelled: false,
      completion: new Signal<LoginSettlement>()
    }
    this.authorizationOperation = operation
    const login = Promise.resolve(operation.completion)
      .then((result) => {
        if (result.outcome === 'failed') throw result.error
        return result
      })
      .finally(() => {
        if (this.loginPromise?.promise === login) this.loginPromise = null
        operation.completion.dispose()
      })
    this.loginPromise = { operation, promise: login }
    void this.createLogin(operation)
      .then((status) => {
        if (status.phase === 'signed-in') this.settleAuthorization(operation, { outcome: 'signed-in', status })
      })
      .catch((error) => this.settleAuthorization(operation, { outcome: 'failed', error }))
    return login
  }

  public async cancelLogin(): Promise<CherryCloudStatus> {
    const operation = this.authorizationOperation
    if (!operation) return this.getStatus()
    operation.cancelled = true
    const pending = this.cloudState.pending
    if (pending?.operation === operation) this.clearPendingAuthorization(pending, 'cancelled')
    else {
      this.authorizationOperation = null
      operation.controller.abort()
      this.settleAuthorization(operation, { outcome: 'cancelled', status: this.currentStatus() })
    }
    this.loopbackCallback?.dispose()
    this.loopbackCallback = null
    return this.currentStatus()
  }

  private settleAuthorization(operation: AuthorizationOperation, result: LoginSettlement): void {
    if (operation.completion.isResolved) return
    if (this.loginPromise?.operation === operation) this.loginPromise = null
    operation.completion.resolve(result)
    if (this.authorizationOperation === operation) this.authorizationOperation = null
  }

  private settleActiveAuthorization(outcome: 'stopped'): void {
    const operation = this.authorizationOperation
    if (!operation) return
    operation.cancelled = true
    this.settleAuthorization(operation, { outcome, status: this.currentStatus() })
    operation.controller.abort()
  }

  private async createLogin(operation: AuthorizationOperation): Promise<CherryCloudStatus> {
    const lifecycleGeneration = this.lifecycleGeneration
    const current = await this.getStatus()
    this.assertLifecycleGeneration(lifecycleGeneration)
    this.assertAuthorizationOperation(operation)
    if (current.phase !== 'signed-out') return current

    const machineCode = await getMachineCode()
    this.assertLifecycleGeneration(lifecycleGeneration)
    this.assertAuthorizationOperation(operation)
    this.machineCode = machineCode
    const device = this.getOrCreateDevice()
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
          machine_code: machineCode,
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
      if (!operation.completion.isResolved) this.assertAuthorizationOperation(operation)
    } catch (error) {
      if (operation.completion.isResolved) return this.currentStatus()
      loopbackCallback.dispose()
      if (this.loopbackCallback === loopbackCallback) this.loopbackCallback = null
      if (pending) this.clearPendingAuthorization(pending, null)
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
    }, resolveCherryCloudApiOrigin())
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

  private getOrCreateDevice(): CherryCloudDevice {
    if (this.cloudState.device) return this.cloudState.device

    const stored = cherryAccountCredentialStore.get()
    if (stored) {
      const device = { publicKey: stored.devicePublicKey, privateKey: stored.devicePrivateKey }
      this.cloudState = { ...this.cloudState, device }
      return device
    }

    const device = createDeviceKeyPair()
    cherryAccountCredentialStore.replace({
      version: 1,
      devicePublicKey: device.publicKey,
      devicePrivateKey: device.privateKey,
      session: null
    })
    this.cloudState = { ...this.cloudState, device }
    return device
  }

  private async handleCallback(url: URL): Promise<void> {
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
      this.clearPendingAuthorization(pending, 'expired')
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
      this.invalidateAccountRefreshes()
      this.resetAccountFacts()
      this.cloudState = {
        ...this.cloudState,
        pending: null,
        session
      }
      this.scheduleSessionExpiry(session)
      this.emitStatus()
      this.settleAuthorization(pending.operation, { outcome: 'signed-in', status: this.currentStatus() })
      application.get('MainWindowService').showMainWindow()
      void application
        .get('ApiGatewayService')
        .start()
        .catch((error) => {
          logger.warn('API Gateway did not start after Cherry Cloud login', {
            reason: error instanceof Error ? error.message : String(error)
          })
        })
      void this.syncEntitledModels().catch(() => undefined)
    } catch (error) {
      this.clearPendingAuthorization(pending, null)
      if (pending.operation.cancelled) return
      this.settleAuthorization(
        pending.operation,
        error instanceof CherryCloudAuthorizationRejectedError
          ? { outcome: 'rejected', status: this.currentStatus() }
          : { outcome: 'failed', error }
      )
      if (error instanceof CherryCloudAuthorizationRejectedError) this.reportSignOut('login_rejected')
      throw error
    }
  }

  private clearPendingAuthorization(
    pending: PendingAuthorization,
    outcome: 'cancelled' | 'expired' | 'rejected' | null = 'rejected'
  ): void {
    const current = this.cloudState.pending
    if (!current || current.authorizationId !== pending.authorizationId || current.state !== pending.state) return

    this.clearPendingExpiryTimer()
    current.operation.controller.abort()
    if (this.authorizationOperation === current.operation) this.authorizationOperation = null
    this.cloudState = { ...this.cloudState, pending: null }
    this.emitStatus()
    if (outcome) this.settleAuthorization(current.operation, { outcome, status: this.currentStatus() })
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
        this.clearPendingAuthorization(pending, 'expired')
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
        void this.clearSession(session, 'expired').catch((error) => {
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

  public getCurrentScopeId(): string {
    return `${this.lifecycleGeneration}:${this.sessionGeneration}`
  }

  public isCurrentScope(scopeId: string): boolean {
    return scopeId === this.getCurrentScopeId()
  }

  private currentStatus(): CherryCloudStatus {
    const scope = { scopeId: this.getCurrentScopeId(), revision: this.revision }
    if (this.cloudState.session) {
      const { accountId, displayName } = this.cloudState.session
      return { ...scope, phase: 'signed-in', accountId, displayName }
    }
    if (this.cloudState.pending) {
      return { ...scope, phase: 'authorizing', accountId: null, displayName: null }
    }
    return { ...scope, phase: 'signed-out', accountId: null, displayName: null }
  }

  private emitStatus(): void {
    this.revision += 1
    const status = this.currentStatus()
    application.get('IpcApiService').broadcast('cherry_cloud.status_changed', status)
    this._onStatusChanged.fire(status)
    application.get('IpcApiService').broadcast('cherry_cloud.account_changed', this.getAccountReceipt())
  }

  public getAccountReceipt(): CherryCloudAccountReceipt {
    return {
      status: this.currentStatus(),
      reason: this.receiptReason,
      account: this.accountFact,
      models: this.modelFact,
      plans: this.plansFact
    }
  }

  private resetAccountFacts(): void {
    this.accountFact = { freshness: 'unknown', error: null }
    this.modelFact = { freshness: 'unknown', error: null }
    this.plansFact = { freshness: 'unknown', error: null }
    this.receiptReason = 'initial'
  }

  private failedFact<T>(fact: CherryCloudEndpointFact<T>, error: unknown): CherryCloudEndpointFact<T> {
    const message = error instanceof Error ? error.message : String(error)
    return fact.freshness === 'unknown'
      ? { freshness: 'unknown', error: message }
      : { freshness: 'stale', value: fact.value, observedRevision: fact.observedRevision, error: message }
  }

  private publishAccountReceipt(reason: CherryCloudRefreshReason): CherryCloudAccountReceipt {
    this.revision += 1
    this.receiptReason = reason
    const receipt = this.getAccountReceipt()
    application.get('IpcApiService').broadcast('cherry_cloud.account_changed', receipt)
    return receipt
  }

  public async refreshAccount({
    scopeId,
    reason,
    signal
  }: {
    scopeId: string
    reason: Exclude<CherryCloudRefreshReason, 'models'>
    signal?: AbortSignal
  }): Promise<CherryCloudAccountRefreshResult> {
    const controller = new AbortController()
    this.accountRefreshes.add(controller)
    const deadline = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(CLOUD_CONTROL_REQUEST_TIMEOUT_MS),
      ...(signal ? [signal] : [])
    ])
    const interrupted = (): CherryCloudAccountRefreshResult => ({
      outcome: !this.isCurrentScope(scopeId) ? 'superseded' : 'aborted',
      status: this.currentStatus()
    })
    const task = this.accountRefreshQueue.queue(async (): Promise<CherryCloudAccountRefreshResult> => {
      if (!this.isCurrentScope(scopeId)) return { outcome: 'superseded', status: this.currentStatus() }
      if (deadline.aborted) return interrupted()
      await this.pruneExpiredState()
      if (!this.isCurrentScope(scopeId)) return { outcome: 'superseded', status: this.currentStatus() }
      if (!this.cloudState.session) return { outcome: 'signed-out', status: this.currentStatus() }
      const generation = this.sessionGeneration
      const results = await abortable(
        Promise.allSettled([
          this.getAuthenticatedJson('/api/v1/account', accountSnapshotSchema, { signal: deadline }),
          this.getAuthenticatedJson('/v1/models?limit=1000', cloudModelListSchema, {
            headers: { 'anthropic-version': '2023-06-01' },
            signal: deadline
          }),
          this.getAuthenticatedJson('/api/v1/account/plans', accountPlansSchema, { signal: deadline })
        ]),
        deadline
      )
      if (!this.isCurrentScope(scopeId)) return { outcome: 'superseded', status: this.currentStatus() }
      deadline.throwIfAborted()
      const [account, catalog, plans] = results
      const nextRevision = this.revision + 1
      const nextAccount: CherryCloudAccountReceipt['account'] =
        account.status === 'fulfilled'
          ? { freshness: 'fresh' }
          : {
              freshness: this.accountFact.freshness === 'unknown' ? 'unknown' : 'stale',
              error: account.reason instanceof Error ? account.reason.message : String(account.reason)
            }
      let nextModels: CherryCloudAccountReceipt['models']
      let nextCache: typeof this.modelSyncCache = null
      let succeeded = results.every((result) => result.status === 'fulfilled')
      if (account.status === 'fulfilled' && catalog.status === 'fulfilled') {
        try {
          const value = this.projectEntitledModels(account.value, catalog.value, generation)
          nextCache = { generation, syncedAt: performance.now(), result: value }
          nextModels = { freshness: 'fresh', value, observedRevision: nextRevision }
        } catch (error) {
          nextModels = this.failedFact(this.modelFact, error)
          succeeded = false
        }
      } else {
        nextModels = this.failedFact(
          this.modelFact,
          account.status === 'rejected'
            ? account.reason
            : catalog.status === 'rejected'
              ? catalog.reason
              : 'Model catalog unavailable'
        )
      }
      const nextPlans: CherryCloudAccountReceipt['plans'] =
        plans.status === 'fulfilled'
          ? { freshness: 'fresh', value: plans.value, observedRevision: nextRevision }
          : this.failedFact(this.plansFact, plans.reason)
      this.accountFact = nextAccount
      this.modelFact = nextModels
      this.plansFact = nextPlans
      this.modelSyncCache = nextCache
      const receipt = this.publishAccountReceipt(reason)
      return { outcome: succeeded ? 'refreshed' : 'failed', receipt }
    })
    try {
      return await abortable(task, deadline)
    } catch (error) {
      if (deadline.aborted || !this.isCurrentScope(scopeId)) return interrupted()
      throw error
    } finally {
      this.accountRefreshes.delete(controller)
    }
  }

  public async startSubscription(
    input: InputFor<'cherry_cloud.subscription.start'>,
    senderId: WindowId | null
  ): Promise<void> {
    const generation = this.lifecycleGeneration
    const status = await this.getStatus()
    void trackCherryCloudAnalyticsEvent(
      { event: 'subscription_entry_clicked', ...input, signedIn: status.phase === 'signed-in' },
      status.scopeId
    ).catch(() => undefined)
    const sender = senderId ? application.get('WindowManager').getWindow(senderId) : undefined
    if (
      !sender ||
      sender.isDestroyed() ||
      generation !== this.lifecycleGeneration ||
      !this.isCurrentScope(status.scopeId)
    )
      return
    if (!this.subscriptionPromise) {
      const subscription = this.startSubscriptionOnce(input, senderId, status).finally(() => {
        if (this.subscriptionPromise === subscription) this.subscriptionPromise = null
      })
      this.subscriptionPromise = subscription
    }
    return this.subscriptionPromise
  }

  private async startSubscriptionOnce(
    { source, via, flowId }: InputFor<'cherry_cloud.subscription.start'>,
    senderId: WindowId | null,
    status: CherryCloudStatus
  ): Promise<void> {
    if (status.phase !== 'signed-in') {
      let result: CherryCloudLoginResult
      try {
        result = await this.startLogin()
      } catch (error) {
        void trackCherryCloudAnalyticsEvent(
          {
            event: 'subscription_sign_in_result',
            flowId,
            result: 'failed',
            reason:
              error instanceof CherryCloudUpgradeRequiredError
                ? 'upgrade_required'
                : error instanceof CherryCloudLoginUnavailableError
                  ? 'service_unavailable'
                  : 'other'
          },
          status.scopeId
        ).catch(() => undefined)
        throw error
      }
      void trackCherryCloudAnalyticsEvent(
        {
          event: 'subscription_sign_in_result',
          flowId,
          result: result.outcome === 'signed-in' ? 'success' : 'not_completed'
        },
        result.status.scopeId
      ).catch(() => undefined)
      if (result.outcome !== 'signed-in') return
      status = result.status
    }
    try {
      const result = await this.openAccountPortal({ scopeId: status.scopeId, entrySource: source, flowId }, senderId)
      if (result.outcome === 'opened')
        void trackCherryCloudAnalyticsEvent(
          { event: 'subscription_portal_open', source, via, flowId, result: 'success' },
          status.scopeId
        ).catch(() => undefined)
    } catch (error) {
      void trackCherryCloudAnalyticsEvent(
        { event: 'subscription_portal_open', source, via, flowId, result: 'failed' },
        status.scopeId
      ).catch(() => undefined)
      throw new CherryCloudPortalOpenError(error)
    }
  }

  public async openAccountPortal(
    input: { scopeId: string; entrySource?: string; flowId?: string },
    senderId: WindowId | null
  ): Promise<{ outcome: 'opened' | 'superseded' }> {
    await this.pruneExpiredState()
    const sender = senderId ? application.get('WindowManager').getWindow(senderId) : undefined
    if (!sender || sender.isDestroyed() || !this.isCurrentScope(input.scopeId) || !this.cloudState.session)
      return { outcome: 'superseded' }
    const url = new URL('/account/plans', this.getAccountOrigin())
    url.searchParams.set('entry', 'desktop')
    if (input.entrySource) url.searchParams.set('entry_source', input.entrySource)
    if (input.flowId) url.searchParams.set('flow_id', input.flowId)
    await abortable(shell.openExternal(url.toString()), AbortSignal.timeout(CLOUD_CONTROL_REQUEST_TIMEOUT_MS))
    return { outcome: 'opened' }
  }

  private invalidateAccountRefreshes(): void {
    for (const controller of this.accountRefreshes) controller.abort()
    this.accountRefreshes.clear()
  }

  private invalidateModelSync(): void {
    this.modelSyncPromise?.controller.abort()
    this.modelSyncPromise = null
    this.modelSyncCache = null
  }

  private async syncEntitledModels(): Promise<CherryCloudModelSyncResult> {
    const generation = this.sessionGeneration
    const scopeId = this.getCurrentScopeId()
    await this.pruneExpiredState()
    if (!this.isCurrentScope(scopeId)) throw new DOMException('Cherry Cloud model sync was superseded', 'AbortError')
    if (this.modelSyncPromise?.generation === generation) return this.modelSyncPromise.promise
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(CLOUD_CONTROL_REQUEST_TIMEOUT_MS)])
    const task = this.accountRefreshQueue.queue(async () => {
      signal.throwIfAborted()
      if (!this.isCurrentScope(scopeId)) throw new DOMException('Cherry Cloud model sync was superseded', 'AbortError')
      try {
        const result = await abortable(this.syncEntitledModelsOnce(generation, signal), signal)
        signal.throwIfAborted()
        if (!this.isCurrentScope(scopeId))
          throw new DOMException('Cherry Cloud model sync was superseded', 'AbortError')
        this.modelSyncCache = { generation, syncedAt: performance.now(), result }
        this.modelFact = { freshness: 'fresh', value: result, observedRevision: this.revision + 1 }
        this.accountFact = this.cloudState.session ? { freshness: 'fresh' } : { freshness: 'unknown', error: null }
        this.publishAccountReceipt('models')
        return result
      } catch (error) {
        if (!controller.signal.aborted && this.isCurrentScope(scopeId)) {
          this.modelFact = this.failedFact(this.modelFact, error)
          this.publishAccountReceipt('models')
          logger.warn('Cherry Cloud entitled model sync failed', {
            reason: error instanceof Error ? error.message : String(error)
          })
        }
        throw error
      }
    })
    const sync = abortable(task, signal).finally(() => {
      if (this.modelSyncPromise?.promise === sync) this.modelSyncPromise = null
    })
    this.modelSyncPromise = { controller, generation, promise: sync }
    return sync
  }

  public async syncEntitledModelsIfStale(): Promise<CherryCloudModelSyncResult> {
    await this.pruneExpiredState()
    const cached = this.modelSyncCache
    // Monotonic time, so moving the system clock back cannot keep a snapshot alive.
    if (
      cached?.generation === this.sessionGeneration &&
      performance.now() - cached.syncedAt < CLOUD_MODEL_SYNC_CACHE_TTL_MS
    ) {
      return cached.result
    }
    return this.syncEntitledModels()
  }

  /** The plan catalog needs no session, so the model picker can offer paid models before sign-in. */
  public async getPublicPlans(): Promise<CherryCloudPublicPlanCatalog> {
    const response = await net.fetch(`${resolveCherryCloudApiOrigin()}/api/v1/public/plans`, {
      redirect: 'error',
      signal: AbortSignal.timeout(CLOUD_CONTROL_REQUEST_TIMEOUT_MS)
    })
    if (!response.ok) throw new Error(`Cherry Cloud plan catalog request failed (${response.status})`)
    return cherryCloudPublicPlanCatalogSchema.parse(await response.json())
  }

  private async syncEntitledModelsOnce(
    sessionGeneration: number,
    signal: AbortSignal
  ): Promise<CherryCloudModelSyncResult> {
    if (!this.cloudState.session) {
      return {
        entitledModelIds: [],
        freeModelIds: [],
        availableModelIds: { agent: [], general: [] },
        quotaExhaustedModelIds: []
      }
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

    return this.projectEntitledModels(account, catalog, sessionGeneration)
  }

  private projectEntitledModels(
    account: Infer<typeof accountSnapshotSchema>,
    catalog: Infer<typeof cloudModelListSchema>,
    sessionGeneration: number
  ): CherryCloudModelSyncResult {
    const activeEntitlements = account.entitlements.filter((entitlement) => entitlement.status === 'active')
    const entitledModelIds = new Set(activeEntitlements.flatMap((entitlement) => entitlement.model_ids))
    const freeApiModelIds = new Set(
      activeEntitlements.filter((entitlement) => entitlement.is_free).flatMap((entitlement) => entitlement.model_ids)
    )
    const paidApiModelIds = new Set(
      activeEntitlements.filter((entitlement) => !entitlement.is_free).flatMap((entitlement) => entitlement.model_ids)
    )
    const models = catalog.data.filter((model) => entitledModelIds.has(model.id))
    const quotaAvailableByModelId = new Map<string, boolean>()
    const refusals = this.quotaRefusals?.generation === sessionGeneration ? this.quotaRefusals : null
    for (const pool of account.quota_pools) {
      const remaining = pool.windows.map((window) => window.remaining_units)
      const poolKey = [...pool.model_ids].sort().join('\n')
      if (refusals && pool.model_ids.some((modelId) => refusals.models.has(modelId))) {
        refusals.floors.set(poolKey, remaining)
      }
      const floor = refusals?.floors.get(poolKey)
      const refused =
        floor !== undefined && floor.length === remaining.length && remaining.every((units, i) => units <= floor[i])
      if (floor && !refused) refusals?.floors.delete(poolKey)
      const poolAvailable = !refused && remaining.every((units) => units > 0)
      for (const modelId of pool.model_ids) {
        quotaAvailableByModelId.set(modelId, (quotaAvailableByModelId.get(modelId) ?? false) || poolAvailable)
      }
    }
    refusals?.models.clear()
    const quotaExhaustedModelIds = [
      ...new Set(
        models
          .filter((model) => quotaAvailableByModelId.get(model.id) === false)
          .map((model) => createUniqueModelId(CHERRY_CLOUD_PROVIDER_ID, model.id))
      )
    ]
    const agentModelIds: CherryCloudModelSyncResult['availableModelIds']['agent'] = []
    const generalModelIds: CherryCloudModelSyncResult['availableModelIds']['general'] = []
    const freeModelIds: CherryCloudModelSyncResult['freeModelIds'] = []
    for (const model of models) {
      const uniqueModelId = createUniqueModelId(CHERRY_CLOUD_PROVIDER_ID, model.id)
      if (freeApiModelIds.has(model.id) && !paidApiModelIds.has(model.id)) freeModelIds.push(uniqueModelId)
      const features = new Set(model.available_features)
      if (features.has('agent')) agentModelIds.push(uniqueModelId)
      if (features.has('chat') && features.has('translate')) {
        generalModelIds.push(uniqueModelId)
      } else if (features.has('chat') || features.has('translate')) {
        // Chat and translate are granted together; fail closed on a model that breaks that contract.
        logger.warn('Cherry Cloud model grants chat and translate separately; offering it in neither', {
          modelId: model.id,
          features: model.available_features
        })
      }
    }
    this.reconcileEntitledModels(models)
    return {
      entitledModelIds: models.map((model) => createUniqueModelId(CHERRY_CLOUD_PROVIDER_ID, model.id)),
      freeModelIds: [...new Set(freeModelIds)],
      availableModelIds: {
        agent: [...new Set(agentModelIds)],
        general: [...new Set(generalModelIds)]
      },
      quotaExhaustedModelIds
    }
  }

  private recordQuotaRefusal(generation: number, body: string | undefined): void {
    let modelId: unknown
    try {
      modelId = body ? (JSON.parse(body) as { model?: unknown }).model : undefined
    } catch {
      return
    }
    if (typeof modelId !== 'string') return
    if (this.quotaRefusals?.generation !== generation) {
      this.quotaRefusals = { generation, models: new Set(), floors: new Map() }
    }
    this.quotaRefusals.models.add(modelId)
  }

  /** Tells the user why they were signed out, or why a browser sign-in did not finish. */
  private reportSignOut(reason: SignOutReason | 'login_rejected'): void {
    const notices = {
      expired: [
        t('notification.cherry_cloud.session_expired_title'),
        t('notification.cherry_cloud.session_expired_message')
      ],
      revoked: [t('notification.cherry_cloud.signed_out_title'), t('notification.cherry_cloud.signed_out_message')],
      disabled: [
        t('notification.cherry_cloud.account_disabled_title'),
        t('notification.cherry_cloud.account_disabled_message')
      ],
      login_rejected: [
        t('notification.cherry_cloud.login_rejected_title'),
        t('notification.cherry_cloud.login_rejected_message')
      ]
    }
    const [title, message] = notices[reason]
    const now = Date.now()
    try {
      void application
        .get('NotificationService')
        .publish({
          eventKey: `cherry-cloud:sign-out:${reason}:${now}`,
          // Usage notices pop up in the app and as system notifications; system ones only fill the list.
          category: 'usage',
          createdAt: now,
          kind: 'cherry-cloud-account',
          title,
          message,
          target: { kind: 'settings', tab: 'profile' }
        })
        .catch((error) => logger.warn('Failed to report a Cherry Cloud sign-out', error as Error))
    } catch (error) {
      // A sign-out found while restoring at startup can run before the notification service is up.
      logger.warn('Failed to report a Cherry Cloud sign-out', error as Error)
    }
  }

  private reconcileEntitledModels(
    models: Array<{
      id: string
      display_name: string
      endpoint_type: EndpointType
      context_window: number
      max_output_tokens: number
      capabilities?: ModelCapability[]
    }>
  ): void {
    const current = modelService.list({ providerId: CHERRY_CLOUD_PROVIDER_ID })
    const currentByModelId = new Map(current.map((model) => [parseUniqueModelId(model.id).modelId, model]))
    const missingCapabilityModelIds = models
      .filter((model) => model.capabilities === undefined)
      .map((model) => model.id)
    const registryCapabilitiesByModelId = new Map<string, ModelCapability[]>()

    if (missingCapabilityModelIds.length > 0) {
      try {
        for (const model of providerRegistryService.resolveModels(
          CHERRY_CLOUD_PROVIDER_ID,
          missingCapabilityModelIds
        )) {
          if (!model.presetModelId) continue
          const modelId = model.apiModelId ?? parseUniqueModelId(model.id).modelId
          registryCapabilitiesByModelId.set(modelId, model.capabilities)
        }
      } catch (error) {
        logger.warn('Cherry Cloud registry capability fallback failed', {
          modelCount: missingCapabilityModelIds.length,
          reason: error instanceof Error ? error.message : String(error)
        })
      }
    }

    const reconciledModels = models.map((model) => ({
      ...model,
      capabilities:
        model.capabilities ??
        registryCapabilitiesByModelId.get(model.id) ??
        currentByModelId.get(model.id)?.capabilities ??
        []
    }))
    const remoteByModelId = new Map(reconciledModels.map((model) => [model.id, model]))
    const missing = reconciledModels.filter((model) => !currentByModelId.has(model.id))
    const updates = current.flatMap((model) => {
      const modelId = parseUniqueModelId(model.id).modelId
      const remote = remoteByModelId.get(modelId)
      if (!remote) return []
      if (
        model.name === remote.display_name &&
        model.group === CHERRY_CLOUD_MODEL_GROUP &&
        model.endpointTypes?.length === 1 &&
        model.endpointTypes[0] === remote.endpoint_type &&
        model.contextWindow === remote.context_window &&
        model.maxOutputTokens === remote.max_output_tokens &&
        model.capabilities.length === remote.capabilities.length &&
        model.capabilities.every((capability) => remote.capabilities.includes(capability)) &&
        model.supportsStreaming &&
        model.isEnabled
      ) {
        return []
      }
      return [
        {
          modelId,
          patch: {
            name: remote.display_name,
            group: CHERRY_CLOUD_MODEL_GROUP,
            endpointTypes: [remote.endpoint_type],
            contextWindow: remote.context_window,
            maxOutputTokens: remote.max_output_tokens,
            capabilities: remote.capabilities,
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
            providerId: CHERRY_CLOUD_PROVIDER_ID,
            modelId: model.id,
            name: model.display_name,
            group: CHERRY_CLOUD_MODEL_GROUP,
            endpointTypes: [model.endpoint_type],
            contextWindow: model.context_window,
            maxOutputTokens: model.max_output_tokens,
            capabilities: model.capabilities,
            supportsStreaming: true
          }
        }))
      )
    }
    if (updates.length > 0) {
      modelService.bulkUpdate(
        updates.map(({ modelId, patch }) => ({ providerId: CHERRY_CLOUD_PROVIDER_ID, modelId, patch }))
      )
    }
    if (missing.length > 0 || updates.length > 0) {
      notifyDataApiDataChange([{ endpoint: '/models', kind: 'membership' }])
    }
  }

  public async authenticatedFetch(path: string, init?: CherryCloudRequestInit): Promise<Response> {
    init?.signal?.throwIfAborted()
    const initialSession = this.cloudState.session
    let session: ProductSession
    try {
      session = await abortable(this.activeSession(), init?.signal)
    } catch (error) {
      init?.signal?.throwIfAborted()
      if (error instanceof CherryCloudRefreshError) return error.response.clone()
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
      url.pathname === '/v1/messages' || url.pathname === '/v1/chat/completions'
        ? (headers.get('Idempotency-Key') ?? createIdempotencyKey())
        : undefined
    const generation = this.sessionGeneration
    let response = await this.signedFetch(url, init, session, { bearer: true, idempotencyKey })
    if (isAccountDisabled(response)) {
      await this.clearSession(session, 'disabled')
      return response
    }
    if (requiresLogin(response)) {
      await this.clearSession(session, signOutReason(response))
      return response
    }
    const currentSession = this.cloudState.session
    if (generation !== this.sessionGeneration || !currentSession) return response

    // Cloud strips upstream Cherry-* headers, so upstream 401 bodies cannot invalidate the login.
    const code = response.headers.get('Cherry-Error-Code')
    // The snapshot let this request through, so the next check asks the server again.
    if (
      (response.status === 403 && code === 'ENTITLEMENT_INACTIVE') ||
      (response.status === 429 && code === 'QUOTA_EXHAUSTED')
    ) {
      this.modelSyncCache = null
    }
    if (response.status === 429 && code === 'QUOTA_EXHAUSTED') this.recordQuotaRefusal(generation, init?.body)
    const refreshRequired = response.status === 401 && code === 'AUTH_REQUIRED'
    const replayed = response.status === 409 && code === 'REQUEST_REPLAYED'
    if (!refreshRequired && !replayed) return response
    if (refreshRequired && session !== initialSession) return response
    if (replayed) session = currentSession

    try {
      init?.signal?.throwIfAborted()
      if (refreshRequired) {
        session = await abortable(this.activeSession(currentSession === session, currentSession), init?.signal)
      }
      init?.signal?.throwIfAborted()
    } catch (error) {
      if (error instanceof CherryCloudSessionRequiredError) return response
      discardResponse(response)
      init?.signal?.throwIfAborted()
      if (error instanceof CherryCloudRefreshError) return error.response.clone()
      throw error
    }
    if (generation !== this.sessionGeneration || !this.cloudState.session) return response
    session = this.cloudState.session

    discardResponse(response)
    response = await this.signedFetch(url, init, session, { bearer: true, idempotencyKey })
    if (requiresLogin(response)) await this.clearSession(session, signOutReason(response))
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
    const generation = this.sessionGeneration
    const response = await this.authenticatedFetch(path, { method: 'GET', ...init })
    if (!response.ok) throw new Error(`Cherry Cloud request failed (${response.status})`)
    const body = await response.json()
    // A response that outlived its session belongs to another account; never hand it to the caller.
    if (generation !== this.sessionGeneration) {
      throw new DOMException('Cherry Cloud request was superseded by a session change', 'AbortError')
    }
    return schema.parse(body)
  }

  private async activeSession(forceRefresh = false, expectedSession?: ProductSession): Promise<ProductSession> {
    const generation = this.sessionGeneration
    await this.pruneExpiredState()
    const session = this.cloudState.session
    if (!session || generation !== this.sessionGeneration) throw new CherryCloudSessionRequiredError()
    if (expectedSession && session !== expectedSession) return session
    if (!forceRefresh && session.accessExpiresAt - ACCESS_TOKEN_REFRESH_SKEW_MS > Date.now()) return session
    if (this.refreshPromise?.session === session) return this.refreshPromise.promise

    const refresh = this.refreshSession(session).finally(() => {
      if (this.refreshPromise?.promise === refresh) this.refreshPromise = null
    })
    this.refreshPromise = { session, promise: refresh }
    return refresh
  }

  private async refreshSession(session: ProductSession): Promise<ProductSession> {
    const body = JSON.stringify({ session_id: session.sessionId, refresh_token: session.refreshToken })
    const url = new URL('/api/v1/product-sessions/refresh', `${resolveCherryCloudApiOrigin()}/`)
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
      if (isAccountDisabled(response)) {
        await this.clearSession(session, 'disabled')
        throw new CherryCloudRefreshError(response)
      }
      if (
        requiresLogin(response) ||
        (response.status === 401 && response.headers.get('Cherry-Error-Code') === 'AUTH_REQUIRED')
      ) {
        await this.clearSession(session, signOutReason(response))
      }
      throw new CherryCloudRefreshError(response)
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

  private async clearSession(expectedSession?: ProductSession, reason?: SignOutReason): Promise<void> {
    const currentSession = this.cloudState.session
    if (!currentSession || (expectedSession && currentSession !== expectedSession)) return
    if (reason) this.reportSignOut(reason)

    cherryAccountCredentialStore.clearSession()
    this.invalidateModelSync()
    this.cloudState = { ...this.cloudState, session: null }
    this.sessionGeneration += 1
    this.subscriptionPromise = null
    this.invalidateAccountRefreshes()
    this.resetAccountFacts()
    this.clearSessionExpiryTimer()
    this.finishSessionCleanup()
  }

  private finishSessionCleanup(): void {
    try {
      this.emitStatus()
    } catch (error) {
      logger.warn('Cherry Cloud status broadcast failed after Session removal', {
        reason: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private resolveRequestUrl(path: string): URL {
    const url = new URL(path, `${resolveCherryCloudApiOrigin()}/`)
    if (url.origin !== new URL(resolveCherryCloudApiOrigin()).origin) {
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
    init?.signal?.throwIfAborted()
    const device = this.cloudState.device
    if (!device) throw new Error('Cherry Cloud device credentials are unavailable')
    const machineCode = this.machineCode ?? (await getMachineCode())
    init?.signal?.throwIfAborted()
    if (this.cloudState.device !== device) throw new Error('Cherry Cloud device credentials changed')
    this.machineCode = machineCode
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = Buffer.from(init?.body ?? '', 'utf8')
    const headers = new Headers(init?.headers)
    for (const name of [
      'Cherry-Device-ID',
      'Cherry-Machine-Code',
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
      machineCode,
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
    if (pending && Date.parse(pending.expiresAt) <= now) this.clearPendingAuthorization(pending, 'expired')
    if (session && session.sessionExpiresAt <= now) await this.clearSession(session, 'expired')
  }

  private async restoreSession(): Promise<void> {
    const stored = cherryAccountCredentialStore.get()
    if (!stored) return

    const device = { publicKey: stored.devicePublicKey, privateKey: stored.devicePrivateKey }
    const session = stored.session?.apiOrigin === resolveCherryCloudApiOrigin() ? stored.session : null

    this.cloudState = {
      device,
      pending: null,
      session: session
        ? {
            accessToken: '',
            accessExpiresAt: 0,
            refreshToken: session.refreshToken,
            sessionId: session.sessionId,
            sessionExpiresAt: session.sessionExpiresAt,
            deviceId: session.deviceId,
            accountId: session.accountId,
            displayName: session.displayName
          }
        : null
    }
    if (this.cloudState.session) this.sessionGeneration += 1
    if (this.cloudState.session) this.scheduleSessionExpiry(this.cloudState.session)
    await this.pruneExpiredState()
  }

  private persistSession(device: CherryCloudDevice, session: ProductSession): void {
    cherryAccountCredentialStore.replace({
      version: 1,
      devicePublicKey: device.publicKey,
      devicePrivateKey: device.privateKey,
      session: {
        apiOrigin: resolveCherryCloudApiOrigin(),
        refreshToken: session.refreshToken,
        sessionId: session.sessionId,
        sessionExpiresAt: session.sessionExpiresAt,
        deviceId: session.deviceId,
        accountId: session.accountId,
        displayName: session.displayName
      }
    })
  }

  private async postJson<T>(path: string, body: unknown, schema: ZodType<T>, signal?: AbortSignal): Promise<T> {
    const clientSecret = import.meta.env.MAIN_VITE_CHERRY_CLOUD_CLIENT_SECRET
    if (!clientSecret) {
      logger.warn('Cherry Cloud client secret is not configured')
      throw new CherryCloudLoginUnavailableError()
    }
    const bodyString = JSON.stringify(body)
    const signature = new SignatureClient('cherry-studio', clientSecret).generateSignature({
      method: 'POST',
      path,
      body: bodyString
    })
    let response: Response
    try {
      const timeoutSignal = AbortSignal.timeout(CLOUD_CONTROL_REQUEST_TIMEOUT_MS)
      response = await net.fetch(`${resolveCherryCloudApiOrigin()}${path}`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json', ...signature },
        body: bodyString,
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
    if (response.status === 426) throw new CherryCloudUpgradeRequiredError()
    if (response.status === 404 || response.status >= 500) {
      logger.warn('Cherry Cloud login service returned an unavailable response', { path, status: response.status })
      throw new CherryCloudLoginUnavailableError()
    }
    if (isAccountDisabled(response)) {
      this.reportSignOut('disabled')
      throw new Error('Cherry Cloud account is disabled')
    }
    if (response.status === 400 && response.headers.get('Cherry-Error-Code') === 'AUTHORIZATION_INVALID') {
      throw new CherryCloudAuthorizationRejectedError()
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
