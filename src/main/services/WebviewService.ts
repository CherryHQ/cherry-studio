import { IpcChannel } from '@shared/IpcChannel'
import { app, session, shell, webContents } from 'electron'

/**
 * init the useragent of the webview session
 * remove the CherryStudio and Electron from the useragent
 */
export function initSessionUserAgent() {
  const wvSession = session.fromPartition('persist:webview')
  const originUA = wvSession.getUserAgent()
  const newUA = originUA.replace(/CherryStudio\/\S+\s/, '').replace(/Electron\/\S+\s/, '')

  wvSession.setUserAgent(newUA)
  wvSession.webRequest.onBeforeSendHeaders((details, cb) => {
    const headers = {
      ...details.requestHeaders,
      'User-Agent': details.url.includes('google.com') ? originUA : newUA
    }
    cb({ requestHeaders: headers })
  })
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

const attachKeyboardHandler = (contents: Electron.WebContents) => {
  if (contents.getType?.() !== 'webview') {
    return
  }

  const handleBeforeInput = (event: Electron.Event, input: Electron.Input) => {
    if (!input) {
      return
    }

    const key = input.key?.toLowerCase()
    if (!key) {
      return
    }

    const isFindShortcut = (input.control || input.meta) && key === 'f'
    const isEscape = key === 'escape'
    const isEnter = key === 'enter'

    if (!isFindShortcut && !isEscape && !isEnter) {
      return
    }

    const host = contents.hostWebContents
    if (!host || host.isDestroyed()) {
      return
    }

    // Always prevent Cmd/Ctrl+F to override the guest page's native find dialog
    if (isFindShortcut) {
      event.preventDefault()
    }

    // Send the hotkey event to the renderer
    // The renderer will decide whether to preventDefault for Escape and Enter
    // based on whether the search bar is visible
    host.send(IpcChannel.Webview_SearchHotkey, {
      webviewId: contents.id,
      key,
      control: Boolean(input.control),
      meta: Boolean(input.meta),
      shift: Boolean(input.shift),
      alt: Boolean(input.alt)
    })
  }

  contents.on('before-input-event', handleBeforeInput)
  contents.once('destroyed', () => {
    contents.removeListener('before-input-event', handleBeforeInput)
  })
}

export function initWebviewHotkeys() {
  webContents.getAllWebContents().forEach((contents) => {
    if (contents.isDestroyed()) return
    attachKeyboardHandler(contents)
  })

  app.on('web-contents-created', (_, contents) => {
    attachKeyboardHandler(contents)
  })
}
