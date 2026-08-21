import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { getAppLanguage, t } from '@main/i18n'
import { dialog, session, shell, webContents } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

import { isSafeExternalUrl } from '../utils/externalUrlSafety'

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
      // In-app popups must stay on web origins; isSafeExternalUrl is not reused here
      // because its allowlist (mailto:, editor deep-links) targets shell.openExternal.
      if (url.startsWith('http:') || url.startsWith('https:')) {
        return { action: 'allow' }
      }
      logger.warn(`Blocked in-app popup for untrusted URL scheme: ${url}`)
      return { action: 'deny' }
    }
  })
}

@Injectable('WebviewService')
@ServicePhase(Phase.WhenReady)
export class WebviewService extends BaseService {
  protected async onInit() {
    this.initSessionUserAgent()
    this.initKeyboardRelayPreload()
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
   * Install the keyboard relay into every MiniApp guest. Registered on the session so
   * a compromised renderer cannot choose the guest's preload via the `<webview>` tag.
   */
  private initKeyboardRelayPreload() {
    const wvSession = session.fromPartition('persist:webview')
    const id = wvSession.registerPreloadScript({
      type: 'frame',
      filePath: join(__dirname, '../preload/miniApp.js')
    })
    this.registerDisposable(() => wvSession.unregisterPreloadScript(id))
  }

  /**
   * Print webview content to PDF.
   */
  async printWebviewToPDF(webviewId: number): Promise<string | null> {
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
  async saveWebviewAsHTML(webviewId: number): Promise<string | null> {
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
