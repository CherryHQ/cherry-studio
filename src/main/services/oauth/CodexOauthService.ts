import { Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import {
  type LoopbackConfig,
  type LoopbackOAuthChannels,
  LoopbackOAuthService
} from '@main/services/oauth/LoopbackOAuthService'
import { PkceOAuthClient } from '@main/utils/oauth/PkceOAuthClient'
import { OPENAI_CODEX_PROVIDER_ID } from '@shared/data/presets/codex'
import type { OAuthAuthConfig } from '@shared/data/types/provider'
import { IpcChannel } from '@shared/IpcChannel'

// OpenAI Codex OAuth configuration. The client_id and the loopback redirect URI
// are fixed by OpenAI's registered OAuth client (the same one the Codex CLI
// uses) — they cannot be changed app-side.
const CODEX_CONFIG = {
  CLIENT_ID: 'app_EMoamEEZ73f0CkXaXp7hrann',
  AUTHORIZE_URL: 'https://auth.openai.com/oauth/authorize',
  TOKEN_URL: 'https://auth.openai.com/oauth/token',
  REDIRECT_URI: 'http://localhost:1455/auth/callback',
  CALLBACK_HOSTS: ['127.0.0.1', '::1'],
  CALLBACK_PORT: 1455,
  CALLBACK_PATH: '/auth/callback',
  SCOPE: 'openid profile email offline_access',
  // ChatGPT account id lives under this namespaced claim in the access token.
  JWT_CLAIM_PATH: 'https://api.openai.com/auth'
} as const

export interface CodexAccount {
  accountId: string | null
}

@Injectable('CodexOauthService')
@ServicePhase(Phase.Background)
export class CodexOauthService extends LoopbackOAuthService {
  protected readonly providerId = OPENAI_CODEX_PROVIDER_ID
  protected readonly clientId = CODEX_CONFIG.CLIENT_ID
  protected readonly loopback: LoopbackConfig = {
    hosts: CODEX_CONFIG.CALLBACK_HOSTS,
    port: CODEX_CONFIG.CALLBACK_PORT,
    path: CODEX_CONFIG.CALLBACK_PATH,
    redirectUri: CODEX_CONFIG.REDIRECT_URI
  }
  protected readonly channels: LoopbackOAuthChannels = {
    signIn: IpcChannel.Codex_SignIn,
    hasToken: IpcChannel.Codex_HasToken,
    logout: IpcChannel.Codex_Logout
  }

  // Static endpoint, so the PKCE client is built once. The base owns the
  // loopback transport and token lifecycle; this service only adds the
  // account-id extraction and its sign-in/account return shape.
  private readonly oauthClient = new PkceOAuthClient({
    clientId: CODEX_CONFIG.CLIENT_ID,
    authorizeUrl: CODEX_CONFIG.AUTHORIZE_URL,
    tokenUrl: CODEX_CONFIG.TOKEN_URL,
    redirectUri: CODEX_CONFIG.REDIRECT_URI,
    scope: CODEX_CONFIG.SCOPE,
    extraAuthParams: {
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true'
    }
  })

  protected onInit(): void {
    super.onInit()
    this.ipcHandle(IpcChannel.Codex_GetAccount, this.getAccount)
  }

  protected getClient(): PkceOAuthClient {
    return this.oauthClient
  }

  /**
   * Decode the `chatgpt_account_id` claim from a Codex access token. Returns
   * `null` for any malformed token rather than throwing — the account id is a
   * convenience header, not a hard requirement for every code path.
   */
  private extractAccountId(accessToken: string): string | null {
    try {
      const parts = accessToken.split('.')
      if (parts.length !== 3) return null
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'))
      const accountId = payload?.[CODEX_CONFIG.JWT_CLAIM_PATH]?.chatgpt_account_id
      return typeof accountId === 'string' && accountId.length > 0 ? accountId : null
    } catch {
      return null
    }
  }

  protected extraAuthFields(accessToken: string, current: OAuthAuthConfig | null): Record<string, unknown> {
    const accountId = this.extractAccountId(accessToken) ?? current?.accountId
    return accountId ? { accountId } : {}
  }

  // ── Public surface (runtime + IPC) ──

  /**
   * Return a valid access token (refreshing if expired) plus the account id, for
   * the runtime config builder. Returns `null` when the user is not signed in or
   * the refresh failed — the caller surfaces the missing-credential error.
   */
  public getValidAccessToken = async (): Promise<{ accessToken: string; accountId: string | null } | null> => {
    const accessToken = await this.getValidToken()
    if (!accessToken) return null

    const config = await this.getOAuthAuthConfig()
    return { accessToken, accountId: config?.accountId ?? null }
  }

  public signIn = async (): Promise<CodexAccount> => {
    await this.runSignIn()
    const config = await this.getOAuthAuthConfig()
    return { accountId: config?.accountId ?? null }
  }

  public getAccount = async (): Promise<CodexAccount> => {
    const config = await this.getOAuthAuthConfig()
    return { accountId: config?.accountId ?? null }
  }
}
