import { existsSync, promises as fs } from 'fs'

import { app, dialog, session, webContents } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { getAppLanguage, t } from '@main/i18n'
import type { WindowId } from '@shared/ipc/types'
import type { MiniAppCountry, MiniAppRegionProfile } from '@shared/types/miniAppRegion'
import type { WebviewAnnotation, WebviewAnnotationTarget } from '@shared/types/webviewAnnotation'
import { getWebviewPartition, WebviewSecurityProfile } from '@shared/utils/webviewSecurity'

import { isSafeExternalUrl } from '../../utils/externalUrlSafety'
import { exportAnnotationDocument } from './annotationExport'
import { AnnotationSession } from './AnnotationSession'
import { HiddenGuestFreezer } from './HiddenGuestFreezer'
import { RegionalSessionRegistry } from './RegionalSessionRegistry'
import { RemoteDebuggingMonitor } from './RemoteDebuggingMonitor'

const logger = loggerService.withContext('WebviewService')
/** Default site session; opt-in regional sessions are registered separately. */
const WEBVIEW_PARTITION = 'persist:webview'
/** Sessions whose guests run the annotation preload: mini-app sites plus the agent browser panes. */
const ANNOTATION_PARTITIONS = [
  WEBVIEW_PARTITION,
  getWebviewPartition(WebviewSecurityProfile.AgentBrowser),
  getWebviewPartition(WebviewSecurityProfile.AgentDevPreview),
  getWebviewPartition(WebviewSecurityProfile.AgentHtmlArtifact)
] as const

const isAnnotationCapableSession = (guestSession: Electron.Session) =>
  ANNOTATION_PARTITIONS.some((partition) => guestSession === session.fromPartition(partition))

interface ExportAnnotationsInput {
  webviewId: number
  documentSessionId: string
  target: WebviewAnnotationTarget
  annotations: WebviewAnnotation[]
}

/**
 * WebviewService handles the behavior of links opened from webview elements
 * It controls whether links should be opened within the application or in an external browser.
 *
 * The caller checks that this is an owned site webview. A local mini app guest
 * (`persist:miniapp:*`) carries its own deny-all popup policy, and
 * `setWindowOpenHandler` replaces whatever was installed before it.
 */
