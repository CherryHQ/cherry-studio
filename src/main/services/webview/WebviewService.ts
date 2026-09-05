import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { getAppLanguage, t } from '@main/i18n'
import type { WindowId } from '@shared/ipc/types'
import type { WebviewAnnotation, WebviewAnnotationTarget } from '@shared/types/webviewAnnotation'
import { app, dialog, session, shell, webContents } from 'electron'
import { existsSync, promises as fs } from 'fs'

import { isSafeExternalUrl } from '../../utils/externalUrlSafety'
import { exportAnnotationDocument } from './annotationExport'
import { AnnotationSession } from './AnnotationSession'

const logger = loggerService.withContext('WebviewService')
/** The one session site mini apps share; every other partition belongs to a policy this service must not touch. */
const WEBVIEW_PARTITION = 'persist:webview'

interface ExportAnnotationsInput {
  webviewId: number
  documentSessionId: string
  target: WebviewAnnotationTarget
  annotations: WebviewAnnotation[]
}

/**
 * init the useragent of the webview session
 * remove the CherryStudio and Electron from the useragent
 */
export function initSessionUserAgent() {
  const wvSession = session.fromPartition(WEBVIEW_PARTITION)
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
 * It controls whether links should be opened within the application or in an external browser.
 *
 * The caller checks that this is an owned site webview. A local mini app guest
 * (`persist:miniapp:*`) carries its own deny-all popup policy, and
 * `setWindowOpenHandler` replaces whatever was installed before it.
 */
function configureOpenLinkExternal(webview: Electron.WebContents, isExternal: boolean) {
  webview.setWindowOpenHandler(({ url }) => {
    if (isExternal) {
      if (isSafeExternalUrl(url)) {
        void shell.openExternal(url)
      } else {
        logger.warn(`Blocked shell.openExternal for untrusted URL scheme: ${url}`)
      }
      return { action: 'deny' }
    } else {
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
  private readonly preloadBindings = new Map<Electron.WebContents, () => void>()
  private readonly annotationSessions = new Map<number, AnnotationSession>()

  protected async onInit() {
    this.initSessionUserAgent()
    this.initWebviews()
  }

  protected async onStop() {
    const annotationSessions = [...this.annotationSessions.values()]
    for (const annotationSession of annotationSessions) annotationSession.dispose()
    await Promise.all(annotationSessions.map((annotationSession) => annotationSession.waitForIdle()))
    for (const cleanup of this.preloadBindings.values()) cleanup()
    this.preloadBindings.clear()
    this.annotationSessions.clear()
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

  private initWebviews() {
    webContents.getAllWebContents().forEach((contents) => {
      if (contents.isDestroyed()) return
      this.attachWebviewPreload(contents)
      this.initializeWebview(contents, true)
    })

    const handler = (_: Electron.Event, contents: Electron.WebContents) => {
      this.attachWebviewPreload(contents)
      this.initializeWebview(contents)
    }
    app.on('web-contents-created', handler)
    this.registerDisposable(() => app.removeListener('web-contents-created', handler))
  }

  private attachWebviewPreload(contents: Electron.WebContents) {
    if (this.preloadBindings.has(contents)) return

    const preloadPath = application.getPath('feature.webview.preload_file')
    if (!existsSync(preloadPath)) {
      logger.error(`Webview preload is missing, annotations and host shortcuts will not work: ${preloadPath}`)
      return
    }

    const handler = (
      _event: Electron.Event,
      webPreferences: Electron.WebPreferences,
      params: { partition?: string }
    ) => {
      // Local mini apps own a separate capability bridge and sandbox policy. Electron has
      // one preload slot, so writing here would silently replace that bridge.
      if (params.partition !== WEBVIEW_PARTITION) return
      webPreferences.preload = preloadPath
      webPreferences.nodeIntegration = false
      webPreferences.nodeIntegrationInSubFrames = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
    }

    contents.on('will-attach-webview', handler)
    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      contents.removeListener('will-attach-webview', handler)
      contents.removeListener('destroyed', cleanup)
      if (this.preloadBindings.get(contents) === cleanup) this.preloadBindings.delete(contents)
    }
    contents.once('destroyed', cleanup)
    this.preloadBindings.set(contents, cleanup)
  }

  private initializeWebview(contents: Electron.WebContents, announceIfLoaded = false) {
    if (contents.getType?.() !== 'webview' || contents.session !== session.fromPartition(WEBVIEW_PARTITION)) {
      return
    }
    const existing = this.annotationSessions.get(contents.id)
    if (existing?.isFor(contents)) return
    existing?.dispose()

    const annotationSession = new AnnotationSession(contents, () => {
      if (this.annotationSessions.get(contents.id) === annotationSession) {
        this.annotationSessions.delete(contents.id)
      }
    })
    this.annotationSessions.set(contents.id, annotationSession)
    if (announceIfLoaded && !contents.isLoadingMainFrame()) annotationSession.announce()
  }

  private requireOwnedGuest(webviewId: number, senderId: WindowId | null) {
    const hostWindow = senderId ? application.get('WindowManager').getWindow(senderId) : undefined
    const guest = webContents.fromId(webviewId)

    if (
      !hostWindow ||
      !guest ||
      guest.isDestroyed() ||
      guest.getType?.() !== 'webview' ||
      guest.hostWebContents !== hostWindow.webContents
    ) {
      throw new Error('The caller does not own this webview')
    }

    return guest
  }

  private requireOwnedSiteWebview(webviewId: number, senderId: WindowId | null) {
    const guest = this.requireOwnedGuest(webviewId, senderId)
    if (guest.session !== session.fromPartition(WEBVIEW_PARTITION)) {
      throw new Error('The caller does not own this webview')
    }
    return guest
  }

  async exportAnnotations(input: ExportAnnotationsInput, senderId: WindowId | null): Promise<string> {
    const guest = this.requireOwnedSiteWebview(input.webviewId, senderId)
    const annotationSession = this.annotationSessions.get(input.webviewId)
    if (!annotationSession?.isFor(guest)) throw new Error('Annotation document session is stale')

    return annotationSession.run(input.documentSessionId, async (signal) => {
      const markdown = await exportAnnotationDocument({
        guest,
        target: input.target,
        annotations: input.annotations,
        signal
      })
      if (this.requireOwnedSiteWebview(input.webviewId, senderId) !== guest) {
        throw new Error('The caller does not own this webview')
      }
      return markdown
    })
  }

  setSpellCheckerEnabled(webviewId: number, isEnable: boolean, senderId: WindowId | null): void {
    this.requireOwnedGuest(webviewId, senderId).session.setSpellCheckerEnabled(isEnable)
  }

  setOpenLinkExternal(webviewId: number, isExternal: boolean, senderId: WindowId | null): void {
    configureOpenLinkExternal(this.requireOwnedSiteWebview(webviewId, senderId), isExternal)
  }

  /**
   * Print webview content to PDF.
   */
  async printWebviewToPDF(webviewId: number, senderId: WindowId | null): Promise<string | null> {
    const webview = this.requireOwnedGuest(webviewId, senderId)

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
  async saveWebviewAsHTML(webviewId: number, senderId: WindowId | null): Promise<string | null> {
    const webview = this.requireOwnedGuest(webviewId, senderId)

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
