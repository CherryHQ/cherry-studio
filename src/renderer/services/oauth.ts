import { loggerService } from '@logger'
import i18n, { getLanguageCode } from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { SystemProviderIds } from '@shared/utils/systemProviderId'

const logger = loggerService.withContext('oauth')

const SILICON_CLIENT_ID = 'SFaJLLq0y6CAMoyDm81aMu'
const PPIO_CLIENT_ID = '37d0828c96b34936a600b62c'
const PPIO_APP_SECRET = import.meta.env.RENDERER_VITE_PPIO_APP_SECRET || ''

const OAUTH_POPUP_TIMEOUT_MS = 10 * 60 * 1000
const OAUTH_POPUP_CLOSE_POLL_MS = 500
const OAUTH_POPUP_FEATURES =
  'width=720,height=720,toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,alwaysOnTop=yes,alwaysRaised=yes'

type SecretKeyOAuthPayload = [{ secretKey: string }, ...unknown[]]

interface AihubmixOAuthPayload {
  key: 'cherry_studio_oauth_callback'
  data?: unknown
}

interface NestedApiKeyOAuthPayload {
  data: { apikey: string }
}

interface PopupMessageOAuthOptions<T> {
  authUrl: string
  popupName: string
  matches: (data: unknown) => data is T
  getKey: (data: T) => string | Promise<string>
  setKey: (key: string) => void | Promise<void>
  onError?: (error: unknown) => void
}

class PopupFlowRegistry {
  readonly #cleanups = new Map<string, () => void>()

  retire(popupName: string): void {
    this.#cleanups.get(popupName)?.()
  }

  register(popupName: string, cleanup: () => void): void {
    this.retire(popupName)
    this.#cleanups.set(popupName, cleanup)
  }

