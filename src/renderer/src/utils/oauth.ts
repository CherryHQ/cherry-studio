import { SILICON_CLIENT_ID } from '@renderer/config/constant'

export const oauthWithSiliconFlow = async (setKey) => {
  const authUrl = `https://account.siliconflow.cn/oauth?client_id=${SILICON_CLIENT_ID}`

  const popup = window.open(
    authUrl,
    'oauth',
    'width=720,height=720,toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,alwaysOnTop=yes,alwaysRaised=yes'
  )

  const messageHandler = (event) => {
    console.log('messageHandler', event)
    if (event.data.length > 0 && event.data[0]['secretKey'] !== undefined) {
      setKey(event.data[0]['secretKey'])
      popup?.close()
      window.removeEventListener('message', messageHandler)
    }
  }

  window.removeEventListener('message', messageHandler)
  window.addEventListener('message', messageHandler)
}
