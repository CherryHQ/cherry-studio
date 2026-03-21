import { createHash, randomBytes } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

import { loggerService } from '@logger'
import {
  POE_CLIENT_ID,
  POE_OAUTH_AUTHORIZE_URL,
  POE_OAUTH_CALLBACK_HOST,
  POE_OAUTH_CALLBACK_PATH,
  POE_OAUTH_SCOPE,
  POE_OAUTH_TIMEOUT_MS,
  POE_OAUTH_TOKEN_RETRY_COUNT,
  POE_OAUTH_TOKEN_URL
} from '@main/constant'
import { locales } from '@main/utils/locales'

import { configManager } from './ConfigManager'

const logger = loggerService.withContext('PoeOAuthService')

const CALLBACK_ERROR_KEYS: Record<string, string> = {
  access_denied: 'settings.provider.oauth.poe.error.access_denied',
  invalid_request: 'settings.provider.oauth.poe.error.invalid_request',
  unsupported_response_type: 'settings.provider.oauth.poe.error.unsupported_response_type',
  invalid_scope: 'settings.provider.oauth.poe.error.invalid_scope'
}

const TOKEN_ERROR_KEYS: Record<string, string> = {
  invalid_request: 'settings.provider.oauth.poe.error.token_invalid_request',
  invalid_grant: 'settings.provider.oauth.poe.error.invalid_grant',
  unsupported_grant_type: 'settings.provider.oauth.poe.error.unsupported_grant_type',
  server_error: 'settings.provider.oauth.poe.error.server_error'
}

interface PoeOAuthCallbackPayload {
  code: string | null
  error: string | null
  errorDescription: string | null
  state: string | null
}

interface PoeTokenResponse {
  api_key?: string
  api_key_expires_in?: number | null
  error?: string
  error_description?: string
}

interface PoeCallbackServer {
  server: http.Server
  redirectUri: string
  callbackPromise: Promise<PoeOAuthCallbackPayload>
}

export interface PoeOAuthResult {
  apiKey: string
  expiresIn: number | null
}

export interface PoeAuthorizationUrlOptions {
  clientId: string
  redirectUri: string
  codeChallenge: string
  state: string
}

export class PoeOAuthServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'PoeOAuthServiceError'
  }
}

export const generatePoeCodeVerifier = (): string => randomBytes(32).toString('base64url')

export const generatePoeCodeChallenge = (verifier: string): string => {
  return createHash('sha256').update(verifier).digest('base64url')
}

export const generatePoeOAuthState = (): string => randomBytes(16).toString('base64url')

