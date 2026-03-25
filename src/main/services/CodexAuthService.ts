import { loggerService } from '@logger'
import { app, clipboard, net, safeStorage, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { URLSearchParams } from 'node:url'

import { getConfigDir } from '../utils/file'

const logger = loggerService.withContext('CodexAuthService')

const CONFIG = {
  API_URLS: {
    CODEX_BASE: 'https://chatgpt.com/backend-api/codex',
    MODELS: '/models',
    AUTH_ISSUER: 'https://auth.openai.com',
    TOKEN: '/oauth/token'
  },
  TOKEN_FILE_NAME: '.codex_auth',
  MODELS_CACHE_FILE_NAME: '.codex_models_cache',
  MODELS_CACHE_TTL_MS: 10 * 60 * 1000,
  CLIENT_ID: 'app_EMoamEEZ73f0CkXaXp7hrann'
} as const

interface CodexAuthData {
  accessToken: string
  refreshToken?: string
  idToken?: string
  accountId?: string
  expiresAt?: number
  lastRefreshAt?: number
}

interface CodexAuthStatus {
  isAuthed: boolean
  accountId?: string
  expiresAt?: number
  lastRefreshAt?: number
}

interface CodexModel {
  id: string
  name: string
  description?: string
  provider: string
  group?: string
  supported_endpoint_types?: string[]
  max_tokens?: number
}

interface CodexModelsCache {
  fetchedAt: number
  etag?: string
  models: CodexModel[]
}

interface CodexModelsResponse {
  models: Array<{
    slug: string
    display_name: string
    description?: string
    supported_endpoint_types?: string[]
    max_tokens?: number
  }>
}

interface OAuthTokenResponse {
  id_token?: string
  access_token: string
  refresh_token?: string
  expires_in?: number
}

interface JwtPayload {
  exp?: number
  [key: string]: unknown
}

interface OpenAiAuthClaims {
  chatgpt_account_id?: string
  chatgpt_plan_type?: string
  [key: string]: unknown
}

interface DeviceCodeStartResponse {
  device_auth_id: string
  user_code: string
  interval: string | number
}

interface DeviceCodeTokenResponse {
  authorization_code: string
  code_challenge: string
  code_verifier: string
}

interface PendingDeviceCodeLogin {
  verificationUrl: string
  userCode: string
  deviceAuthId: string
  intervalSeconds: number
  startedAt: number
}

class CodexServiceError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'CodexServiceError'
  }
}

class CodexAuthService {
  private readonly authFilePath: string
  private readonly modelsCacheFilePath: string
  private pendingDeviceCodeLogin: PendingDeviceCodeLogin | null = null

  constructor() {
    this.authFilePath = this.getAuthFilePath()
    this.modelsCacheFilePath = this.getModelsCacheFilePath()
  }

  private getAuthFilePath = (): string => {
    const oldPath = path.join(app.getPath('userData'), CONFIG.TOKEN_FILE_NAME)
    if (fs.existsSync(oldPath)) {
      return oldPath
    }
    return path.join(getConfigDir(), CONFIG.TOKEN_FILE_NAME)
  }

  private getModelsCacheFilePath = (): string => {
    return path.join(getConfigDir(), CONFIG.MODELS_CACHE_FILE_NAME)
  }

  private getAuthStoragePayload = (authData: CodexAuthData): Buffer => {
    const json = JSON.stringify(authData)
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(json)
    }

