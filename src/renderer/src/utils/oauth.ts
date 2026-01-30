import { loggerService } from '@logger'
import { PPIO_APP_SECRET, PPIO_CLIENT_ID, SILICON_CLIENT_ID, TOKENFLUX_HOST } from '@renderer/config/constant'
import i18n, { getLanguageCode } from '@renderer/i18n'

const logger = loggerService.withContext('Utils:oauth')

export const oauthWithSiliconFlow = async (setKey) => {
  const authUrl = `https://account.siliconflow.cn/oauth?client_id=${SILICON_CLIENT_ID}`

  const popup = window.open(
    authUrl,
    'oauth',
    'width=720,height=720,toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,alwaysOnTop=yes,alwaysRaised=yes'
  )

  const messageHandler = (event) => {
    if (event.data.length > 0 && event.data[0]['secretKey'] !== undefined) {
      setKey(event.data[0]['secretKey'])
      popup?.close()
      window.removeEventListener('message', messageHandler)
    }
  }

  window.removeEventListener('message', messageHandler)
  window.addEventListener('message', messageHandler)
}

export const oauthWithAihubmix = async (setKey) => {
  const authUrl = ` https://console.aihubmix.com/token?client_id=cherry_studio_oauth&lang=${getLanguageCode()}&aff=SJyh`

  const popup = window.open(
    authUrl,
    'oauth',
    'width=720,height=720,toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,alwaysOnTop=yes,alwaysRaised=yes'
  )

  const messageHandler = async (event) => {
    const data = event.data

    if (data && data.key === 'cherry_studio_oauth_callback') {
      const { iv, encryptedData } = data.data

      try {
        const secret = import.meta.env.RENDERER_VITE_AIHUBMIX_SECRET || ''
        const decryptedData: any = await window.api.aes.decrypt(encryptedData, iv, secret)
        const { api_keys } = JSON.parse(decryptedData)
        if (api_keys && api_keys.length > 0) {
          setKey(api_keys[0].value)
          popup?.close()
          window.removeEventListener('message', messageHandler)
        }
      } catch (error) {
        logger.error('[oauthWithAihubmix] error', error as Error)
        popup?.close()
        window.toast.error(i18n.t('settings.provider.oauth.error'))
      }
    }
  }

  window.removeEventListener('message', messageHandler)
  window.addEventListener('message', messageHandler)
}

export const oauthWithPPIO = async (setKey) => {
  const redirectUri = 'cherrystudio://'
  const authUrl = `https://ppio.com/oauth/authorize?invited_by=JYT9GD&client_id=${PPIO_CLIENT_ID}&scope=api%20openid&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}`

  window.open(
    authUrl,
    'oauth',
    'width=720,height=720,toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,alwaysOnTop=yes,alwaysRaised=yes'
  )

  if (!setKey) {
    logger.debug('[PPIO OAuth] No setKey callback provided, returning early')
    return
  }

  logger.debug('[PPIO OAuth] Setting up protocol listener')

  return new Promise<string>((resolve, reject) => {
    const removeListener = window.api.protocol.onReceiveData(async (data) => {
      try {
        const url = new URL(data.url)
        const params = new URLSearchParams(url.search)
        const code = params.get('code')

        if (!code) {
          reject(new Error('No authorization code received'))
          return
        }

        if (!PPIO_APP_SECRET) {
          reject(
            new Error('PPIO_APP_SECRET not configured. Please set RENDERER_VITE_PPIO_APP_SECRET environment variable.')
          )
          return
        }
        const formData = new URLSearchParams({
          client_id: PPIO_CLIENT_ID,
          client_secret: PPIO_APP_SECRET,
          code: code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri
        })
        const tokenResponse = await fetch('https://ppio.com/oauth/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: formData.toString()
        })

        if (!tokenResponse.ok) {
          const errorText = await tokenResponse.text()
          logger.error(`[PPIO OAuth] Token exchange failed: ${tokenResponse.status} ${errorText}`)
          throw new Error(`Failed to exchange code for token: ${tokenResponse.status} ${errorText}`)
        }

        const tokenData = await tokenResponse.json()
        const accessToken = tokenData.access_token

        if (accessToken) {
          setKey(accessToken)
          resolve(accessToken)
        } else {
          reject(new Error('No access token received'))
        }
      } catch (error) {
        logger.error('[PPIO OAuth] Error processing callback:', error as Error)
        reject(error)
      } finally {
        removeListener()
      }
    })
  })
}

