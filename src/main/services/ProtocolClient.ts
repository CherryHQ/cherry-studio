import { windowService } from './WindowService'

export const CHERRY_STUDIO_PROTOCOL = 'cherrystudio'

export function registerProtocolClient(app: Electron.App) {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(CHERRY_STUDIO_PROTOCOL, process.execPath, [process.argv[1]])
    }
  }

  app.setAsDefaultProtocolClient('cherrystudio')
}

export function handleProtocolUrl(url: string) {
  if (!url) return
  // Process the URL that was used to open the app
  // The url will be in the format: cherrystudio://data?param1=value1&param2=value2
  console.log('Received URL:', url)

  // Parse the URL and extract parameters
  const urlObj = new URL(url)
  const params = new URLSearchParams(urlObj.search)

  // You can send the data to your renderer process
  const mainWindow = windowService.getMainWindow()

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('protocol-data', {
      url,
      params: Object.fromEntries(params.entries())
    })
  }
}
