import { PPIO_APP_SECRET, PPIO_CLIENT_ID, SILICON_CLIENT_ID, TOKENFLUX_HOST } from '@renderer/config/constant'
import i18n, { getLanguageCode } from '@renderer/i18n'

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
  const authUrl = ` https://aihubmix.com/token?client_id=cherry_studio_oauth&lang=${getLanguageCode()}&aff=SJyh`

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
        console.error('[oauthWithAihubmix] error', error)
        popup?.close()
        window.message.error(i18n.t('oauth.error'))
      }
    }
  }

  window.removeEventListener('message', messageHandler)
  window.addEventListener('message', messageHandler)
}

export const oauthWithPPIO = async (setKey) => {
  const redirectUri = 'cherrystudio://'
  const authUrl = `https://ppio.cn/oauth/authorize?invited_by=JYT9GD&client_id=${PPIO_CLIENT_ID}&scope=api%20openid&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}`

  window.open(
    authUrl,
    'oauth',
    'width=720,height=720,toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,alwaysOnTop=yes,alwaysRaised=yes'
  )

  if (!setKey) {
    console.log('[PPIO OAuth] No setKey callback provided, returning early')
    return
  }

  console.log('[PPIO OAuth] Setting up protocol listener')

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
        const tokenResponse = await fetch('https://ppio.cn/oauth/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: formData.toString()
        })

        if (!tokenResponse.ok) {
          const errorText = await tokenResponse.text()
          console.error('[PPIO OAuth] Token exchange failed:', tokenResponse.status, errorText)
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
        console.error('[PPIO OAuth] Error processing callback:', error)
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
    window.message.error(i18n.t('oauth.error'))
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

export const providerCharge = async (provider: string) => {
  const chargeUrlMap = {
    silicon: {
      url: 'https://cloud.siliconflow.cn/expensebill',
      width: 900,
      height: 700
    },
    aihubmix: {
      url: `https://aihubmix.com/topup?client_id=cherry_studio_oauth&lang=${getLanguageCode()}&aff=SJyh`,
      width: 720,
      height: 900
    },
    tokenflux: {
      url: `https://tokenflux.ai/dashboard/billing`,
      width: 900,
      height: 700
    },
    ppio: {
      url: 'https://ppio.cn/billing?invited_by=JYT9GD&utm_source=github_cherry-studio',
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
      url: `https://aihubmix.com/statistics?client_id=cherry_studio_oauth&lang=${getLanguageCode()}&aff=SJyh`,
      width: 900,
      height: 700
    },
    tokenflux: {
      url: `https://tokenflux.ai/dashboard/billing`,
      width: 900,
      height: 700
    },
    ppio: {
      url: 'https://ppio.cn/billing/billing-details?invited_by=JYT9GD&utm_source=github_cherry-studio',
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
