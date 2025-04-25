import { session, shell, webContents } from 'electron'

/**
 * init the useragent of the webview session
 * remove the CherryStudio and Electron from the useragent
 */
export function initSessionUserAgent() {
  const wvSession = session.fromPartition('persist:webview')
  const newChromeVersion = '135.0.7049.96'
  const originUA = wvSession.getUserAgent()
  const newUA = originUA
    .replace(/CherryStudio\/\S+\s/, '')
    .replace(/Electron\/\S+\s/, '')
    .replace(/Chrome\/\d+\.\d+\.\d+\.\d+/, `Chrome/${newChromeVersion}`)

  wvSession.setUserAgent(newUA)
}

/**
 * WebviewService handles the behavior of links opened from webview elements
 * It controls whether links should be opened within the application or in an external browser
 */
export function setOpenLinkExternal(webviewId: number, isExternal: boolean) {
  const webview = webContents.fromId(webviewId)
  if (!webview) return

  webview.setWindowOpenHandler(({ url }) => {
    if (isExternal) {
      shell.openExternal(url)
      return { action: 'deny' }
    } else {
      return { action: 'allow' }
    }
  })
}
