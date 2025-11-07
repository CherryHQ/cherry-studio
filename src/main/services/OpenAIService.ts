import path from 'node:path'

import { loggerService } from '@logger'
import { getConfigDir } from '@main/utils/file'
import * as crypto from 'crypto'
import { net, shell } from 'electron'
import { promises } from 'fs'
import { dirname } from 'path'

const logger = loggerService.withContext('OpenAIOAuth')

// Client configuration
const DEFAULT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CREDS_PATH = path.join(getConfigDir(), 'oauth', 'openai.json')
const REDIRECT_URI = 'http://localhost:1455/auth/callback'
const ISSUER = 'https://auth.openai.com'

interface Credentials {
  access_token: string
  refresh_token: string
  expires_at: number
  id_token?: string
}

interface PKCEState {
  verifier: string
  challenge: string
  state: string
}

class OpenAIService {
  private current: PKCEState | null = null

  private generatePKCEState(): PKCEState {
    const verifier = crypto.randomBytes(32).toString('base64url')
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
    const state = crypto.randomBytes(16).toString('base64url')
    return { verifier, challenge, state }
  }

  private buildAuthorizeUrl(pkce: PKCEState, clientId: string): string {
    const url = new URL(`${ISSUER}/oauth/authorize`)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', REDIRECT_URI)
    url.searchParams.set('scope', 'openid profile email offline_access')
    url.searchParams.set('code_challenge', pkce.challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('state', pkce.state)
    // Only required OAuth params; remove non-essential extras
    logger.debug(`Built OpenAI authorize URL: ${url.toString()}`)
    return url.toString()
  }

  private async exchangeCodeForTokens(code: string, verifier: string, clientId: string): Promise<Credentials> {
    const response = await net.fetch(`${ISSUER}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        code_verifier: verifier
      }).toString()
    })

    if (!response.ok) {
      throw new Error(`OpenAI token exchange failed: ${response.status} ${response.statusText}`)
    }
    const data = await response.json()
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
      id_token: data.id_token
    }
  }

  private async refreshAccessToken(refreshToken: string, clientId: string): Promise<Credentials> {
    const response = await net.fetch(`${ISSUER}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId
      }).toString()
    })

    if (!response.ok) {
      throw new Error(`OpenAI token refresh failed: ${response.status} ${response.statusText}`)
    }
    const data = await response.json()
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? refreshToken,
      expires_at: Date.now() + data.expires_in * 1000,
      id_token: data.id_token
    }
  }

  private async saveCredentials(creds: Credentials) {
    await promises.mkdir(dirname(CREDS_PATH), { recursive: true })
    await promises.writeFile(CREDS_PATH, JSON.stringify(creds, null, 2))
    await promises.chmod(CREDS_PATH, 0o600)
  }

  private async loadCredentials(): Promise<Credentials | null> {
    try {
      const txt = await promises.readFile(CREDS_PATH, 'utf-8')
      return JSON.parse(txt)
    } catch {
      return null
    }
  }

  public async getValidAccessToken(): Promise<string | null> {
    const clientId = DEFAULT_CLIENT_ID
    if (!clientId || clientId.startsWith('0000')) {
      logger.warn('OPENAI_OAUTH_CLIENT_ID is not set. OAuth may fail until configured.')
    }
    const creds = await this.loadCredentials()
    if (!creds) return null
    if (creds.expires_at > Date.now() + 60000) {
      return creds.access_token
    }
    try {
      const refreshed = await this.refreshAccessToken(creds.refresh_token, clientId)
      // Preserve previous id_token if refresh did not include one
      const merged: Credentials = { ...refreshed, id_token: refreshed.id_token ?? creds.id_token }
      await this.saveCredentials(merged)
      return merged.access_token
    } catch (e) {
      logger.error('OpenAI access token refresh failed', e as Error)
      return null
    }
  }

  public async getApiKey(): Promise<string | null> {
    // For OAuth-based access, the access token serves as bearer token
    return this.getValidAccessToken()
  }

  public async startOAuthFlow(): Promise<string> {
    const clientId = DEFAULT_CLIENT_ID
    if (!clientId || clientId.startsWith('0000')) {
      logger.warn('OPENAI_OAUTH_CLIENT_ID is not set. Please configure it for production use.')
    }
    // If already have valid access, short-circuit
    const existing = await this.getValidAccessToken()
    if (existing) return 'already_authenticated'

    this.current = this.generatePKCEState()
    const authUrl = this.buildAuthorizeUrl(this.current, clientId)
    await shell.openExternal(authUrl)
    return authUrl
  }

  public async completeOAuthWithRedirectUrl(redirectUrl: string): Promise<string> {
    if (!this.current) {
      throw new Error('OAuth flow not started. Please call startOAuthFlow first.')
    }
    const clientId = DEFAULT_CLIENT_ID
    const url = new URL(redirectUrl)
    const code = url.searchParams.get('code') || ''
    const state = url.searchParams.get('state') || ''
    if (!code) {
      throw new Error('Authorization code not found in redirect URL')
    }
    if (!state || state !== this.current.state) {
      throw new Error('State mismatch detected')
    }
    try {
      const base = await this.exchangeCodeForTokens(code, this.current.verifier, clientId)
      await this.saveCredentials(base)
      this.current = null
      return base.access_token
    } catch (e) {
      this.current = null
      logger.error('OpenAI OAuth code exchange failed', e as Error)
      throw e
    }
  }

  public cancelOAuthFlow(): void {
    if (this.current) {
      logger.info('Cancelling OpenAI OAuth flow')
      this.current = null
    }
  }

  public async clearCredentials(): Promise<void> {
    try {
      await promises.unlink(CREDS_PATH)
      logger.info('OpenAI credentials cleared')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
  }

  public async hasCredentials(): Promise<boolean> {
    const creds = await this.loadCredentials()
    return creds !== null
  }

  public async getIdToken(): Promise<string | null> {
    const creds = await this.loadCredentials()
    return creds?.id_token ?? null
  }

  public async getAccountId(): Promise<string | null> {
    const idToken = await this.getIdToken()
    if (!idToken) return null
    try {
      const payload = this.decodeJwtPayload(idToken)
      if (!payload) return null
      // Try common fields for account/user identifiers
      const candidates = [payload.account_id, payload.chatgpt_user_id, payload.aid, payload.sub]
      const id = candidates.find((v) => typeof v === 'string' && v.length > 0)
      return id ?? null
    } catch (e) {
      logger.warn('Failed to parse OpenAI ID token for account id', e as Error)
      return null
    }
  }

  public async getSessionId(): Promise<string | null> {
    // Derive a stable session id from ID token claims when possible
    const idToken = await this.getIdToken()
    if (!idToken) return null
    try {
      const payload = this.decodeJwtPayload(idToken)
      // Prefer standard-ish fields if present
      const rawCandidate = (payload && (payload.sid || payload.session_id || payload.jti || payload.sub)) || idToken
      const hash = crypto.createHash('sha256').update(String(rawCandidate)).digest('hex').slice(0, 32)
      return `sess_${hash}`
    } catch (e) {
      logger.warn('Failed to derive OpenAI session id', e as Error)
      return null
    }
  }

  private decodeJwtPayload(token: string): any | null {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payload = parts[1]
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padLen = (4 - (normalized.length % 4)) % 4
    const padded = normalized + '='.repeat(padLen)
    const json = Buffer.from(padded, 'base64').toString('utf8')
    return JSON.parse(json)
  }
}

export default new OpenAIService()
