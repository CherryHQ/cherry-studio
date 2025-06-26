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
      //   "apiKey": "sk-xxxx",
      //   "name": "TokenFlux", // optional
      //   "type": "openai" // optional
      // }
      // cherrystudio://providers/api-keys?data={base64Encode(JSON.stringify(jsonConfig))}
      const data = params.get('data')
      const mainWindow = windowService.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.executeJavaScript(`window.navigate('/settings/provider?addProviderData=${data}')`)
      }
      break
    }
    default:
      Logger.error(`Unknown MCP protocol URL: ${url}`)
      break
  }
}