export const oauthWithTokenFlux = async () => {
  const callbackUrl = `${TOKENFLUX_HOST}/auth/callback?redirect_to=/dashboard/api-keys`
  const resp = await fetch(`${TOKENFLUX_HOST}/api/auth/auth-url?type=login&callback=${callbackUrl}`, {})
  if (!resp.ok) {
    window.toast.error(i18n.t('settings.provider.oauth.error'))
    return
  }
  const data = await resp.json()
  const authUrl = data.data.url
  window.open(
    authUrl,
    'oauth',
    'width=720,height=720,toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,alwaysOnTop=yes,alwaysRaised=yes'
  )
}
export const oauthWith302AI = async (setKey) => {
  const authUrl = 'https://dash.302.ai/sso/login?app=cherry-ai.com&name=Cherry%20Studio'

  const popup = window.open(
    authUrl,
    'oauth',
    'width=720,height=720,toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,alwaysOnTop=yes,alwaysRaised=yes'
  )

  const messageHandler = (event) => {
    if (event.data && event.data.data.apikey !== undefined) {
      setKey(event.data.data.apikey)
      popup?.close()
      window.removeEventListener('message', messageHandler)
    }
  }

  window.removeEventListener('message', messageHandler)
  window.addEventListener('message', messageHandler)
}

export const oauthWithAiOnly = async (setKey) => {
  const authUrl = `https://www.aiionly.com/login?inviteCode=1755481173663DrZBBOC0&cherryCode=01`

  const popup = window.open(
    authUrl,
    'login',
    'width=720,height=720,toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,alwaysOnTop=yes,alwaysRaised=yes'
  )

  const messageHandler = (event) => {
    if (event.data.length > 0 && event.data[0]['secretKey'] !== undefined) {
      setKey(event.data[0]['secretKey'])
      popup?.close()
      window.removeEventListener('message', messageHandler)
    }
  }

  window.removeEventListener('message', messageHandler)
  window.addEventListener('message', messageHandler)
}

export interface NewApiOAuthConfig {
  oauthServer: string
  clientId?: string
  apiHost?: string
  redirectUri?: string
  scopes?: string
}

const DEFAULT_REDIRECT_URI = 'cherrystudio://oauth/callback'
const DEFAULT_CHERRYIN_SCOPES = 'openid profile email offline_access balance:read usage:read tokens:read tokens:write'
const DEFUALT_CHERRYIN_CLIENT_ID = '2a348c87-bae1-4756-a62f-b2e97200fd6d'

/**
 * Generate a cryptographically random string for PKCE code_verifier
 * @param length - Length of the string (43-128 characters per RFC 7636)
 */
function generateRandomString(length: number): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  return Array.from(array, (byte) => charset[byte % charset.length]).join('')
}

/**
 * Base64URL encode an ArrayBuffer (no padding, URL-safe characters)
 */
function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Generate PKCE code_challenge from code_verifier using S256 method
 */
async function generateCodeChallenge(codeVerifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(codeVerifier)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(hash)
}

// Resolved config with all required fields filled in
type ResolvedNewApiOAuthConfig = Required<Omit<NewApiOAuthConfig, 'scopes'>> & Pick<NewApiOAuthConfig, 'scopes'>

// Store pending OAuth flows in memory (keyed by state parameter)
const pendingOAuthFlows = new Map<
  string,
  { codeVerifier: string; config: ResolvedNewApiOAuthConfig; timestamp: number }
>()

// Clean up expired flows (older than 10 minutes)
function cleanupExpiredFlows(): void {
  const now = Date.now()
  for (const [state, flow] of pendingOAuthFlows.entries()) {
    if (now - flow.timestamp > 10 * 60 * 1000) {
      pendingOAuthFlows.delete(state)
    }
  }
}

/**
 * Uses Authorization Code flow with S256 code challenge method
 * @param setKey - Callback to set the API key
 * @param config - OAuth configuration (oauthServer, clientId, redirectUri, scopes)
 */
