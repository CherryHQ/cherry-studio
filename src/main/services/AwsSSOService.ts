import { GetRoleCredentialsCommand, SSOClient } from '@aws-sdk/client-sso'
import {
  AuthorizationPendingException,
  CreateTokenCommand,
  RegisterClientCommand,
  SlowDownException,
  SSOOIDCClient,
  StartDeviceAuthorizationCommand
} from '@aws-sdk/client-sso-oidc'
import { loggerService } from '@logger'
import { shell } from 'electron'

const logger = loggerService.withContext('AwsSSOService')

const SSO_CLIENT_NAME = 'CherryStudio'
const SSO_CLIENT_TYPE = 'public'
const SSO_GRANT_TYPE_DEVICE_CODE = 'urn:ietf:params:oauth:grant-type:device_code'
const SSO_GRANT_TYPE_REFRESH_TOKEN = 'refresh_token'

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/
const ACCOUNT_ID_PATTERN = /^\d{12}$/
const REGION_PATTERN = /^[a-z]{2}(-[a-z]+-\d+)?$/

interface SSOConfig {
  startUrl: string
  ssoRegion: string
  accountId: string
  roleName: string
}

interface ClientRegistration {
  clientId: string
  clientSecret: string
  expiresAt: number
}

interface SSOToken {
  accessToken: string
  refreshToken?: string
  expiresAt: number
}

interface ResolvedCredentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  expiration?: number
}

function validateSSOConfig(config: SSOConfig): void {
  if (!config.startUrl || !config.startUrl.startsWith('https://')) {
    throw new Error('SSO Start URL must be a valid HTTPS URL')
  }
  if (!config.ssoRegion || !REGION_PATTERN.test(config.ssoRegion)) {
    throw new Error('SSO Region must be a valid AWS region (e.g., us-east-1)')
  }
  if (!config.accountId || !ACCOUNT_ID_PATTERN.test(config.accountId)) {
    throw new Error('Account ID must be a 12-digit number')
  }
  if (!config.roleName || !PROFILE_NAME_PATTERN.test(config.roleName)) {
    throw new Error('Role Name must contain only alphanumeric characters, hyphens, underscores, and dots')
  }
}

class AwsSSOService {
  private clientRegistration: ClientRegistration | null = null
  private ssoToken: SSOToken | null = null
  private cachedCredentials: ResolvedCredentials | null = null
  private currentConfig: SSOConfig | null = null

  private isConfigChanged(config: SSOConfig): boolean {
    if (!this.currentConfig) return true
    return (
      this.currentConfig.startUrl !== config.startUrl ||
      this.currentConfig.ssoRegion !== config.ssoRegion ||
      this.currentConfig.accountId !== config.accountId ||
      this.currentConfig.roleName !== config.roleName
    )
  }

  private invalidateAll(): void {
    this.ssoToken = null
    this.cachedCredentials = null
  }

  private async getOrRegisterClient(ssoRegion: string): Promise<ClientRegistration> {
    if (this.clientRegistration && Date.now() < this.clientRegistration.expiresAt) {
      return this.clientRegistration
    }

    const oidcClient = new SSOOIDCClient({ region: ssoRegion })
    const response = await oidcClient.send(
      new RegisterClientCommand({
        clientName: SSO_CLIENT_NAME,
        clientType: SSO_CLIENT_TYPE,
        scopes: ['sso:account:access']
      })
    )

    if (!response.clientId || !response.clientSecret) {
      throw new Error('Failed to register OIDC client: missing clientId or clientSecret')
    }

    this.clientRegistration = {
      clientId: response.clientId,
      clientSecret: response.clientSecret,
      expiresAt: (response.clientSecretExpiresAt ?? 0) * 1000
    }

    return this.clientRegistration
  }

