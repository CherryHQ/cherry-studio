import { readFile } from 'node:fs/promises'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { atomicWriteFile } from '@main/utils/file'
import type { CherryCloudStatus } from '@shared/ipc/schemas/cherryCloud'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { app, net, safeStorage, shell } from 'electron'
import type { ZodType } from 'zod'

import {
  createDesktopAuthorizationResponseSchema,
  EMPTY_STORED_CHERRY_CLOUD_STATE,
  exchangeDesktopAuthorizationResponseSchema,
  type StoredCherryCloudState,
  storedCherryCloudStateSchema
} from './contracts'
import { createAuthorizationSecrets, createDeviceKeyPair } from './crypto'

const logger = loggerService.withContext('CherryCloudService')
const DEFAULT_API_ORIGIN = 'http://127.0.0.1:8080'
const SESSION_FILE_MODE = 0o600

function resolveApiOrigin(): string {
  const raw = process.env.CHERRY_CLOUD_API_ORIGIN?.trim() || DEFAULT_API_ORIGIN
  const url = new URL(raw)
  const isLocalHttp =
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]')

  if (url.protocol !== 'https:' && !isLocalHttp) {
    throw new Error('Cherry Cloud API origin must use HTTPS or a local HTTP address')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Cherry Cloud API origin must not include credentials, query, or fragment')
  }

  return url.toString().replace(/\/$/, '')
}

function platformName(): 'darwin' | 'windows' | 'linux' {
  if (process.platform === 'darwin' || process.platform === 'linux') return process.platform
  if (process.platform === 'win32') return 'windows'
  throw new Error(`Cherry Cloud login is not supported on ${process.platform}`)
}

function accessExpiresAt(expiresIn: number): string {
  return new Date(Date.now() + expiresIn * 1000).toISOString()
}

@Injectable('CherryCloudService')
@ServicePhase(Phase.WhenReady)
export class CherryCloudService extends BaseService {
  private storedState: StoredCherryCloudState = structuredClone(EMPTY_STORED_CHERRY_CLOUD_STATE)
  private loginPromise: Promise<CherryCloudStatus> | null = null
  private exchangePromise: {
    authorizationId: string
    state: string
    promise: Promise<void>
  } | null = null

  protected async onInit(): Promise<void> {
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
    const created = await this.postJson(
      '/api/v1/desktop/authorizations',
      {
        state: secrets.state,
        code_challenge: secrets.codeChallenge,
        code_challenge_method: 'S256',
        device_public_key: device.publicKey,
        platform: platformName(),
        client_version: app.getVersion().replace(/^v/, '')
      },
      createDesktopAuthorizationResponseSchema
    )

    this.storedState = {
      ...this.storedState,
      device,
      pending: {
        authorizationId: created.authorization_id,
        state: secrets.state,
        codeVerifier: secrets.codeVerifier,
        expiresAt: created.expires_at
      }
    }
    await this.persistState()
    this.emitStatus()

    try {
      await shell.openExternal(created.authorization_url)
    } catch (error) {
      this.storedState.pending = null
      await this.persistState()
      this.emitStatus()
      throw error
    }

    return this.currentStatus()
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
    const response = await net.fetch(`${resolveApiOrigin()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
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