  release(popupName: string, cleanup: () => void): void {
    if (this.#cleanups.get(popupName) === cleanup) this.#cleanups.delete(popupName)
  }
}

const popupFlowRegistry = new PopupFlowRegistry()

function openNamedPopup(authUrl: string, popupName: string, features: string): Window | null {
  const popup = window.open(authUrl, popupName, features)
  // Only retire the current flow once its replacement actually opens.
  if (popup) popupFlowRegistry.retire(popupName)
  return popup
}

function isSecretKeyOAuthPayload(data: unknown): data is SecretKeyOAuthPayload {
  return (
    Array.isArray(data) &&
    data.length > 0 &&
    typeof data[0] === 'object' &&
    data[0] !== null &&
    typeof (data[0] as { secretKey?: unknown }).secretKey === 'string'
  )
}

function isAihubmixOAuthPayload(data: unknown): data is AihubmixOAuthPayload {
  return typeof data === 'object' && data !== null && (data as { key?: unknown }).key === 'cherry_studio_oauth_callback'
}

function isNestedApiKeyOAuthPayload(data: unknown): data is NestedApiKeyOAuthPayload {
  if (typeof data !== 'object' || data === null) return false
  const nestedData = (data as { data?: unknown }).data
  return (
    typeof nestedData === 'object' &&
    nestedData !== null &&
    typeof (nestedData as { apikey?: unknown }).apikey === 'string'
  )
}

function startPopupMessageOAuth<T>({
  authUrl,
  popupName,
  matches,
  getKey,
  setKey,
  onError
}: PopupMessageOAuthOptions<T>): void {
  const popup = openNamedPopup(authUrl, popupName, OAUTH_POPUP_FEATURES)
  if (!popup) return
  const openedPopup = popup

  const expectedOrigin = new URL(authUrl.trim()).origin
  let active = true
  let listening = true
  let processingCallback = false

  const stopListening = () => {
    if (!listening) return
    listening = false
    window.removeEventListener('message', messageHandler)
  }

  const finish = () => {
    if (!active) return
    active = false
    stopListening()
    window.clearInterval(closePollId)
    window.clearTimeout(timeoutId)
    popupFlowRegistry.release(popupName, finish)
  }

  function messageHandler(event: MessageEvent): void {
    const data: unknown = event.data
    if (!active || event.source !== openedPopup || event.origin !== expectedOrigin || !matches(data)) return

    // A recognized callback is terminal. Stop accepting duplicate messages,
    // but let its async payload work finish even when the callback page closes.
    processingCallback = true
    stopListening()

    void Promise.resolve()
      .then(() => getKey(data))
      .then(async (key) => {
        if (!active) return
        await setKey(key)
        if (!active) return
        openedPopup.close()
        finish()
      })
      .catch((error) => {
        if (!active) return
        openedPopup.close()
        onError?.(error)
        finish()
      })
  }

  const closePollId = window.setInterval(() => {
    if (openedPopup.closed && !processingCallback) finish()
  }, OAUTH_POPUP_CLOSE_POLL_MS)
  const timeoutId = window.setTimeout(finish, OAUTH_POPUP_TIMEOUT_MS)

  popupFlowRegistry.register(popupName, finish)
  window.addEventListener('message', messageHandler)
}

export const oauthWithSiliconFlow = async (setKey) => {
  const authUrl = `https://account.siliconflow.cn/oauth?client_id=${SILICON_CLIENT_ID}`

  startPopupMessageOAuth({
    authUrl,
    popupName: 'oauth',
    matches: isSecretKeyOAuthPayload,
    getKey: (data) => data[0].secretKey,
    setKey,
    onError: (error) => logger.error('[oauthWithSiliconFlow] error', error as Error)
  })
}

export const oauthWithAihubmix = async (setKey) => {
  const authUrl = `https://console.inferera.com/token?client_id=cherry_studio_oauth&lang=${await getLanguageCode()}&aff=SJyh`

  startPopupMessageOAuth({
    authUrl,
    popupName: 'oauth',
    matches: isAihubmixOAuthPayload,
    getKey: async (data) => {
      const callbackData = typeof data.data === 'object' && data.data !== null ? data.data : {}
      const { iv, encryptedData } = callbackData as { iv?: unknown; encryptedData?: unknown }
      if (typeof iv !== 'string' || typeof encryptedData !== 'string') {
        throw new Error('Invalid OAuth callback payload')
      }

      const secret = import.meta.env.RENDERER_VITE_AIHUBMIX_SECRET || ''
      const decryptedData: any = await window.api.aes.decrypt(encryptedData, iv, secret)
      const { api_keys } = JSON.parse(decryptedData)
      const key = api_keys?.[0]?.value
      if (typeof key !== 'string' || key.length === 0) {
        throw new Error('No API key received')
      }
      return key
    },
    setKey,
    onError: (error) => {
      logger.error('[oauthWithAihubmix] error', error as Error)
      toast.error(i18n.t('settings.provider.oauth.error'))
    }
  })
}

export const oauthWithPPIO = async (setKey) => {
  const redirectUri = 'cherrystudio://'
  const authUrl = `https://ppio.com/oauth/authorize?invited_by=JYT9GD&client_id=${PPIO_CLIENT_ID}&scope=api%20openid&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}`

  openNamedPopup(
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
    const removeListener = ipcApi.on('navigation.protocol_data', async (data) => {
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

export const oauthWith302AI = async (setKey) => {
  const authUrl = 'https://dash.302.ai/sso/login?app=cherry-ai.com&name=Cherry%20Studio'

  startPopupMessageOAuth({
    authUrl,
    popupName: 'oauth',
    matches: isNestedApiKeyOAuthPayload,
    getKey: (data) => data.data.apikey,
    setKey,
    onError: (error) => logger.error('[oauthWith302AI] error', error as Error)
  })
}

export const oauthWithAiOnly = async (setKey) => {
  const authUrl = `https://maas.aiionly.com/login?inviteCode=1755481173663DrZBBOC0&cherryCode=01`

  startPopupMessageOAuth({
    authUrl,
    popupName: 'login',
    matches: isSecretKeyOAuthPayload,
    getKey: (data) => data[0].secretKey,
    setKey,
    onError: (error) => logger.error('[oauthWithAiOnly] error', error as Error)
  })
}

export interface NewApiOAuthConfig {
  oauthServer: string
  apiHost?: string
}

/**
 * CherryIN OAuth flow using Authorization Code with PKCE.
 *
 * PKCE, token exchange and API-key fetch all happen in the main process
 * (`OAuthRuntimeService`); the deep-link callback is routed by `ProtocolService`
 * directly to this renderer's webContents (captured at flow-start time), so we
 * just await a single point-to-point IPC event keyed by `state`.
 */
export const oauthWithCherryIn = async (
  setKey: (key: string) => void | Promise<void>,
  config: NewApiOAuthConfig
): Promise<string> => {
  const { oauthServer, apiHost } = config

  const { authUrl, state } = await ipcApi.request('oauth.start_deep_link_flow', {
    providerId: SystemProviderIds.cherryin,
    oauthServer,
    apiHost
  })

  logger.debug('Opening authorization URL')

  openNamedPopup(
    authUrl,
    'oauth',
    'width=720,height=720,toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,alwaysOnTop=yes,alwaysRaised=yes'
  )

  return new Promise<string>((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const removeListener = ipcApi.on('oauth.deep_link_result', async (result) => {
      // Defensive: another concurrent CherryIN flow on the same window would
      // hit the same listener; main only ever pushes for our state, but filter
      // anyway to keep the contract explicit.
      if (result.state !== state) return

      cleanup()

      if ('error' in result) {
        logger.error(`OAuth error: ${result.error}`)
        reject(new Error(result.error))
        return
      }

      if (!result.apiKeys) {
        reject(new Error('No API keys received'))
        return
      }

      logger.debug('Successfully obtained API keys')
      try {
        await setKey(result.apiKeys)
      } catch (err) {
        reject(err)
        return
      }
      resolve(result.apiKeys)
    })

    function cleanup(): void {
      removeListener()
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    }

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
  const lang = await getLanguageCode()
  const chargeUrlMap = {
    silicon: {
      url: 'https://cloud.siliconflow.cn/expensebill',
      width: 900,
      height: 700
    },
    aihubmix: {
      url: `https://console.inferera.com/topup?client_id=cherry_studio_oauth&lang=${lang}&aff=SJyh`,
      width: 720,
      height: 900
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
      url: `https://maas.aiionly.com/recharge`,
      width: 900,
      height: 700
    }
  }

  const { url, width, height } = chargeUrlMap[provider]

  openNamedPopup(
    url,
    'oauth',
    `width=${width},height=${height},toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,alwaysOnTop=yes,alwaysRaised=yes`
  )
}

export const providerBills = async (provider: string) => {
  const lang = await getLanguageCode()
  const billsUrlMap = {
    silicon: {
      url: 'https://cloud.siliconflow.cn/bills',
      width: 900,
      height: 700
    },
    aihubmix: {
      url: `https://console.inferera.com/statistics?client_id=cherry_studio_oauth&lang=${lang}&aff=SJyh`,
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
      url: `https://maas.aiionly.com/billManagement`,
      width: 900,
      height: 700
    }
  }

  const { url, width, height } = billsUrlMap[provider]

  openNamedPopup(
    url,
    'oauth',
    `width=${width},height=${height},toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,alwaysOnTop=yes,alwaysRaised=yes`
  )
}
