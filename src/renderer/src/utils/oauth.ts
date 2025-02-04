import { SILICON_CLIENT_ID } from '@renderer/config/constant'
import { getLanguageCode } from '@renderer/i18n'
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
  const authUrl = `https://aihubmix.com/login?cherry_studio_oauth=true&lang=${getLanguageCode()}&aff=SJyh`

  const popup = window.open(
    authUrl,
    'oauth',
    'width=720,height=720,toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,alwaysOnTop=yes,alwaysRaised=yes'
  )

  const messageHandler = (event) => {
    const data = event.data

    if (data && data.key === 'cherry_studio_oauth_callback') {
      const apiKeys = data?.data?.apiKeys
      if (apiKeys && apiKeys.length > 0) {
        setKey(apiKeys[0].value)
        popup?.close()
        window.removeEventListener('message', messageHandler)
      }
    }
  }

  window.removeEventListener('message', messageHandler)
  window.addEventListener('message', messageHandler)
}
