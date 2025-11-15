import { IpcChannel } from '@shared/IpcChannel'
import { app, dialog, session, shell, webContents } from 'electron'
import { promises as fs } from 'fs'

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

    // Helper to check if this is a shortcut we handle
    const isHandledShortcut = (k: string) => {
      const isFindShortcut = (input.control || input.meta) && k === 'f'
      const isPrintShortcut = (input.control || input.meta) && k === 'p'
      const isSaveShortcut = (input.control || input.meta) && k === 's'
      const isEscape = k === 'escape'
      const isEnter = k === 'enter'
      return isFindShortcut || isPrintShortcut || isSaveShortcut || isEscape || isEnter
    }

    if (!isHandledShortcut(key)) {
      return
    }

    const host = contents.hostWebContents
    if (!host || host.isDestroyed()) {
      return
    }

    const isFindShortcut = (input.control || input.meta) && key === 'f'
    const isPrintShortcut = (input.control || input.meta) && key === 'p'
    const isSaveShortcut = (input.control || input.meta) && key === 's'

    // Always prevent Cmd/Ctrl+F to override the guest page's native find dialog
    if (isFindShortcut) {
      event.preventDefault()
    }

    // Prevent default print/save dialogs and handle them with custom logic
    if (isPrintShortcut || isSaveShortcut) {
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

/**
 * Print webview content to PDF
 * @param webviewId The webview webContents id
 * @returns Path to saved PDF file or null if user cancelled
 */
export async function printWebviewToPDF(webviewId: number): Promise<string | null> {
  const webview = webContents.fromId(webviewId)
  if (!webview) {
    throw new Error('Webview not found')
  }

  try {
    // Get the page title for default filename
    const pageTitle = await webview.executeJavaScript('document.title || "webpage"').catch(() => 'webpage')
    // Sanitize filename by removing invalid characters
    const sanitizedTitle = pageTitle.replace(/[<>:"/\\|?*]/g, '-').substring(0, 100)
    const defaultFilename = sanitizedTitle ? `${sanitizedTitle}.pdf` : `webpage-${Date.now()}.pdf`

    // Show save dialog
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Save as PDF',
      defaultPath: defaultFilename,
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    })

    if (canceled || !filePath) {
      return null
    }

    // Generate PDF with settings to capture full page
    const pdfData = await webview.printToPDF({
      marginsType: 0,
      printBackground: true,
      printSelectionOnly: false,
      landscape: false,
      pageSize: 'A4',
      preferCSSPageSize: true
    })

    // Save PDF to file
    await fs.writeFile(filePath, pdfData)

    return filePath
  } catch (error) {
    throw new Error(`Failed to print to PDF: ${(error as Error).message}`)
  }
}

/**
 * Save webview content as HTML
 * @param webviewId The webview webContents id
 * @returns Path to saved HTML file or null if user cancelled
 */
export async function saveWebviewAsHTML(webviewId: number): Promise<string | null> {
  const webview = webContents.fromId(webviewId)
  if (!webview) {
    throw new Error('Webview not found')
  }

  try {
    // Get the page title for default filename
    const pageTitle = await webview.executeJavaScript('document.title || "webpage"').catch(() => 'webpage')
    // Sanitize filename by removing invalid characters
    const sanitizedTitle = pageTitle.replace(/[<>:"/\\|?*]/g, '-').substring(0, 100)
    const defaultFilename = sanitizedTitle ? `${sanitizedTitle}.html` : `webpage-${Date.now()}.html`

    // Show save dialog
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Save as HTML',
      defaultPath: defaultFilename,
      filters: [
        { name: 'HTML Files', extensions: ['html', 'htm'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (canceled || !filePath) {
      return null
    }

    // Get the HTML content with safe error handling
    const html = await webview.executeJavaScript(`
      (() => {
        try {
          // Build complete DOCTYPE string if present
          let doctype = '';
          if (document.doctype) {
            const dt = document.doctype;
            doctype = '<!DOCTYPE ' + (dt.name || 'html');
            
            // Add PUBLIC identifier if publicId is present
            if (dt.publicId) {
              // Escape single quotes in publicId
              const escapedPublicId = String(dt.publicId).replace(/'/g, "\\'");
              doctype += " PUBLIC '" + escapedPublicId + "'";
              
              // Add systemId if present (required when publicId is present)
              if (dt.systemId) {
                const escapedSystemId = String(dt.systemId).replace(/'/g, "\\'");
                doctype += " '" + escapedSystemId + "'";
              }
            } else if (dt.systemId) {
              // SYSTEM identifier (without PUBLIC)
              const escapedSystemId = String(dt.systemId).replace(/'/g, "\\'");
              doctype += " SYSTEM '" + escapedSystemId + "'";
            }
            
            doctype += '>';
          }
          return doctype + (document.documentElement?.outerHTML || '');
        } catch (error) {
          // Fallback: just return the HTML without DOCTYPE if there's an error
          return document.documentElement?.outerHTML || '';
        }
      })()
    `)

    // Save HTML to file
    await fs.writeFile(filePath, html, 'utf-8')

    return filePath
  } catch (error) {
    throw new Error(`Failed to save as HTML: ${(error as Error).message}`)
  }
}