export const buildPoeAuthorizationUrl = ({
  clientId,
  redirectUri,
  codeChallenge,
  state
}: PoeAuthorizationUrlOptions): string => {
  const url = new URL(POE_OAUTH_AUTHORIZE_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', POE_OAUTH_SCOPE)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  return url.toString()
}

export const mapPoeCallbackError = (code: string, description?: string | null): string => {
  return appendErrorDescription(
    getPoeOAuthText(CALLBACK_ERROR_KEYS[code] || 'settings.provider.oauth.poe.error.authorization_failed'),
    description
  )
}

export const mapPoeTokenError = (code: string, description?: string | null): string => {
  return appendErrorDescription(
    getPoeOAuthText(TOKEN_ERROR_KEYS[code] || 'settings.provider.oauth.poe.error.token_exchange_failed'),
    description
  )
}

class PoeOAuthService {
  public async login(): Promise<PoeOAuthResult> {
    const callbackServer = await this.startCallbackServer()
    const codeVerifier = generatePoeCodeVerifier()
    const codeChallenge = generatePoeCodeChallenge(codeVerifier)
    const expectedState = generatePoeOAuthState()

    try {
      const authorizationUrl = buildPoeAuthorizationUrl({
        clientId: POE_CLIENT_ID,
        redirectUri: callbackServer.redirectUri,
        codeChallenge,
        state: expectedState
      })

      await this.openSystemBrowser(authorizationUrl)

      const callbackPayload = await this.waitForCallback(callbackServer.callbackPromise)
      this.validateState(expectedState, callbackPayload.state)

      if (callbackPayload.error) {
        throw new PoeOAuthServiceError(
          mapPoeCallbackError(callbackPayload.error, callbackPayload.errorDescription),
          callbackPayload.error
        )
      }

      if (!callbackPayload.code) {
        throw new PoeOAuthServiceError(
          getPoeOAuthText('settings.provider.oauth.poe.error.missing_code'),
          'missing_code'
        )
      }

      return await this.exchangeAuthorizationCode({
        code: callbackPayload.code,
        redirectUri: callbackServer.redirectUri,
        codeVerifier
      })
    } finally {
      await this.closeServer(callbackServer.server)
    }
  }

  private async startCallbackServer(): Promise<PoeCallbackServer> {
    let settleSuccess: ((value: PoeOAuthCallbackPayload) => void) | null = null
    let settleFailure: ((reason: unknown) => void) | null = null
    let settled = false

    const callbackPromise = new Promise<PoeOAuthCallbackPayload>((resolve, reject) => {
      settleSuccess = (payload) => {
        if (settled) {
          return
        }

        settled = true
        resolve(payload)
      }

      settleFailure = (reason) => {
        if (settled) {
          return
        }

        settled = true
        reject(reason)
      }
    })

    const server = http.createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url || '/', `http://${POE_OAUTH_CALLBACK_HOST}`)

        if (requestUrl.pathname !== POE_OAUTH_CALLBACK_PATH) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('Not Found')
          return
        }

        const payload: PoeOAuthCallbackPayload = {
          code: requestUrl.searchParams.get('code'),
          error: requestUrl.searchParams.get('error'),
          errorDescription: requestUrl.searchParams.get('error_description'),
          state: requestUrl.searchParams.get('state')
        }

        const isSuccess = Boolean(payload.code) && !payload.error
        res.writeHead(isSuccess ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(isSuccess ? renderSuccessHtml() : this.renderFailureHtml(payload))

        settleSuccess?.(payload)
      } catch (error) {
        logger.error('Failed to process Poe OAuth callback.', error as Error)
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Internal Server Error')
        settleFailure?.(
          new PoeOAuthServiceError(
            getPoeOAuthText('settings.provider.oauth.poe.error.callback_processing_failed'),
            'callback_processing_failed',
            error
          )
        )
      }
    })

    server.on('error', (error) => {
      logger.error('Poe OAuth callback server error.', error as Error)
      settleFailure?.(
        new PoeOAuthServiceError(
          getPoeOAuthText('settings.provider.oauth.poe.error.callback_server_error'),
          'callback_server_error',
          error
        )
      )
    })

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening)
        reject(
          new PoeOAuthServiceError(
            getPoeOAuthText('settings.provider.oauth.poe.error.callback_server_error'),
            'callback_server_error',
            error
          )
        )
      }

      const onListening = () => {
        server.off('error', onError)
        resolve()
      }

      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(0, POE_OAUTH_CALLBACK_HOST)
    })

    const address = server.address() as AddressInfo | null

    if (!address || typeof address.port !== 'number') {
      throw new PoeOAuthServiceError(
        getPoeOAuthText('settings.provider.oauth.poe.error.callback_port_unavailable'),
        'callback_port_unavailable'
      )
    }

    logger.info(`Poe OAuth callback server listening on ${POE_OAUTH_CALLBACK_HOST}:${address.port}`)

    return {
      server,
      redirectUri: `http://${POE_OAUTH_CALLBACK_HOST}:${address.port}${POE_OAUTH_CALLBACK_PATH}`,
      callbackPromise
    }
  }

  private async openSystemBrowser(url: string): Promise<void> {
    try {
      const { shell } = await import('electron')
      await shell.openExternal(url)
    } catch (error) {
      logger.error('Failed to open the Poe authorization page in the browser.', error as Error)
      throw new PoeOAuthServiceError(
        getPoeOAuthText('settings.provider.oauth.poe.error.browser_open_failed'),
        'browser_open_failed',
        error
      )
    }
  }

  private async waitForCallback(callbackPromise: Promise<PoeOAuthCallbackPayload>): Promise<PoeOAuthCallbackPayload> {
    let timeoutId: NodeJS.Timeout | undefined

    try {
      return await Promise.race([
        callbackPromise,
        new Promise<PoeOAuthCallbackPayload>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(
              new PoeOAuthServiceError(
                getPoeOAuthText('settings.provider.oauth.poe.error.callback_timeout'),
                'callback_timeout'
              )
            )
          }, POE_OAUTH_TIMEOUT_MS)
        })
      ])
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }

  private validateState(expectedState: string, receivedState: string | null): void {
    if (!receivedState) {
      throw new PoeOAuthServiceError(
        getPoeOAuthText('settings.provider.oauth.poe.error.missing_state'),
        'missing_state'
      )
    }

    if (receivedState !== expectedState) {
      throw new PoeOAuthServiceError(
        getPoeOAuthText('settings.provider.oauth.poe.error.state_mismatch'),
        'state_mismatch'
      )
    }
  }

  private async exchangeAuthorizationCode({
    code,
    redirectUri,
    codeVerifier
  }: {
    code: string
    redirectUri: string
    codeVerifier: string
  }): Promise<PoeOAuthResult> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: POE_CLIENT_ID,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    })

    for (let attempt = 0; attempt <= POE_OAUTH_TOKEN_RETRY_COUNT; attempt++) {
      let response: Response

      try {
        response = await fetch(POE_OAUTH_TOKEN_URL, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: body.toString()
        })
      } catch (error) {
        logger.error('Failed to reach the Poe token endpoint.', error as Error)
        throw new PoeOAuthServiceError(
          getPoeOAuthText('settings.provider.oauth.poe.error.token_request_failed'),
          'token_request_failed',
          error
        )
      }

      const payload = await this.readTokenResponse(response)

      if (!response.ok) {
        const tokenError = payload?.error || `http_${response.status}`

        if (tokenError === 'server_error' && attempt < POE_OAUTH_TOKEN_RETRY_COUNT) {
          logger.warn('Retrying Poe token exchange after server_error response.')
          continue
        }

        throw new PoeOAuthServiceError(mapPoeTokenError(tokenError, payload?.error_description), tokenError)
      }

      const apiKey = typeof payload?.api_key === 'string' ? payload.api_key.trim() : ''
      if (!apiKey) {
        throw new PoeOAuthServiceError(
          getPoeOAuthText('settings.provider.oauth.poe.error.missing_api_key'),
          'missing_api_key'
        )
      }

      return {
        apiKey,
        expiresIn: typeof payload?.api_key_expires_in === 'number' ? payload.api_key_expires_in : null
      }
    }

    throw new PoeOAuthServiceError(
      getPoeOAuthText('settings.provider.oauth.poe.error.token_exchange_failed'),
      'token_exchange_failed'
    )
  }

  private async readTokenResponse(response: Response): Promise<PoeTokenResponse | null> {
    const contentType = response.headers.get('content-type') || ''

    if (!contentType.toLowerCase().includes('application/json')) {
      return null
    }

    try {
      return (await response.json()) as PoeTokenResponse
    } catch (error) {
      logger.warn('Failed to parse Poe token response as JSON.', error as Error)
      return null
    }
  }

  private renderFailureHtml(payload: PoeOAuthCallbackPayload): string {
    const message = payload.error
      ? mapPoeCallbackError(payload.error, payload.errorDescription)
      : getPoeOAuthText('settings.provider.oauth.poe.error.missing_code')

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(getPoeOAuthText('settings.provider.oauth.poe.failure.title'))}</title>
  </head>
  <body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff7f5;color:#7f1d1d;display:grid;place-items:center;min-height:100vh;">
    <main style="max-width:520px;padding:32px;border-radius:16px;background:#ffffff;box-shadow:0 12px 40px rgba(127,29,29,0.08);text-align:center;">
      <h1 style="margin:0 0 8px;font-size:28px;">${escapeHtml(getPoeOAuthText('settings.provider.oauth.poe.failure.title'))}</h1>
      <p style="margin:0;line-height:1.5;">${escapeHtml(message)}</p>
    </main>
  </body>
