import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server, type ServerResponse } from 'node:http'

import { loggerService } from '@logger'
import { TOKEN_DANCE_APP_URL } from '@main/ai/provider/constants'
import { t } from '@main/i18n'
import { net, shell } from 'electron'
import * as z from 'zod'

const logger = loggerService.withContext('TokenDanceOAuth')

const TOKEN_DANCE_CONFIG = {
  authorizeUrl: 'https://tokendance.space/auth',
  exchangeUrl: 'https://tokendance.space/portal/api/v1/auth/keys',
  appUrl: TOKEN_DANCE_APP_URL,
  keyName: 'Cherry Studio',
  callbackPath: '/oauth/tokendance/callback',
  authorizationTimeoutMs: 10 * 60 * 1000,
  exchangeTimeoutMs: 30 * 1000
} as const

const TokenDanceKeyResponseSchema = z.object({ key: z.string().trim().min(1) })

type TokenDanceCallback = {
  code: string
  response: ServerResponse
}

type TokenDanceCallbackServer = {
  callbackUrl: string
  waitForCode: Promise<TokenDanceCallback>
  fail: (error: unknown) => void
  close: () => Promise<void>
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function createAuthorizationParameters(): { state: string; codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64UrlEncode(randomBytes(32))
  return {
    state: randomBytes(16).toString('hex'),
    codeVerifier,
    codeChallenge: base64UrlEncode(createHash('sha256').update(codeVerifier).digest())
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
    return entities[character] ?? character
  })
}

function completeCallback(response: ServerResponse): void {
  const title = escapeHtml(t('settings.mcp.oauth.callback.title'))
  const message = escapeHtml(t('settings.mcp.oauth.callback.message'))
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    Connection: 'close',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  })
  response.end(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
      `<body style="font-family:system-ui;text-align:center;padding-top:64px"><h2>${title}</h2><p>${message}</p></body></html>`
  )
}

function failCallback(response: ServerResponse): void {
  if (!response.writableEnded) {
    response.writeHead(500, { 'Cache-Control': 'no-store' }).end()
  }
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError)
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('TokenDance callback server did not bind a TCP port'))
        return
      }
      resolve(address.port)
    })
  })
}

async function startCallbackServer(state: string): Promise<TokenDanceCallbackServer> {
  let settled = false
  let resolveCode!: (callback: TokenDanceCallback) => void
  let rejectCode!: (error: unknown) => void

  const waitForCode = new Promise<TokenDanceCallback>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })
  const settleReject = (error: unknown) => {
    if (settled) return
    settled = true
    rejectCode(error)
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method !== 'GET' || url.pathname !== TOKEN_DANCE_CONFIG.callbackPath) {
      response.writeHead(404).end()
      return
    }
    if (url.searchParams.get('state') !== state) {
      response.writeHead(400).end()
      return
    }
    if (url.searchParams.has('error')) {
      response.writeHead(400).end()
      settleReject(new Error('TokenDance authorization was not completed'))
      return
    }

    const code = url.searchParams.get('code')
    if (!code) {
      response.writeHead(400).end()
      return
    }
    if (settled) {
      response.writeHead(409).end()
      return
    }

    settled = true
    resolveCode({ code, response })
  })

  const port = await listen(server)
  const callbackUrl = new URL(`http://127.0.0.1:${port}${TOKEN_DANCE_CONFIG.callbackPath}`)
  callbackUrl.searchParams.set('state', state)
  const timeoutId = setTimeout(
    () => settleReject(new Error('TokenDance authorization timed out')),
    TOKEN_DANCE_CONFIG.authorizationTimeoutMs
  )

  return {
    callbackUrl: callbackUrl.toString(),
    waitForCode,
    fail: settleReject,
    close: () => {
      clearTimeout(timeoutId)
      if (!server.listening) return Promise.resolve()
      return new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
    }
  }
}

function buildAuthorizationUrl(callbackUrl: string, codeChallenge: string): string {
  const url = new URL(TOKEN_DANCE_CONFIG.authorizeUrl)
  url.searchParams.set('callback_url', callbackUrl)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('app_url', TOKEN_DANCE_CONFIG.appUrl)
  url.searchParams.set('key_name', TOKEN_DANCE_CONFIG.keyName)
  return url.toString()
}

async function exchangeCode(code: string, codeVerifier: string): Promise<string> {
  const response = await net.fetch(TOKEN_DANCE_CONFIG.exchangeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: codeVerifier, code_challenge_method: 'S256' }),
    signal: AbortSignal.timeout(TOKEN_DANCE_CONFIG.exchangeTimeoutMs)
  })

  if (!response.ok) {
    throw new Error(`TokenDance API key exchange failed with status ${response.status}`)
  }

  const parsed = TokenDanceKeyResponseSchema.safeParse(await response.json())
  if (!parsed.success) {
    throw new Error('TokenDance API key exchange returned an invalid response')
  }
  return parsed.data.key
}

export async function authorizeTokenDanceApiKey(): Promise<string> {
  const { state, codeVerifier, codeChallenge } = createAuthorizationParameters()
  const callbackServer = await startCallbackServer(state)
  let callbackResponse: ServerResponse | undefined

  try {
    const authorizationUrl = buildAuthorizationUrl(callbackServer.callbackUrl, codeChallenge)
    logger.info('Opening TokenDance API key authorization')
    try {
      await shell.openExternal(authorizationUrl)
    } catch (error) {
      callbackServer.fail(error)
    }

    const callback = await callbackServer.waitForCode
    callbackResponse = callback.response
    const apiKey = await exchangeCode(callback.code, codeVerifier)
    completeCallback(callback.response)
    callbackResponse = undefined
    logger.info('TokenDance API key authorization succeeded')
    return apiKey
  } catch (error) {
    if (callbackResponse) failCallback(callbackResponse)
    logger.error('TokenDance API key authorization failed', error as Error)
    throw error
  } finally {
    await callbackServer.close()
  }
}
