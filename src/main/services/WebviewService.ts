import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { getAppLanguage, t } from '@main/utils/language'
import { IpcChannel } from '@shared/IpcChannel'
import { app, dialog, session, shell, webContents } from 'electron'
import { promises as fs } from 'fs'

import { isSafeExternalUrl } from './security'

const logger = loggerService.withContext('WebviewService')

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
    const language = application.get('PreferenceService').get('app.language')
    const headers = {
      ...details.requestHeaders,
      'User-Agent': details.url.includes('google.com') ? originUA : newUA,
      'Accept-Language': `${language}, en;q=0.9, *;q=0.5`
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
      if (isSafeExternalUrl(url)) {
        void shell.openExternal(url)
      } else {
        logger.warn(`Blocked shell.openExternal for untrusted URL scheme: ${url}`)
      }
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

@Injectable('WebviewService')
@ServicePhase(Phase.WhenReady)
export class WebviewService extends BaseService {
  protected async onInit() {
    this.initSessionUserAgent()
    this.initWebviewHotkeys()
    this.registerIpcHandlers()
  }

  private registerIpcHandlers() {
    this.ipcHandle(IpcChannel.Webview_SetOpenLinkExternal, (_, webviewId: number, isExternal: boolean) => {
      const webview = webContents.fromId(webviewId)
      if (!webview) return

      webview.setWindowOpenHandler(({ url }) => {
        if (isExternal) {
          void shell.openExternal(url)
          return { action: 'deny' as const }
        } else {
          return { action: 'allow' as const }
        }
      })
    })

    this.ipcHandle(IpcChannel.Webview_SetSpellCheckEnabled, (_, webviewId: number, isEnable: boolean) => {
      const webview = webContents.fromId(webviewId)
      if (!webview) return
      webview.session.setSpellCheckerEnabled(isEnable)
    })

    this.ipcHandle(IpcChannel.Webview_PrintToPDF, async (_, webviewId: number) => {
      return await this.printWebviewToPDF(webviewId)
    })

    this.ipcHandle(IpcChannel.Webview_SaveAsHTML, async (_, webviewId: number) => {
      return await this.saveWebviewAsHTML(webviewId)
    })
  }

  /**
   * Initialize the useragent of the webview session.
   * Removes CherryStudio and Electron from the useragent.
   */
  private initSessionUserAgent() {
    const wvSession = session.fromPartition('persist:webview')
    const originUA = wvSession.getUserAgent()
    const newUA = originUA.replace(/CherryStudio\/\S+\s/, '').replace(/Electron\/\S+\s/, '')

    wvSession.setUserAgent(newUA)
    wvSession.webRequest.onBeforeSendHeaders((details, cb) => {
      const language = getAppLanguage()
      const headers = {
        ...details.requestHeaders,
        'User-Agent': details.url.includes('google.com') ? originUA : newUA,
        'Accept-Language': `${language}, en;q=0.9, *;q=0.5`
      }
      cb({ requestHeaders: headers })
    })
    this.registerDisposable(() => wvSession.webRequest.onBeforeSendHeaders(null))
  }

  /**
   * Attach keyboard hotkey handlers to all existing and future webviews.
   */
  private initWebviewHotkeys() {
    webContents.getAllWebContents().forEach((contents) => {
      if (contents.isDestroyed()) return
      attachKeyboardHandler(contents)
    })

    const handler = (_: Electron.Event, contents: Electron.WebContents) => {
      attachKeyboardHandler(contents)
    }
    app.on('web-contents-created', handler)
    this.registerDisposable(() => app.removeListener('web-contents-created', handler))
  }

  /**
   * Print webview content to PDF.
   */
  private async printWebviewToPDF(webviewId: number): Promise<string | null> {
    const webview = webContents.fromId(webviewId)
    if (!webview) {
      throw new Error('Webview not found')
    }

    const pageTitle = await webview.executeJavaScript('document.title || "webpage"').catch(() => 'webpage')
    const sanitizedTitle = pageTitle.replace(/[<>:"/\\|?*]/g, '-').substring(0, 100)
    const defaultFilename = sanitizedTitle ? `${sanitizedTitle}.pdf` : `webpage-${Date.now()}.pdf`

    const { canceled, filePath } = await dialog.showSaveDialog({
      title: t('dialog.save_as_pdf'),
      defaultPath: defaultFilename,
      filters: [{ name: t('dialog.pdf_files'), extensions: ['pdf'] }]
    })

    if (canceled || !filePath) {
      return null
    }

    const pdfData = await webview.printToPDF({
      margins: {
        marginType: 'default'
      },
      printBackground: true,
      landscape: false,
      pageSize: 'A4',
      preferCSSPageSize: true
    })

    await fs.writeFile(filePath, pdfData)

    return filePath
  }

  /**
   * Save webview content as HTML.
   */
  private async saveWebviewAsHTML(webviewId: number): Promise<string | null> {
    const webview = webContents.fromId(webviewId)
    if (!webview) {
      throw new Error('Webview not found')
    }

    const pageTitle = await webview.executeJavaScript('document.title || "webpage"').catch(() => 'webpage')
    const sanitizedTitle = pageTitle.replace(/[<>:"/\\|?*]/g, '-').substring(0, 100)
    const defaultFilename = sanitizedTitle ? `${sanitizedTitle}.html` : `webpage-${Date.now()}.html`

    const { canceled, filePath } = await dialog.showSaveDialog({
      title: t('dialog.save_as_html'),
      defaultPath: defaultFilename,
      filters: [
        { name: t('dialog.html_files'), extensions: ['html', 'htm'] },
        { name: t('dialog.all_files'), extensions: ['*'] }
      ]
    })

    if (canceled || !filePath) {
      return null
    }

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
              const escapedPublicId = String(dt.publicId).replace(/'/g, "\\\\'");
              doctype += " PUBLIC '" + escapedPublicId + "'";

              // Add systemId if present (required when publicId is present)
              if (dt.systemId) {
                const escapedSystemId = String(dt.systemId).replace(/'/g, "\\\\'");
                doctype += " '" + escapedSystemId + "'";
              }
            } else if (dt.systemId) {
              // SYSTEM identifier (without PUBLIC)
              const escapedSystemId = String(dt.systemId).replace(/'/g, "\\\\'");
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

    await fs.writeFile(filePath, html, 'utf-8')

    return filePath
  }
}
