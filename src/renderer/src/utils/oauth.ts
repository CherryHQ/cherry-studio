import { SILICON_CLIENT_ID } from '@renderer/config/constant'
import { getLanguageCode } from '@renderer/i18n'
import i18n from '@renderer/i18n'
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
    }
  }

  const { url, width, height } = chargeUrlMap[provider]

  window.open(
    url,
    'oauth',
    `width=${width},height=${height},toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,alwaysOnTop=yes,alwaysRaised=yes`
  )
}

export const oauthWithGoogleDrive = async (setAuth: (accessToken: string, refreshToken: string, expiresAt: number) => void) => {
  // Google OAuth 客户端ID需要在Google Cloud Console注册获取
  // 项目上线时需要替换为实际的客户端ID
  const GOOGLE_CLIENT_ID = import.meta.env.RENDERER_VITE_GOOGLE_CLIENT_ID || 'your-google-client-id'
  const GOOGLE_CLIENT_SECRET = import.meta.env.RENDERER_VITE_GOOGLE_CLIENT_SECRET || ''
  const REDIRECT_URI = 'https://cherry-ai.com/oauth/google-callback'

  // Google OAuth 授权页面URL
  const scope = encodeURIComponent('https://www.googleapis.com/auth/drive.file')
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`

  const popup = window.open(
    authUrl,
    'oauth',
    'width=720,height=720,toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,alwaysOnTop=yes,alwaysRaised=yes'
  )

  const messageHandler = (event) => {
    // 确保只处理来自预期源的消息
    if (event.origin !== 'https://cherry-ai.com') return

    const data = event.data
    if (data && data.key === 'google_drive_oauth_callback') {
      try {
        const { accessToken, refreshToken, expiresAt } = data
        if (accessToken) {
          setAuth(accessToken, refreshToken, expiresAt)
          popup?.close()
          window.removeEventListener('message', messageHandler)
          window.message.success(i18n.t('oauth.success'))
        }
      } catch (error) {
        console.error('[oauthWithGoogleDrive] error', error)
        popup?.close()
        window.message.error(i18n.t('oauth.error'))
      }
    }
  }

  window.removeEventListener('message', messageHandler)
  window.addEventListener('message', messageHandler)
}

export const oauthWithOneDrive = async (setAuth: (accessToken: string, refreshToken: string, expiresAt: number) => void) => {
  // Microsoft应用注册门户获取客户端ID
  // 项目上线时需要替换为实际的客户端ID
  const MS_CLIENT_ID = import.meta.env.RENDERER_VITE_MS_CLIENT_ID || 'your-ms-client-id'
  const MS_CLIENT_SECRET = import.meta.env.RENDERER_VITE_MS_CLIENT_SECRET || ''
  const REDIRECT_URI = 'https://cherry-ai.com/oauth/onedrive-callback'

  // OneDrive OAuth 授权页面URL
  const scope = encodeURIComponent('files.readwrite offline_access')
  const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${MS_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${scope}`

  const popup = window.open(
    authUrl,
    'oauth',
    'width=720,height=720,toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,alwaysOnTop=yes,alwaysRaised=yes'
  )

  const messageHandler = (event) => {
    // 确保只处理来自预期源的消息
    if (event.origin !== 'https://cherry-ai.com') return

    const data = event.data
    if (data && data.key === 'onedrive_oauth_callback') {
      try {
        const { accessToken, refreshToken, expiresAt } = data
        if (accessToken) {
          setAuth(accessToken, refreshToken, expiresAt)
          popup?.close()
          window.removeEventListener('message', messageHandler)
          window.message.success(i18n.t('oauth.success'))
        }
      } catch (error) {
        console.error('[oauthWithOneDrive] error', error)
        popup?.close()
        window.message.error(i18n.t('oauth.error'))
      }
    }
  }

  window.removeEventListener('message', messageHandler)
  window.addEventListener('message', messageHandler)
}
