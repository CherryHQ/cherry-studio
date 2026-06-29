import { randomBytes } from 'node:crypto'

import { PkceOAuthClient } from '@main/utils/oauth/PkceOAuthClient'
import { GROK_CLI_PROVIDER_ID } from '@shared/data/presets/grokCli'
import { net } from 'electron'
import * as z from 'zod'

import { OAuthServiceError } from '../../errors'
import type { OAuthRuntimeProviderDefinition } from '../types'

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

export const grokOAuthProvider = {
  providerId: GROK_CLI_PROVIDER_ID,
  clientId: GROK_CONFIG.CLIENT_ID,
  // OAuth is the only credential; logout/token loss disables the provider.
  clearDisablesProvider: true,
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
} satisfies OAuthRuntimeProviderDefinition