export const oauthWithCherryIn = async (setKey: (key: string) => void, config: NewApiOAuthConfig): Promise<string> => {
  cleanupExpiredFlows()

  const oauthServer = config.oauthServer
  const clientId = config.clientId ?? DEFUALT_CHERRYIN_CLIENT_ID
  const apiHost = config.apiHost ?? oauthServer
  const scopes = config.scopes ?? DEFAULT_CHERRYIN_SCOPES
  const redirectUri = config.redirectUri ?? DEFAULT_REDIRECT_URI

  // Create resolved config with all defaults applied
  const resolvedConfig: ResolvedNewApiOAuthConfig = {
    oauthServer,
    clientId,
    apiHost,
    redirectUri,
    scopes
  }

  // Generate PKCE parameters
  const codeVerifier = generateRandomString(64) // 43-128 chars per RFC 7636
  const codeChallenge = await generateCodeChallenge(codeVerifier)
  const state = generateRandomString(32)

  // Store verifier and config for later use (keyed by state for CSRF protection)
  pendingOAuthFlows.set(state, { codeVerifier, config: resolvedConfig, timestamp: Date.now() })

  // Build authorization URL
  const authUrl = new URL(`${oauthServer}/oauth2/auth`)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', scopes)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')

  logger.debug('Opening authorization URL')

  // Open in popup window
  window.open(
    authUrl.toString(),
    'oauth',
    'width=720,height=720,toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,alwaysOnTop=yes,alwaysRaised=yes'
  )

  return new Promise<string>((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const removeListener = window.api.protocol.onReceiveData(async (data) => {
      try {
        const url = new URL(data.url)

        // Only handle our OAuth callback
        if (url.hostname !== 'oauth' || url.pathname !== '/callback') {
          return
        }

        const params = new URLSearchParams(url.search)
        const code = params.get('code')
        const returnedState = params.get('state')
        const error = params.get('error')

        // Handle OAuth errors
        if (error) {
          const errorDesc = params.get('error_description') || error
          logger.error(`Error: ${errorDesc}`)
          reject(new Error(`OAuth error: ${errorDesc}`))
          cleanup()
          return
        }

        if (!code) {
          reject(new Error('No authorization code received'))
          cleanup()
          return
        }

        // Verify state exists in our pending flows (instead of comparing with closure variable)
        // This handles the case where multiple login attempts create multiple listeners
        if (!returnedState || !pendingOAuthFlows.has(returnedState)) {
          // This callback might be for a different OAuth flow, ignore it
          logger.debug('State not found in pending flows, ignoring callback')
          return
        }

        // Only process if this is OUR state (the one we registered)
        if (returnedState !== state) {
          // This callback is for a different OAuth flow started by another click
          logger.debug('State belongs to different flow, ignoring')
          return
        }

        // Retrieve stored code_verifier and config
        const flowData = pendingOAuthFlows.get(returnedState)
        if (!flowData) {
          reject(new Error('OAuth flow expired or not found'))
          cleanup()
          return
        }
        pendingOAuthFlows.delete(returnedState)

        const { codeVerifier: storedVerifier, config: storedConfig } = flowData

        logger.debug('Exchanging code for token')

        // Exchange authorization code for access token
        const tokenUrl = `${storedConfig.oauthServer}/oauth2/token`
        const tokenResponse = await fetch(tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: storedConfig.clientId,
            code,
            redirect_uri: storedConfig.redirectUri || DEFAULT_REDIRECT_URI,
            code_verifier: storedVerifier
          }).toString()
        })

        if (!tokenResponse.ok) {
          const errorText = await tokenResponse.text()
          logger.error(`Token exchange failed: ${tokenResponse.status} ${errorText}`)
          throw new Error(`Failed to exchange code for token: ${tokenResponse.status}`)
        }

        const tokenData = await tokenResponse.json()
        const accessToken = tokenData.access_token
        const refreshToken = tokenData.refresh_token

        if (!accessToken) {
          reject(new Error('No access token received'))
          cleanup()
          return
        }

        // Save tokens for later use (balance, logout, refresh, etc.)
        try {
          await window.api.cherryin.saveToken(accessToken, refreshToken)
          logger.debug('[CherryIN OAuth] Tokens saved successfully')
        } catch (saveError) {
          logger.warn('[CherryIN OAuth] Failed to save tokens:', saveError as Error)
          // Continue anyway - the API key will still work
        }

        logger.debug('[CherryIN OAuth] Successfully obtained access token, fetching API keys')

        // Fetch API keys using the access token
        const apiKeysUrl = `${storedConfig.apiHost}/api/v1/oauth/tokens`
        const apiKeysResponse = await fetch(apiKeysUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        })

        if (!apiKeysResponse.ok) {
          const errorText = await apiKeysResponse.text()
          logger.error(`Failed to fetch API keys: ${apiKeysResponse.status} ${errorText}`)
          throw new Error(`Failed to fetch API keys: ${apiKeysResponse.status}`)
        }

        const apiKeysData = await apiKeysResponse.json()
        const extractKey = (item: any): string | null => {
          if (typeof item === 'string') return item
          if (item && typeof item.key === 'string') return item.key
          if (item && typeof item.token === 'string') return item.token
          return null
        }

        let apiKeys: string
        if (Array.isArray(apiKeysData)) {
          apiKeys = apiKeysData.map(extractKey).filter(Boolean).join(',')
        } else if (apiKeysData.data && Array.isArray(apiKeysData.data)) {
          apiKeys = apiKeysData.data.map(extractKey).filter(Boolean).join(',')
        } else {
          logger.error('Unexpected API keys response format:', apiKeysData)
          throw new Error('Unexpected API keys response format')
        }

        if (apiKeys) {
          logger.debug('Successfully obtained API keys')
          setKey(apiKeys)
          resolve(apiKeys)
        } else {
          reject(new Error('No API keys received'))
        }

        cleanup()
      } catch (error) {
        logger.error('Error processing callback:', error as Error)
        reject(error)
        cleanup()
      }
    })

    function cleanup(): void {
      removeListener()
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      pendingOAuthFlows.delete(state)
    }

    // Timeout after 10 minutes
    timeoutId = setTimeout(
      () => {
        logger.warn('Flow timed out')
        cleanup()
        reject(new Error('OAuth flow timed out'))
      },
      10 * 60 * 1000
    )
  })
}

