import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { getAppLanguage, t } from '@main/i18n'
import { app, dialog, session, shell, webContents } from 'electron'
import { existsSync, promises as fs } from 'fs'
import { join } from 'path'

import { isMiniAppPartition } from '../features/miniApp/runtime/partition'
import { isSafeExternalUrl } from '../utils/externalUrlSafety'

const logger = loggerService.withContext('WebviewService')
/** The one session site mini apps share; every other partition belongs to a policy this service must not touch. */
const WEBVIEW_PARTITION = 'persist:webview'

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
 *
 * Site webviews only. A mini app guest (`persist:miniapp:*`) carries its own deny-all
 * popup policy, and `setWindowOpenHandler` REPLACES whatever was installed before —
 * a call here would hand the guest `shell.openExternal`, an exit from a sandbox that
 * promises none. Decided on the session, never on what the renderer claims.
 */
export function setOpenLinkExternal(webviewId: number, isExternal: boolean) {
  const webview = webContents.fromId(webviewId)
  if (!webview) return
  if (webview.session !== session.fromPartition(WEBVIEW_PARTITION)) {
    logger.warn('Refused to change the popup policy of a webview outside the site partition', { webviewId })
    return
  }

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
    const wvSession = session.fromPartition(WEBVIEW_PARTITION)
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
   * Install the keyboard relay into every SITE mini app guest. Assigned per `<webview>`
   * rather than on the session, which `persist:webview` OAuth login windows also share.
   *
   * NOT local mini apps — the filter below excludes them, deliberately. Read it before
   * concluding that a local app missing its shortcuts is a bug to fix here.
   */
  private initKeyboardRelayPreload() {
    const preloadPath = join(__dirname, '../preload/miniApp.js')
    // Electron reports nothing when a preload path is wrong, and the symptom is every
    // MiniApp shortcut silently dying, so the mismatch has to be its own signal.
    if (!existsSync(preloadPath)) {
      logger.error(`MiniApp keyboard relay preload is missing, shortcuts will not work: ${preloadPath}`)
      return
    }

    const attach = (_: Electron.Event, contents: Electron.WebContents) => {
      contents.on('will-attach-webview', (_event, webPreferences, params) => {
        // LOCAL mini apps are EXCLUDED, by their partition rather than by which window this
        // is: `webviewHost` gives them the sandboxed bridge preload, both writers land on
        // the same single `webPreferences.preload` slot, and without this filter which one
        // survives is decided by the order two unrelated modules happened to register in.
        //
        // THE COST, written here because reviewers keep re-deriving it as a defect: a local
        // mini app emits no `MINI_APP_KEYDOWN_CHANNEL`, so host shortcuts stop reaching the
        // host while its guest has focus. Composing the relay INTO the bridge is blocked by
        // Electron rather than by effort — a sandboxed preload must be ONE bundled file, so
        // any module the two entries share becomes a rollup chunk the sandboxed one would
        // have to `require`. Verified by building; inlining the wiring does not help either,
        // because `@shared/utils/webviewKey` is then hoisted and the site relay breaks too.
        // Closing it needs per-entry build machinery. Known gap, not an oversight.
        if (isMiniAppPartition(params.partition)) return
        webPreferences.preload = preloadPath
      })
    }
    app.on('web-contents-created', attach)
    this.registerDisposable(() => app.removeListener('web-contents-created', attach))
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
