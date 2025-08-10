/**
 * Reference:
 * This code is adapted from https://github.com/ThinkInAIXYZ/deepchat
 * Original file: src/main/presenter/anthropicOAuth.ts
 */
import path from 'node:path'

import { loggerService } from '@logger'
import * as crypto from 'crypto'
import { shell } from 'electron'
import { promises } from 'fs'
import os from 'os'
import { dirname } from 'path'

const logger = loggerService.withContext('AnthropicOAuth')

// Constants
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const CREDS_PATH = path.join(os.homedir(), '.cherrystudio', 'config', 'anthropic.json')

// Types
interface Credentials {
  access_token: string
  refresh_token: string
  expires_at: number
}

interface PKCEPair {
  verifier: string
  challenge: string
}

class AnthropicService extends Error {
  private currentPKCE: PKCEPair | null = null

  // 1. Generate PKCE pair
  private generatePKCE(): PKCEPair {
    const verifier = crypto.randomBytes(32).toString('base64url')
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')

    return { verifier, challenge }
  }

  // 2. Get OAuth authorization URL
  private getAuthorizationURL(pkce: PKCEPair): string {
    const url = new URL('https://claude.ai/oauth/authorize')

    url.searchParams.set('code', 'true')
    url.searchParams.set('client_id', CLIENT_ID)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('redirect_uri', 'https://console.anthropic.com/oauth/code/callback')
    url.searchParams.set('scope', 'org:create_api_key user:profile user:inference')
    url.searchParams.set('code_challenge', pkce.challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('state', pkce.verifier)

    return url.toString()
  }

  // 3. Exchange authorization code for tokens
  private async exchangeCodeForTokens(code: string, verifier: string): Promise<Credentials> {
    // Handle both legacy format (code#state) and new format (pure code)
    const authCode = code.includes('#') ? code.split('#')[0] : code
    const state = code.includes('#') ? code.split('#')[1] : verifier

    const response = await fetch('https://console.anthropic.com/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: authCode,
        state: state,
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        redirect_uri: 'https://console.anthropic.com/oauth/code/callback',
        code_verifier: verifier
      })
    })

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.statusText}`)
    }

    const data = await response.json()

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000
    }
  }

  // 4. Refresh access token
  private async refreshAccessToken(refreshToken: string): Promise<Credentials> {
    const response = await fetch('https://console.anthropic.com/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID
      })
    })

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.statusText}`)
    }

    const data = await response.json()

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000
    }
  }

  // 5. Save credentials
  private async saveCredentials(creds: Credentials): Promise<void> {
    await promises.mkdir(dirname(CREDS_PATH), { recursive: true })
    await promises.writeFile(CREDS_PATH, JSON.stringify(creds, null, 2))
    await promises.chmod(CREDS_PATH, 0o600) // Read/write for owner only
  }

  // 6. Load credentials
  private async loadCredentials(): Promise<Credentials | null> {
    try {
      const data = await promises.readFile(CREDS_PATH, 'utf-8')
      return JSON.parse(data)
    } catch {
      return null
    }
  }

  // 7. Get valid access token (refresh if needed)
  public async getValidAccessToken(): Promise<string | null> {
    const creds = await this.loadCredentials()
    if (!creds) return null

    // If token is still valid, return it
    if (creds.expires_at > Date.now() + 60000) {
      // 1 minute buffer
      return creds.access_token
    }

    // Otherwise, refresh it
    try {
      const newCreds = await this.refreshAccessToken(creds.refresh_token)
      await this.saveCredentials(newCreds)
      return newCreds.access_token
    } catch {
      return null
    }
  }

  // 8. Start OAuth flow with external browser
  public async startOAuthFlow(): Promise<string> {
    // Try to get existing valid token
    const existingToken = await this.getValidAccessToken()
    if (existingToken) return existingToken

    // Generate PKCE pair and store it for later use
    this.currentPKCE = this.generatePKCE()

    // Build authorization URL
    const authUrl = this.getAuthorizationURL(this.currentPKCE)
    logger.debug(authUrl)

    // Open URL in external browser
    await shell.openExternal(authUrl)

    // Return the URL for UI to show (optional)
    return authUrl
  }

  // 9. Complete OAuth flow with manual code input
  public async completeOAuthWithCode(code: string): Promise<string> {
    if (!this.currentPKCE) {
      throw new Error('OAuth flow not started. Please call startOAuthFlow first.')
    }

    try {
      // Exchange code for tokens using stored PKCE verifier
      const credentials = await this.exchangeCodeForTokens(code, this.currentPKCE.verifier)
      await this.saveCredentials(credentials)

      // Clear stored PKCE after successful exchange
      this.currentPKCE = null

      return credentials.access_token
    } catch (error) {
      logger.error('OAuth code exchange failed:', error as Error)
      // Clear PKCE on error
      this.currentPKCE = null
      throw error
    }
  }

  // 10. Cancel current OAuth flow
  public cancelOAuthFlow(): void {
    if (this.currentPKCE) {
      logger.info('Cancelling OAuth flow')
      this.currentPKCE = null
    }
  }

  // 11. Clear stored credentials
  public async clearCredentials(): Promise<void> {
    try {
      await promises.unlink(CREDS_PATH)
      logger.info('Credentials cleared')
    } catch (error) {
      // File doesn't exist, which is fine
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }

  // 12. Check if credentials exist
  public async hasCredentials(): Promise<boolean> {
    const creds = await this.loadCredentials()
    return creds !== null
  }
}

export default new AnthropicService()
