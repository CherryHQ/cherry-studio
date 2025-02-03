export const oauthWithSiliconFlow = async (setKey) => {
  const clientId = 'SFrugiu0ezVmREv8BAU6GV'
  const ACCOUNT_ENDPOINT = 'https://account.siliconflow.cn'
  const authUrl = `${ACCOUNT_ENDPOINT}/oauth?client_id=${clientId}`

  const popup = window.open(
    authUrl,
    'oauth',
    'width=720,height=720,toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,alwaysOnTop=yes,alwaysRaised=yes'
  )

  const messageHandler = (event) => {
    console.log(event.data)
    popup?.close()
    // if (event.data.length > 0 && event.data[0]['secretKey'] !== undefined) {
    //   setKey(event.data[0]['secretKey'])
    //   popup?.close()
    // }
  }

  window.addEventListener('message', messageHandler)
}
