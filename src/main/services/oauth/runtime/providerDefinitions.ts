import { randomBytes } from 'node:crypto'

import { PkceOAuthClient } from '@main/utils/oauth/PkceOAuthClient'
import { OPENAI_CODEX_PROVIDER_ID } from '@shared/data/presets/codex'
import { GROK_CLI_PROVIDER_ID } from '@shared/data/presets/grokCli'
import { SystemProviderIds } from '@shared/utils/systemProviderId'
import { net } from 'electron'
import * as z from 'zod'

import { OAuthServiceError } from '../errors'
import type { OAuthRuntimeProviderDefinition } from './types'

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

const GROK_CONFIG = {
  CLIENT_ID: 'b1a00492-073a-47ea-816f-4c329264a828',
  DISCOVERY_URL: 'https://auth.x.ai/.well-known/openid-configuration',
  REDIRECT_URI: 'http://127.0.0.1:56121/callback',
  CALLBACK_HOST: '127.0.0.1',
  CALLBACK_PORT: 56121,
  CALLBACK_PATH: '/callback',
  SCOPE: 'openid profile email offline_access grok-cli:access api:access'
} as const

const DiscoverySchema = z.object({
  authorization_endpoint: z.string(),
  token_endpoint: z.string()
})

type Discovery = z.infer<typeof DiscoverySchema>
let grokDiscoveryCache: Discovery | null = null

function extractCodexAccountId(accessToken: string): string | null {
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

function assertXaiEndpoint(url: string): string {
  const parsed = new URL(url)
  const host = parsed.hostname.toLowerCase()
  if (parsed.protocol !== 'https:' || (host !== 'x.ai' && !host.endsWith('.x.ai'))) {
    throw new OAuthServiceError(`xAI OAuth discovery returned an unexpected endpoint: ${url}`)
  }
  return url
}

async function discoverGrok(): Promise<Discovery> {
  if (grokDiscoveryCache) return grokDiscoveryCache
  const response = await net.fetch(GROK_CONFIG.DISCOVERY_URL, { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    throw new OAuthServiceError(`xAI OAuth discovery failed: ${response.status}`)
  }
  const data = DiscoverySchema.parse(await response.json())
  grokDiscoveryCache = {
    authorization_endpoint: assertXaiEndpoint(data.authorization_endpoint),
    token_endpoint: assertXaiEndpoint(data.token_endpoint)
  }
  return grokDiscoveryCache
}

export const oauthProviderDefinitions = {
  [OPENAI_CODEX_PROVIDER_ID]: {
    providerId: OPENAI_CODEX_PROVIDER_ID,
    clientId: CODEX_CONFIG.CLIENT_ID,
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
  },
  [GROK_CLI_PROVIDER_ID]: {
    providerId: GROK_CLI_PROVIDER_ID,
    clientId: GROK_CONFIG.CLIENT_ID,
    transport: {
      type: 'loopback',
      config: {
        hosts: [GROK_CONFIG.CALLBACK_HOST],
        port: GROK_CONFIG.CALLBACK_PORT,
        path: GROK_CONFIG.CALLBACK_PATH,
        redirectUri: GROK_CONFIG.REDIRECT_URI
      }
    },
    createClient: async () => {
      const discovery = await discoverGrok()
      const nonce = randomBytes(16).toString('hex')
      return new PkceOAuthClient({
        clientId: GROK_CONFIG.CLIENT_ID,
        authorizeUrl: discovery.authorization_endpoint,
        tokenUrl: discovery.token_endpoint,
        redirectUri: GROK_CONFIG.REDIRECT_URI,
        scope: GROK_CONFIG.SCOPE,
        extraAuthParams: { nonce }
      })
    }
  },
  [SystemProviderIds.cherryin]: {
    providerId: SystemProviderIds.cherryin,
    clientId: '',
    transport: { type: 'deep-link' },
    createClient: () => {
      throw new OAuthServiceError('CherryIN OAuth is not registered in OAuthRuntimeService yet')
    }
  }
} satisfies Record<string, OAuthRuntimeProviderDefinition>

export type OAuthProviderId = keyof typeof oauthProviderDefinitions