export const providerCharge = async (provider: string) => {
  const chargeUrlMap = {
    silicon: {
      url: 'https://cloud.siliconflow.cn/expensebill',
      width: 900,
      height: 700
    },
    aihubmix: {
      url: `https://console.aihubmix.com/topup?client_id=cherry_studio_oauth&lang=${getLanguageCode()}&aff=SJyh`,
      width: 720,
      height: 900
    },
    tokenflux: {
      url: `https://tokenflux.ai/dashboard/billing`,
      width: 900,
      height: 700
    },
    ppio: {
      url: 'https://ppio.com/user/register?invited_by=JYT9GD&utm_source=github_cherry-studio&redirect=/billing',
      width: 900,
      height: 700
    },
    '302ai': {
      url: 'https://dash.302.ai/charge',
      width: 900,
      height: 700
    },
    aionly: {
      url: `https://www.aiionly.com/recharge`,
      width: 900,
      height: 700
    }
  }

  const { url, width, height } = chargeUrlMap[provider]

  window.open(
    url,
    'oauth',
    `width=${width},height=${height},toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,alwaysOnTop=yes,alwaysRaised=yes`
  )
}

export const providerBills = async (provider: string) => {
  const billsUrlMap = {
    silicon: {
      url: 'https://cloud.siliconflow.cn/bills',
      width: 900,
      height: 700
    },
    aihubmix: {
      url: `https://console.aihubmix.com/statistics?client_id=cherry_studio_oauth&lang=${getLanguageCode()}&aff=SJyh`,
      width: 900,
      height: 700
    },
    tokenflux: {
      url: `https://tokenflux.ai/dashboard/billing`,
      width: 900,
      height: 700
    },
    ppio: {
      url: 'https://ppio.com/user/register?invited_by=JYT9GD&utm_source=github_cherry-studio&redirect=/billing/billing-details',
      width: 900,
      height: 700
    },
    '302ai': {
      url: 'https://dash.302.ai/charge',
      width: 900,
      height: 700
    },
    aionly: {
      url: `https://www.aiionly.com/billManagement`,
      width: 900,
      height: 700
    }
  }

  const { url, width, height } = billsUrlMap[provider]

  window.open(
    url,
    'oauth',
    `width=${width},height=${height},toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,alwaysOnTop=yes,alwaysRaised=yes`
  )
}
