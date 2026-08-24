import { OPENAI_CODEX_PROVIDER_ID } from '@shared/data/presets/codex'

import { PkceOAuthClient } from '../PkceOAuthClient'
import type { OAuthRuntimeProviderDefinition } from '../types'

const CODEX_CONFIG = {
  CLIENT_ID: 'app_EMoamEEZ73f0CkXaXp7hrann',
  AUTHORIZE_URL: 'https://auth.openai.com/oauth/authorize',
  TOKEN_URL: 'https://auth.openai.com/oauth/token',
  REDIRECT_URI: 'http://localhost:1455/auth/callback',
  CALLBACK_HOSTS: ['127.0.0.1', '::1'],
  CALLBACK_PORT: 1455,
  CALLBACK_PATH: '/auth/callback',
  SCOPE: 'openid profile email offline_access',
  JWT_CLAIM_PATH: 'https://api.openai.com/auth'
} as const

function extractCodexAccountId(accessToken: string): string | null {
  try {
    const parts = accessToken.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'))
    const accountId = payload?.[CODEX_CONFIG.JWT_CLAIM_PATH]?.chatgpt_account_id
    return typeof accountId === 'string' && accountId.length > 0 ? accountId : null
  } catch {
    return null
  }
}

export const codexOAuthProvider = {
  providerId: OPENAI_CODEX_PROVIDER_ID,
  clientId: CODEX_CONFIG.CLIENT_ID,
  // OAuth is the only credential; logout/token loss disables the provider.
  clearDisablesProvider: true,
  transport: {
    type: 'loopback',
    config: {
      hosts: CODEX_CONFIG.CALLBACK_HOSTS,
      port: CODEX_CONFIG.CALLBACK_PORT,
      path: CODEX_CONFIG.CALLBACK_PATH,
      redirectUri: CODEX_CONFIG.REDIRECT_URI
    }
  },
  createClient: () =>
    new PkceOAuthClient({
      clientId: CODEX_CONFIG.CLIENT_ID,
      authorizeUrl: CODEX_CONFIG.AUTHORIZE_URL,
      tokenUrl: CODEX_CONFIG.TOKEN_URL,
      redirectUri: CODEX_CONFIG.REDIRECT_URI,
      scope: CODEX_CONFIG.SCOPE,
      extraAuthParams: {
        id_token_add_organizations: 'true',
        codex_cli_simplified_flow: 'true'
      }
    }),
  extractAccountId: extractCodexAccountId
} satisfies OAuthRuntimeProviderDefinition
