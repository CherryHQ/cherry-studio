import { randomBytes } from 'node:crypto'

import { Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { type LoopbackConfig, LoopbackOAuthService, OAuthServiceError } from '@main/services/oauth/LoopbackOAuthService'
import { PkceOAuthClient } from '@main/utils/oauth/PkceOAuthClient'
import { GROK_CLI_PROVIDER_ID } from '@shared/data/presets/grokCli'
import { net } from 'electron'
import * as z from 'zod'

// xAI OAuth configuration. The client_id is fixed by xAI's registered OAuth
// client (the same one the official Grok CLI uses). Endpoints are resolved at
// runtime via OIDC discovery rather than hardcoded, so they track xAI changes.
const GROK_CONFIG = {
  CLIENT_ID: 'b1a00492-073a-47ea-816f-4c329264a828',
  ISSUER: 'https://auth.x.ai',
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

@Injectable('GrokCliOauthService')
@ServicePhase(Phase.Background)
export class GrokCliOauthService extends LoopbackOAuthService {
  protected readonly providerId = GROK_CLI_PROVIDER_ID
  protected readonly clientId = GROK_CONFIG.CLIENT_ID
  protected readonly loopback: LoopbackConfig = {
    hosts: [GROK_CONFIG.CALLBACK_HOST],
    port: GROK_CONFIG.CALLBACK_PORT,
    path: GROK_CONFIG.CALLBACK_PATH,
    redirectUri: GROK_CONFIG.REDIRECT_URI
  }

  private discoveryCache: Discovery | null = null

  /**
   * Reject any discovered endpoint that is not served from `x.ai`, so a
   * compromised/spoofed discovery document cannot redirect the auth or token
   * exchange to an attacker-controlled host.
   */
  private assertXaiEndpoint(url: string): string {
    const host = new URL(url).hostname.toLowerCase()
    if (new URL(url).protocol !== 'https:' || (host !== 'x.ai' && !host.endsWith('.x.ai'))) {
      throw new OAuthServiceError(`xAI OAuth discovery returned an unexpected endpoint: ${url}`)
    }
    return url
  }

  private async discover(): Promise<Discovery> {
    if (this.discoveryCache) return this.discoveryCache
    const response = await net.fetch(GROK_CONFIG.DISCOVERY_URL, { headers: { Accept: 'application/json' } })
    if (!response.ok) {
      throw new OAuthServiceError(`xAI OAuth discovery failed: ${response.status}`)
    }
    const data = DiscoverySchema.parse(await response.json())
    this.discoveryCache = {
      authorization_endpoint: this.assertXaiEndpoint(data.authorization_endpoint),
      token_endpoint: this.assertXaiEndpoint(data.token_endpoint)
    }
    return this.discoveryCache
  }

  /**
   * Build a PKCE client bound to the discovered endpoints. A fresh `nonce`
   * (OIDC) is folded into the authorize URL; the token/refresh requests ignore
   * it. Rebuilt per call so discovery stays the source of truth for endpoints.
   */
  protected async getClient(): Promise<PkceOAuthClient> {
    const discovery = await this.discover()
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

  // ── Public surface (runtime + IPC) ──

  /**
   * Return a valid access token (refreshing if expired) for the runtime config
   * builder. Returns `null` when the user is not signed in or the refresh
   * failed — the caller surfaces the missing-credential error.
   */
  public getValidAccessToken = (): Promise<string | null> => this.getValidToken()
}