</html>`
  }

  private async closeServer(server: http.Server): Promise<void> {
    if (!server.listening) {
      return
    }

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    }).catch((error) => {
      logger.warn('Failed to close the Poe OAuth callback server cleanly.', error as Error)
    })
  }
}

function getPoeOAuthText(key: string): string {
  return getLocaleText(configManager.getLanguage(), key) || getLocaleText('en-US', key) || key
}

function getLocaleText(locale: string, key: string): string | null {
  const translation = locales[locale]?.translation
  if (!translation) {
    return null
  }

  const value = key.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      return null
    }

    return (current as Record<string, unknown>)[segment]
  }, translation)

  return typeof value === 'string' ? value : null
}

function renderSuccessHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(getPoeOAuthText('settings.provider.oauth.poe.success.title'))}</title>
    <style>
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f7f9fc;
        color: #14213d;
        display: grid;
        place-items: center;
        min-height: 100vh;
      }

      main {
        padding: 32px;
        border-radius: 16px;
        background: #ffffff;
        box-shadow: 0 12px 40px rgba(20, 33, 61, 0.12);
        text-align: center;
      }

      h1 {
        margin: 0 0 8px;
        font-size: 28px;
      }

      p {
        margin: 0;
        color: #4f5d75;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(getPoeOAuthText('settings.provider.oauth.poe.success.title'))}</h1>
      <p>${escapeHtml(getPoeOAuthText('settings.provider.oauth.poe.success.description'))}</p>
    </main>
  </body>
</html>`
}

function appendErrorDescription(message: string, description?: string | null): string {
  if (!description) {
    return message
  }

  const normalizedDescription = description.trim()
  if (!normalizedDescription) {
    return message
  }

  return `${message} ${normalizedDescription}`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export default new PoeOAuthService()