    return Buffer.from(json, 'utf-8')
  }

  private parseStoredAuthPayload = (data: Buffer): CodexAuthData => {
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(data) : data.toString('utf-8')
    return JSON.parse(json) as CodexAuthData
  }

  private decodeJwtPayload = (token?: string): JwtPayload | null => {
    if (!token) {
      return null
    }

    const parts = token.split('.')
    if (parts.length < 2) {
      return null
    }

    try {
      const payload = Buffer.from(parts[1], 'base64url').toString('utf-8')
      return JSON.parse(payload) as JwtPayload
    } catch (error) {
      logger.warn('Failed to decode JWT payload', error as Error)
      return null
    }
  }

  private getOpenAiAuthClaims = (token?: string): OpenAiAuthClaims | null => {
    const payload = this.decodeJwtPayload(token)
    if (!payload) {
      return null
    }

    const claims = payload['https://api.openai.com/auth']
    if (!claims || typeof claims !== 'object') {
      return null
    }

    return claims as OpenAiAuthClaims
  }

  private requestDeviceCode = async (): Promise<PendingDeviceCodeLogin> => {
    const response = await fetch(`${CONFIG.API_URLS.AUTH_ISSUER}/api/accounts/deviceauth/usercode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: CONFIG.CLIENT_ID
      })
    })

    if (!response.ok) {
      throw new CodexServiceError(`Device code request failed with status ${response.status}`)
    }

    const data = (await response.json()) as DeviceCodeStartResponse

    return {
      verificationUrl: `${CONFIG.API_URLS.AUTH_ISSUER}/codex/device`,
      userCode: data.user_code,
      deviceAuthId: data.device_auth_id,
      intervalSeconds: Number(data.interval) || 5,
      startedAt: Date.now()
    }
  }

  private pollDeviceCodeForAuthorizationCode = async (pendingLogin: PendingDeviceCodeLogin) => {
    const timeoutAt = pendingLogin.startedAt + 15 * 60 * 1000

    while (Date.now() < timeoutAt) {
      const response = await fetch(`${CONFIG.API_URLS.AUTH_ISSUER}/api/accounts/deviceauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          device_auth_id: pendingLogin.deviceAuthId,
          user_code: pendingLogin.userCode
        })
      })

      if (response.ok) {
        return (await response.json()) as DeviceCodeTokenResponse
      }

      if (response.status !== 403 && response.status !== 404) {
        throw new CodexServiceError(`Device auth polling failed with status ${response.status}`)
      }

      await new Promise((resolve) => setTimeout(resolve, pendingLogin.intervalSeconds * 1000))
    }

    throw new CodexServiceError('Device code login timed out after 15 minutes')
  }

  private exchangeAuthorizationCode = async (authorizationCode: string, codeVerifier: string) => {
    const redirectUri = `${CONFIG.API_URLS.AUTH_ISSUER}/deviceauth/callback`

    return this.exchangeCodeForTokens(redirectUri, codeVerifier, authorizationCode)
  }

  private completePendingDeviceCodeLogin = async (pendingLogin: PendingDeviceCodeLogin) => {
    try {
      const codeResponse = await this.pollDeviceCodeForAuthorizationCode(pendingLogin)
      const tokens = await this.exchangeAuthorizationCode(
        codeResponse.authorization_code,
        codeResponse.code_verifier
      )
      const authData = this.buildAuthData(tokens)
      await this.saveAuthData(authData)
      this.pendingDeviceCodeLogin = null
      logger.info('Codex device code login completed successfully')
    } catch (error) {
      logger.error('Codex device code login failed', error as Error)
      this.pendingDeviceCodeLogin = null
      throw error
    }
  }

  private exchangeCodeForTokens = async (redirectUri: string, codeVerifier: string, code: string) => {
    const response = await fetch(`${CONFIG.API_URLS.AUTH_ISSUER}${CONFIG.API_URLS.TOKEN}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: CONFIG.CLIENT_ID,
        code_verifier: codeVerifier
      }).toString()
    })

    if (!response.ok) {
      throw new CodexServiceError(`Token exchange failed with status ${response.status}`)
    }

    return (await response.json()) as OAuthTokenResponse
  }

  private refreshTokens = async (refreshToken: string) => {
    const response = await fetch(`${CONFIG.API_URLS.AUTH_ISSUER}${CONFIG.API_URLS.TOKEN}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: CONFIG.CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      })
    })

    if (!response.ok) {
      throw new CodexServiceError(`Token refresh failed with status ${response.status}`)
    }

    return (await response.json()) as OAuthTokenResponse
  }

  private buildAuthData = (tokens: OAuthTokenResponse, currentAuthData?: CodexAuthData): CodexAuthData => {
    const idClaims = this.getOpenAiAuthClaims(tokens.id_token)
    const payload = this.decodeJwtPayload(tokens.access_token) ?? this.decodeJwtPayload(tokens.id_token)
    const expiresAt = payload?.exp ? payload.exp * 1000 : currentAuthData?.expiresAt

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? currentAuthData?.refreshToken,
      idToken: tokens.id_token ?? currentAuthData?.idToken,
      accountId: idClaims?.chatgpt_account_id ?? currentAuthData?.accountId,
      expiresAt,
      lastRefreshAt: Date.now()
    }
  }

  private shouldRefreshToken = (authData: CodexAuthData): boolean => {
    if (!authData.refreshToken) {
      return false
    }

    if (!authData.expiresAt) {
      return false
    }

    return Date.now() >= authData.expiresAt - 5 * 60 * 1000
  }

  private fetchModelsFromRemote = async (headers: Record<string, string>) => {
    const response = await net.fetch(
      `${CONFIG.API_URLS.CODEX_BASE}${CONFIG.API_URLS.MODELS}?client_version=${encodeURIComponent(app.getVersion())}`,
      {
        method: 'GET',
        headers
      }
    )

    return response
  }

  public startLogin = async (): Promise<{ loginUrl: string; state: string; userCode: string }> => {
    try {
      const pendingLogin = await this.requestDeviceCode()
      this.pendingDeviceCodeLogin = pendingLogin
      clipboard.writeText(pendingLogin.userCode)
      await shell.openExternal(pendingLogin.verificationUrl)
      void this.completePendingDeviceCodeLogin(pendingLogin)

      logger.info('Codex device code login initiated')

      return {
        loginUrl: pendingLogin.verificationUrl,
        state: pendingLogin.userCode,
        userCode: pendingLogin.userCode
      }
    } catch (error) {
      logger.error('Failed to start Codex login', error as Error)
      throw new CodexServiceError('Failed to start Codex login', error)
    }
  }

  public handleCallback = async (): Promise<CodexAuthStatus> => {
    return this.getAuthStatus()
  }

  private saveAuthData = async (authData: CodexAuthData): Promise<void> => {
    try {
      const encryptedData = this.getAuthStoragePayload(authData)
      const dir = path.dirname(this.authFilePath)
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true })
      }

      await fs.promises.writeFile(this.authFilePath, encryptedData)
      logger.debug('Codex auth data saved')
    } catch (error) {
      logger.error('Failed to save Codex auth data', error as Error)
      throw new CodexServiceError('Failed to save Codex auth data', error)
    }
  }

  private readAuthData = async (): Promise<CodexAuthData | null> => {
    try {
      if (!fs.existsSync(this.authFilePath)) {
        return null
      }

      const encryptedData = await fs.promises.readFile(this.authFilePath)
      return this.parseStoredAuthPayload(Buffer.from(encryptedData))
    } catch (error) {
      logger.error('Failed to read Codex auth data', error as Error)
      return null
    }
  }

  public getAuthStatus = async (): Promise<CodexAuthStatus> => {
    await this.refreshTokenIfNeeded()

    const authData = await this.readAuthData()
    if (!authData?.accessToken) {
      return { isAuthed: false }
    }

    return {
      isAuthed: true,
      accountId: authData.accountId,
      expiresAt: authData.expiresAt,
      lastRefreshAt: authData.lastRefreshAt
    }
  }

  public getAccessHeaders = async (): Promise<Record<string, string> | null> => {
    try {
      await this.refreshTokenIfNeeded()
      const authData = await this.readAuthData()
      if (!authData?.accessToken) {
        return null
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${authData.accessToken}`,
        'Content-Type': 'application/json',
        originator: 'codex_cli_rs',
        version: app.getVersion(),
        'User-Agent': `codex_cli_rs/${app.getVersion()} (Cherry Studio)`
      }

      if (authData.accountId) {
        headers['ChatGPT-Account-ID'] = authData.accountId
      }

      return headers
    } catch (error) {
      logger.error('Failed to get Codex access headers', error as Error)
      return null
    }
  }

  public refreshTokenIfNeeded = async (): Promise<boolean> => {
    try {
      const authData = await this.readAuthData()

      if (!authData?.accessToken) {
        return false
      }

      if (!authData.refreshToken) {
        return !!authData?.accessToken
      }

      if (!this.shouldRefreshToken(authData)) {
        return true
      }

      const refreshed = await this.refreshTokens(authData.refreshToken)
      const refreshedAuthData = this.buildAuthData(refreshed, authData)
      await this.saveAuthData(refreshedAuthData)
      logger.info('Codex token refreshed successfully')

      return true
    } catch (error) {
      logger.error('Failed to refresh Codex token', error as Error)
      return false
    }
  }

  public logout = async (): Promise<void> => {
    try {
      this.pendingDeviceCodeLogin = null
      if (fs.existsSync(this.authFilePath)) {
        await fs.promises.unlink(this.authFilePath)
      }
      if (fs.existsSync(this.modelsCacheFilePath)) {
        await fs.promises.unlink(this.modelsCacheFilePath)
      }
      logger.info('Codex logout completed')
    } catch (error) {
      logger.error('Failed to logout from Codex', error as Error)
      throw new CodexServiceError('Failed to logout from Codex', error)
    }
  }

  public fetchModels = async (
    _: Electron.IpcMainInvokeEvent,
    force: boolean = false
  ): Promise<CodexModel[]> => {
    try {
      const headers = await this.getAccessHeaders()
      if (!headers) {
        throw new CodexServiceError('Not authenticated with Codex')
      }

      if (!force) {
        const cachedModels = await this.readModelsCache()
        if (cachedModels && Date.now() - cachedModels.fetchedAt < CONFIG.MODELS_CACHE_TTL_MS) {
          logger.debug('Returning cached Codex models')
          return cachedModels.models
        }
      }

      let response = await this.fetchModelsFromRemote(headers)

      if (response.status === 401) {
        logger.warn('Codex models request returned 401, attempting token refresh')
        const refreshed = await this.refreshTokenIfNeeded()
        if (refreshed) {
          const refreshedHeaders = await this.getAccessHeaders()
          if (refreshedHeaders) {
            response = await this.fetchModelsFromRemote(refreshedHeaders)
          }
        }
      }

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`HTTP ${response.status}: ${response.statusText}; ${errorText}`)
      }

      const data = (await response.json()) as CodexModelsResponse
      const models: CodexModel[] = data.models.map((model) => ({
        id: model.slug,
        name: model.display_name,
        description: model.description,
        provider: 'codex',
        supported_endpoint_types: model.supported_endpoint_types,
        max_tokens: model.max_tokens
      }))

      await this.writeModelsCache({
        fetchedAt: Date.now(),
        etag: response.headers.get('etag') ?? undefined,
        models
      })

      logger.info('Codex models fetched successfully', { count: models.length })
      return models
    } catch (error) {
      logger.error('Failed to fetch Codex models', error as Error)
      throw new CodexServiceError('Failed to fetch Codex models', error)
    }
  }

  private readModelsCache = async (): Promise<CodexModelsCache | null> => {
    try {
      if (!fs.existsSync(this.modelsCacheFilePath)) {
        return null
      }

      const data = await fs.promises.readFile(this.modelsCacheFilePath, 'utf-8')
      return JSON.parse(data) as CodexModelsCache
    } catch (error) {
      logger.error('Failed to read Codex models cache', error as Error)
      return null
    }
  }

  private writeModelsCache = async (cache: CodexModelsCache): Promise<void> => {
    try {
      const dir = path.dirname(this.modelsCacheFilePath)
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true })
      }

      await fs.promises.writeFile(this.modelsCacheFilePath, JSON.stringify(cache, null, 2))
    } catch (error) {
      logger.error('Failed to write Codex models cache', error as Error)
    }
  }

  public setAccountId = async (_: Electron.IpcMainInvokeEvent, accountId: string): Promise<void> => {
    try {
      const authData = await this.readAuthData()
      if (authData) {
        authData.accountId = accountId
        await this.saveAuthData(authData)
        logger.debug('Codex account ID set')
      }
    } catch (error) {
      logger.error('Failed to set Codex account ID', error as Error)
      throw new CodexServiceError('Failed to set Codex account ID', error)
    }
  }

  public setAccessToken = async (
    _: Electron.IpcMainInvokeEvent,
    accessToken: string,
    accountId?: string
  ): Promise<void> => {
    try {
      const idClaims = this.getOpenAiAuthClaims(accessToken)
      const payload = this.decodeJwtPayload(accessToken)

      const authData: CodexAuthData = {
        accessToken,
        accountId: accountId ?? idClaims?.chatgpt_account_id,
        expiresAt: payload?.exp ? payload.exp * 1000 : undefined,
        lastRefreshAt: Date.now()
      }
      await this.saveAuthData(authData)
      logger.info('Codex access token set')
    } catch (error) {
      logger.error('Failed to set Codex access token', error as Error)
      throw new CodexServiceError('Failed to set Codex access token', error)
    }
  }

  public clearModelsCache = async (): Promise<void> => {
    try {
      if (fs.existsSync(this.modelsCacheFilePath)) {
        await fs.promises.unlink(this.modelsCacheFilePath)
      }
    } catch (error) {
      logger.error('Failed to clear Codex models cache', error as Error)
    }
  }
}

export default new CodexAuthService()