  private async pollForToken(
    oidcClient: SSOOIDCClient,
    clientId: string,
    clientSecret: string,
    deviceCode: string,
    intervalSeconds: number,
    expiresIn: number
  ): Promise<SSOToken> {
    const deadline = Date.now() + expiresIn * 1000
    let pollInterval = intervalSeconds * 1000

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval))

      try {
        const tokenResponse = await oidcClient.send(
          new CreateTokenCommand({
            clientId,
            clientSecret,
            grantType: SSO_GRANT_TYPE_DEVICE_CODE,
            deviceCode
          })
        )

        if (!tokenResponse.accessToken) {
          throw new Error('Token response missing accessToken')
        }

        return {
          accessToken: tokenResponse.accessToken,
          refreshToken: tokenResponse.refreshToken,
          expiresAt: Date.now() + (tokenResponse.expiresIn ?? 3600) * 1000
        }
      } catch (error) {
        if (error instanceof AuthorizationPendingException) {
          continue
        }
        if (error instanceof SlowDownException) {
          pollInterval += 5000
          continue
        }
        throw error
      }
    }

    throw new Error('SSO login timed out. Please try again.')
  }

  private async refreshSSOToken(ssoRegion: string): Promise<SSOToken> {
    if (!this.ssoToken?.refreshToken || !this.clientRegistration) {
      throw new Error('Cannot refresh SSO token: no refresh token or client registration available')
    }

    const oidcClient = new SSOOIDCClient({ region: ssoRegion })
    const tokenResponse = await oidcClient.send(
      new CreateTokenCommand({
        clientId: this.clientRegistration.clientId,
        clientSecret: this.clientRegistration.clientSecret,
        grantType: SSO_GRANT_TYPE_REFRESH_TOKEN,
        refreshToken: this.ssoToken.refreshToken
      })
    )

    if (!tokenResponse.accessToken) {
      throw new Error('Token refresh failed: missing accessToken')
    }

    this.ssoToken = {
      accessToken: tokenResponse.accessToken,
      refreshToken: tokenResponse.refreshToken ?? this.ssoToken.refreshToken,
      expiresAt: Date.now() + (tokenResponse.expiresIn ?? 3600) * 1000
    }

    return this.ssoToken
  }

  private async fetchRoleCredentials(
    ssoRegion: string,
    accountId: string,
    roleName: string,
    accessToken: string
  ): Promise<ResolvedCredentials> {
    const ssoClient = new SSOClient({ region: ssoRegion })
    const response = await ssoClient.send(
      new GetRoleCredentialsCommand({
        roleName,
        accountId,
        accessToken
      })
    )

    const creds = response.roleCredentials
    if (!creds?.accessKeyId || !creds.secretAccessKey || !creds.sessionToken) {
      throw new Error('Failed to get role credentials: incomplete response')
    }

    return {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken,
      expiration: creds.expiration
    }
  }

  public ssoLogin = async (_event: Electron.IpcMainInvokeEvent, config: SSOConfig): Promise<{ success: boolean }> => {
    validateSSOConfig(config)
    logger.info('Starting SSO login flow', { startUrl: config.startUrl, ssoRegion: config.ssoRegion })

    if (this.isConfigChanged(config)) {
      this.invalidateAll()
    }
    this.currentConfig = { ...config }

    const registration = await this.getOrRegisterClient(config.ssoRegion)
    const oidcClient = new SSOOIDCClient({ region: config.ssoRegion })

    // Start device authorization
    const authResponse = await oidcClient.send(
      new StartDeviceAuthorizationCommand({
        clientId: registration.clientId,
        clientSecret: registration.clientSecret,
        startUrl: config.startUrl
      })
    )

    if (!authResponse.verificationUriComplete || !authResponse.deviceCode) {
      throw new Error('Device authorization failed: missing verification URI or device code')
    }

    // Open browser for user authentication
    await shell.openExternal(authResponse.verificationUriComplete)
    logger.info('Opened browser for SSO authentication')

    // Poll for token
    this.ssoToken = await this.pollForToken(
      oidcClient,
      registration.clientId,
      registration.clientSecret,
      authResponse.deviceCode,
      authResponse.interval ?? 5,
      authResponse.expiresIn ?? 600
    )

    // Verify credentials work
    this.cachedCredentials = await this.fetchRoleCredentials(
      config.ssoRegion,
      config.accountId,
      config.roleName,
      this.ssoToken.accessToken
    )

    logger.info('SSO login successful')
    return { success: true }
  }

  public resolveSSOCredentials = async (
    _event: Electron.IpcMainInvokeEvent,
    config: SSOConfig
  ): Promise<ResolvedCredentials> => {
    validateSSOConfig(config)

    // If config changed, invalidate caches
    if (this.isConfigChanged(config)) {
      this.invalidateAll()
      this.currentConfig = { ...config }
    }

    // Return cached credentials if still valid (5 minute buffer)
    if (this.cachedCredentials?.expiration && Date.now() < this.cachedCredentials.expiration - 5 * 60 * 1000) {
      return this.cachedCredentials
    }

    // Try to get fresh credentials using SSO token
    if (this.ssoToken && Date.now() < this.ssoToken.expiresAt - 60 * 1000) {
      this.cachedCredentials = await this.fetchRoleCredentials(
        config.ssoRegion,
        config.accountId,
        config.roleName,
        this.ssoToken.accessToken
      )
      return this.cachedCredentials
    }

    // Try refreshing the SSO token
    if (this.ssoToken?.refreshToken) {
      try {
        const refreshedToken = await this.refreshSSOToken(config.ssoRegion)
        this.cachedCredentials = await this.fetchRoleCredentials(
          config.ssoRegion,
          config.accountId,
          config.roleName,
          refreshedToken.accessToken
        )
        return this.cachedCredentials
      } catch (error) {
        logger.warn('SSO token refresh failed, login required', error as Error)
      }
    }

    throw new Error('SSO session expired. Please login again using the "Login with SSO" button.')
  }
}

export default new AwsSSOService()
