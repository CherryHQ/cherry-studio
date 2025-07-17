import { isMac } from '@main/constant'
import Logger from 'electron-log'

import { windowService } from '../WindowService'

function ParseData(data: string) {
  try {
    const result = JSON.parse(Buffer.from(data, 'base64').toString('utf-8'))

    return JSON.stringify(result)
  } catch (error) {
    Logger.error('ParseData error:', { error })
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
        Logger.error('handleProvidersProtocolUrl data is null or invalid')
        return
      }

      const mainWindow = windowService.getMainWindow()
      const version = params.get('v')
      if (version == '1') {
        // TODO: handle different version
        Logger.info('handleProvidersProtocolUrl', { data, version })
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
          Logger.info('handleProvidersProtocolUrl timeout', { data, version })
          handleProvidersProtocolUrl(url)
        }, 1000)
      }
      break
    }
    default:
      Logger.error(`Unknown MCP protocol URL: ${url}`)
      break
  }
}