function configureOpenLinkExternal(webview: Electron.WebContents, isExternal: boolean, keepInApp = false) {
  webview.setWindowOpenHandler(({ url, disposition }) => {
    // Keep popup windows in the guest session so auth cookies and opener callbacks survive.
    if (disposition === 'new-window' && (url.startsWith('http:') || url.startsWith('https:'))) {
      return { action: 'allow' }
    }

    if (isExternal || (!keepInApp && application.get('PreferenceService').get('app.browser.open_links_in_browser'))) {
      if (isSafeExternalUrl(url)) {
        void application
          .get('MainWindowService')
          .openWebsite(url, isExternal)
          .catch((error) => logger.warn('Failed to open website', { error }))
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
@DependsOn(['BrowserSessionService', 'ProxyService'])
@ServicePhase(Phase.WhenReady)
export class WebviewService extends BaseService {
  private originalUserAgent?: string
  private readonly preloadBindings = new Map<Electron.WebContents, () => void>()
  private readonly annotationSessions = new Map<number, AnnotationSession>()
  private debuggingMonitor?: RemoteDebuggingMonitor
  private debuggingRevision = 0
  private readonly debuggingTargets = new Map<string, number>()
  private readonly hiddenGuests = new HiddenGuestFreezer((guest) => this.isGuestDebugging(guest.id))
  private readonly regions = new RegionalSessionRegistry((guestSession, profile) =>
    this.initSessionUserAgent(guestSession, profile)
  )
  private readonly regionalSessions = this.regions.sessions
  private readonly regionalGuests = new Map<Electron.WebContents, Promise<void>>()

  protected async onInit() {
    this.initSessionUserAgent()
    await this.regions.resume()
    this.initWebviews()
    this.initDebuggingMonitor()
    const preferences = application.get('PreferenceService')
    this.registerDisposable(
      preferences.subscribeMultipleChanges(
        [
          'app.developer_mode.enabled',
          'feature.mini_app.fake_environment.enabled',
          'feature.mini_app.fake_environment.country',
          'feature.mini_app.region_profiles',
          'feature.mini_app.us_environment_app_ids'
        ],
        () => {
          void this.regions.revokeInactive().catch((error) => logger.warn('Regional revocation failed', error))
        }
      )
    )
  }

  protected async onStop() {
    const suspension = this.regions.suspend()
    this.debuggingMonitor?.stop()
    this.hiddenGuests.dispose()
    for (const guest of this.regionalGuests.keys())
      application.get('BrowserSessionService').release(guest, 'mini-app-region')
    this.regionalGuests.clear()
    const annotationSessions = [...this.annotationSessions.values()]
    for (const annotationSession of annotationSessions) annotationSession.dispose()
    for (const cleanup of this.preloadBindings.values()) cleanup()
    this.preloadBindings.clear()
    this.annotationSessions.clear()
    const outcomes = await Promise.allSettled([
      suspension,
      ...annotationSessions.map((annotationSession) => annotationSession.waitForIdle())
    ])
    const errors = outcomes.flatMap((outcome) => (outcome.status === 'rejected' ? [outcome.reason] : []))
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, 'Failed to stop webview resources')
  }

  protected async onDestroy() {
    await this.regions.dispose()
  }

  private initDebuggingMonitor() {
    if (!app.commandLine.hasSwitch('remote-debugging-port')) return
    const monitor = new RemoteDebuggingMonitor(
      async () => {
        const configuredPort = Number(app.commandLine.getSwitchValue('remote-debugging-port'))
        if (Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort < 65535) return configuredPort
        const activePort = Number(
          (await fs.readFile(application.getPath('app.userdata', 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0]
        )
        if (!Number.isInteger(activePort) || activePort < 1 || activePort > 65535) {
          throw new Error('Remote debugging port is not available')
        }
        return activePort
      },
      (targetId, attached) => {
        const revision = ++this.debuggingRevision
        const previousOwner = this.debuggingTargets.get(targetId)
        const guest = webContents.fromDevToolsTargetId(targetId)
        const owner =
          previousOwner ?? (guest && !guest.isDestroyed() && guest.getType() === 'webview' ? guest.id : undefined)
        if (!attached) this.debuggingTargets.delete(targetId)
        if (owner === undefined) return
        if (attached) this.debuggingTargets.set(targetId, owner)
        application.get('IpcApiService').broadcast('webview.debugging.changed', {
          webviewId: owner,
          attached: this.isGuestDebugging(owner),
          revision
        })
      }
    )
    this.debuggingMonitor = monitor
    this.registerDisposable(() => {
      monitor.stop()
      if (this.debuggingMonitor === monitor) this.debuggingMonitor = undefined
    })
    monitor.start()
  }

  getDebuggingState(webviewId: number, senderId: WindowId | null) {
    const guest = this.requireOwnedGuest(webviewId, senderId)
    return {
      attached: this.isGuestDebugging(guest.id),
      revision: this.debuggingRevision
    }
  }

  private isGuestDebugging(webviewId: number): boolean {
    for (const targetId of this.debuggingMonitor?.getAttachedTargetIds() ?? []) {
      let owner = this.debuggingTargets.get(targetId)
      if (owner === undefined) {
        const guest = webContents.fromDevToolsTargetId(targetId)
        if (guest && !guest.isDestroyed() && guest.getType() === 'webview') {
          owner = guest.id
          this.debuggingTargets.set(targetId, owner)
        }
      }
      if (owner === webviewId) return true
    }
    return false
  }

  /**
   * Initialize the useragent of the webview session.
   * Removes CherryStudio and Electron from the useragent.
   */
  private initSessionUserAgent(wvSession = session.fromPartition(WEBVIEW_PARTITION), profile?: MiniAppRegionProfile) {
    // Later regional sessions inherit the cleaned app fallback.
    const originUA = (this.originalUserAgent ??= wvSession.getUserAgent())
    const newUA = originUA.replace(/CherryStudio\/\S+\s/, '').replace(/Electron\/\S+\s/, '')

    if (!profile) {
      // Shared and service workers use the app fallback instead of the session UA.
      const previousFallback = app.userAgentFallback
      app.userAgentFallback = newUA
      this.registerDisposable(() => {
        if (app.userAgentFallback === newUA) app.userAgentFallback = previousFallback
      })
    }
    if (profile) wvSession.setUserAgent(newUA, profile.languages.join(','))
    else wvSession.setUserAgent(newUA)
    wvSession.webRequest.onBeforeSendHeaders((details, cb) => {
      const language = getAppLanguage()
      const hostname = new URL(details.url).hostname
      // Only sign-in needs the native identity; application APIs must match the page UA.
      const isGoogleSignIn = hostname === 'accounts.google.com'
      const headers = {
        ...details.requestHeaders,
        'User-Agent': isGoogleSignIn ? originUA : newUA,
        'Accept-Language': profile
          ? profile.languages
              .map((value, index) => (index ? `${value};q=${(1 - index * 0.1).toFixed(1)}` : value))
              .join(',')
          : `${language}, en;q=0.9, *;q=0.5`
      }
      cb({ requestHeaders: headers })
    })
    const cleanup = () => wvSession.webRequest.onBeforeSendHeaders(null)
    if (!profile) this.registerDisposable(cleanup)
    return cleanup
  }

  prepareRegionSession(appId: string, senderId: WindowId | null) {
    return this.regions.prepare(appId, senderId)
  }

  isPreparedRegionalPartition(partition: string | undefined, hostId?: number, src?: string): boolean {
    return this.regions.isPrepared(partition, hostId, src)
  }

  releaseRegionSession(leaseId: string, senderId: WindowId | null) {
    return this.regions.release(leaseId, senderId)
  }

  clearRegionData(appId: string, senderId: WindowId | null) {
    return this.regions.clearData(appId, senderId)
  }

  setRegionCountry(appId: string, country: MiniAppCountry | null, senderId: WindowId | null) {
    return this.regions.setCountry(appId, country, senderId)
  }

  removeSiteMiniApp(appId: string) {
    return this.regions.removeApp(appId)
  }

  async waitForRegion(webviewId: number, senderId: WindowId | null): Promise<void> {
    const guest = this.findOwnedSiteWebview(webviewId, senderId)
    const ready = guest && this.regionalGuests.get(guest)
    if (!ready) throw new Error('This webview has no regional profile')
    await ready
  }

  private initializeRegion(guest: Electron.WebContents): void {
    const regional = this.regionalSessions.get(guest.session)
    if (!regional || this.regionalGuests.has(guest)) return
    this.regions.trackGuest(guest)
    const browser = application.get('BrowserSessionService')
    const fail = () => {
      // Debugger promises can reject during native teardown, before destroyed is emitted.
      setImmediate(() => {
        if (guest.isDestroyed()) return
        guest.stop()
        void guest.loadURL('about:blank').catch(() => {})
        application.get('IpcApiService').broadcast('webview.region.failed', { webviewId: guest.id })
      })
    }
    const ready = browser
      .acquire(guest, 'mini-app-region', { ownership: 'borrowed' })
      .then((lease) => lease.emulateRegion(regional.profile, fail))
    this.regionalGuests.set(guest, ready)
    void ready.catch((error) => {
      logger.warn('Unable to initialize mini app regional profile', { error })
      fail()
    })
    guest.once('destroyed', () => {
      this.regionalGuests.delete(guest)
      browser.release(guest, 'mini-app-region')
    })
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
      event: Electron.Event,
      webPreferences: Electron.WebPreferences,
      params: { partition?: string; src?: string }
    ) => {
      // Local mini apps own a separate capability bridge and sandbox policy. Electron has
      // one preload slot, so writing here would silently replace that bridge.
      if (params.partition !== WEBVIEW_PARTITION) {
        if (!this.isPreparedRegionalPartition(params.partition, contents.id, params.src)) {
          if (/^persist:webview-(?:us|fake):/.test(params.partition ?? '')) event.preventDefault()
          return
        }
      }
      webPreferences.preload = preloadPath
      webPreferences.nodeIntegration = false
      webPreferences.nodeIntegrationInSubFrames = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
      webPreferences.webSecurity = true
      webPreferences.allowRunningInsecureContent = false
      const regional = params.partition && this.regionalSessions.get(session.fromPartition(params.partition))
      if (regional) {
        // Shared workers inherit the renderer language rather than page CDP overrides.
        webPreferences.additionalArguments = [
          ...(webPreferences.additionalArguments ?? []),
          `--lang=${regional.profile.locale}`
        ]
      }
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
    if (contents.isDestroyed()) return
    this.initializeRegion(contents)
    // Apply before the webview-only guard so popup windows on these sessions are covered too.
    if (
      contents.session === session.fromPartition(WEBVIEW_PARTITION) ||
      this.regionalSessions.has(contents.session) ||
      contents.session === session.fromPartition(getWebviewPartition(WebviewSecurityProfile.AgentBrowser))
    ) {
      contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
    }
    if (
      contents.getType?.() !== 'webview' ||
      (!isAnnotationCapableSession(contents.session) && !this.regionalSessions.has(contents.session))
    ) {
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

  private findOwnedGuest(webviewId: number, senderId: WindowId | null): Electron.WebContents | null {
    const guest = webContents.fromId(webviewId)
    if (!guest || guest.isDestroyed()) return null

    const hostWindow = senderId ? application.get('WindowManager').getWindow(senderId) : undefined

    if (!hostWindow || guest.getType?.() !== 'webview' || guest.hostWebContents !== hostWindow.webContents) {
      throw new Error('The caller does not own this webview')
    }

    return guest
  }

  private requireOwnedGuest(webviewId: number, senderId: WindowId | null) {
    const guest = this.findOwnedGuest(webviewId, senderId)
    if (!guest) throw new Error('The caller does not own this webview')
    return guest
  }

  private findOwnedSiteWebview(webviewId: number, senderId: WindowId | null): Electron.WebContents | null {
    const guest = this.findOwnedGuest(webviewId, senderId)
    if (!guest) return null
    if (guest.session !== session.fromPartition(WEBVIEW_PARTITION) && !this.regionalSessions.has(guest.session)) {
      throw new Error('The caller does not own this webview')
    }
    return guest
  }

  /** Annotation routes accept agent browser guests too; link policy stays site-only. */
  private requireOwnedAnnotationWebview(webviewId: number, senderId: WindowId | null) {
    const guest = this.findOwnedGuest(webviewId, senderId)
    if (!guest || (!isAnnotationCapableSession(guest.session) && !this.regionalSessions.has(guest.session))) {
      throw new Error('The caller does not own this webview')
    }
    return guest
  }

  async exportAnnotations(input: ExportAnnotationsInput, senderId: WindowId | null): Promise<string> {
    const guest = this.requireOwnedAnnotationWebview(input.webviewId, senderId)
    const annotationSession = this.annotationSessions.get(input.webviewId)
    if (!annotationSession?.isFor(guest)) throw new Error('Annotation document session is stale')

    return annotationSession.run(input.documentSessionId, async (signal) => {
      const markdown = await exportAnnotationDocument({
        guest,
        target: input.target,
        annotations: input.annotations,
        signal
      })
      if (this.requireOwnedAnnotationWebview(input.webviewId, senderId) !== guest) {
        throw new Error('The caller does not own this webview')
      }
      return markdown
    })
  }

  setSpellCheckerEnabled(webviewId: number, isEnable: boolean, senderId: WindowId | null): void {
    this.findOwnedGuest(webviewId, senderId)?.session.setSpellCheckerEnabled(isEnable)
  }

  setGuestVisible(webviewId: number, visible: boolean, senderId: WindowId | null): void {
    const guest = this.findOwnedGuest(webviewId, senderId)
    if (guest) this.hiddenGuests.setVisible(guest, visible)
  }

  setOpenLinkExternal(webviewId: number, isExternal: boolean, senderId: WindowId | null): void {
    const webview = this.findOwnedSiteWebview(webviewId, senderId)
    if (webview) configureOpenLinkExternal(webview, isExternal, this.regionalSessions.has(webview.session))
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
