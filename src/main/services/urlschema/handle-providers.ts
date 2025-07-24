import { loggerService } from '@logger'
import { isMac } from '@main/constant'

import { windowService } from '../WindowService'
const logger = loggerService.withContext('URLSchema:handleProvidersProtocolUrl')

function ParseData(data: string) {
  try {
    const result = JSON.parse(
      Buffer.from(data, 'base64').toString('utf-8').replaceAll("'", '"').replaceAll('(', '').replaceAll(')', '')
    )

    return JSON.stringify(result)
  } catch (error) {
    logger.error('ParseData error:', error as Error)
    return null
  }
}

export async function handleProvidersProtocolUrl(url: URL) {
  switch (url.pathname) {
    case '/api-keys': {
      // jsonConfig example:
      // {
      //   "id": "tokenflux",
      //   "baseUrl": "https://tokenflux.ai/v1",
      //   "apiKey": "sk-xxxx",
      //   "name": "TokenFlux", // optional
      //   "type": "openai" // optional
      // }
      // cherrystudio://providers/api-keys?v=1&data={base64Encode(JSON.stringify(jsonConfig))}

      // replace + and / to _ and - because + and / are processed by URLSearchParams
      const processedSearch = url.search.replaceAll('+', '_').replaceAll('/', '-')
      const params = new URLSearchParams(processedSearch)
      const data = ParseData(params.get('data')?.replaceAll('_', '+').replaceAll('-', '/') || '')

      if (!data) {
        logger.error('handleProvidersProtocolUrl data is null or invalid')
        return
      }

      const mainWindow = windowService.getMainWindow()
      const version = params.get('v')
      if (version == '1') {
        // TODO: handle different version
        logger.debug('handleProvidersProtocolUrl', { data, version })
      }

      // add check there is window.navigate function in mainWindow
      if (
        mainWindow &&
        !mainWindow.isDestroyed() &&
        (await mainWindow.webContents.executeJavaScript(`typeof window.navigate === 'function'`))
      ) {
        mainWindow.webContents.executeJavaScript(
          `window.navigate('/settings/provider?addProviderData=${encodeURIComponent(data)}')`
        )

        if (isMac) {
          windowService.showMainWindow()
        }
      } else {
        setTimeout(() => {
          logger.debug('handleProvidersProtocolUrl timeout', { data, version })
          handleProvidersProtocolUrl(url)
        }, 1000)
      }
      break
    }
    default:
      logger.error(`Unknown MCP protocol URL: ${url}`)
      break
  }
}
