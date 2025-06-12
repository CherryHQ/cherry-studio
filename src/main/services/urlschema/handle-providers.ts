import { IpcChannel } from '@shared/IpcChannel'
import Logger from 'electron-log'

import { windowService } from '../WindowService'

export function handleProvidersProtocolUrl(url: URL) {
  const params = new URLSearchParams(url.search)
  switch (url.pathname) {
    case '/api-keys': {
      // jsonConfig example:
      // {
      //   "id": "tokenflux",
      //   "baseUrl": "https://tokenflux.ai/v1",
      //   "apiKey": "sk-xxxx"
      // }
      // cherrystudio://providers/api-keys?data={base64Encode(JSON.stringify(jsonConfig))}
      const data = params.get('data')
      if (data) {
        const stringify = Buffer.from(data, 'base64').toString('utf8')
        Logger.info('get api keys from urlschema: ', stringify)
        const jsonConfig = JSON.parse(stringify)
        Logger.info('get api keys from urlschema: ', jsonConfig)
        const mainWindow = windowService.getMainWindow()
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IpcChannel.Provider_AddKey, jsonConfig)
          mainWindow.webContents.executeJavaScript(`window.navigate('/settings/provider?id=${jsonConfig.id}')`)
        }
      } else {
        Logger.error('No data found in URL')
      }
      break
    }
    default:
      console.error(`Unknown MCP protocol URL: ${url}`)
      break
  }
}
