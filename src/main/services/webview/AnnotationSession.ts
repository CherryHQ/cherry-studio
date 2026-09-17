import { randomUUID } from 'node:crypto'

import { WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, type WebviewAnnotationHostCommand } from '@shared/types/webviewAnnotation'

const STALE_SESSION_MESSAGE = 'Annotation document session is stale'

export class AnnotationSession {
  private documentSessionId: string
  private ready = false
  private disposed = false
  private destroyedReported = false
  private provisionalUrl: string | null = null
  private resumeReady = false
  private taskController = new AbortController()
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly webContents: Electron.WebContents,
    private readonly onDestroyed: () => void,
    private readonly createSessionId: () => string = randomUUID
  ) {
    this.documentSessionId = createSessionId()
    webContents.on('did-start-navigation', this.handleNavigation)
    webContents.on('did-redirect-navigation', this.handleRedirect)
    webContents.on('did-navigate', this.handleDidNavigate)
    webContents.on('did-fail-load', this.handleDidFailLoad)
    webContents.on('render-process-gone', this.handleRenderProcessGone)
    webContents.on('dom-ready', this.handleDomReady)
    webContents.on('destroyed', this.handleDestroyed)
  }

  isCurrent(documentSessionId: string): boolean {
    return (
      !this.disposed && this.ready && !this.webContents.isDestroyed() && documentSessionId === this.documentSessionId
    )
  }

  isFor(webContents: Electron.WebContents): boolean {
    return this.webContents === webContents
  }

  announce() {
    if (this.disposed || this.ready || this.provisionalUrl || this.webContents.isDestroyed()) return
    const command: WebviewAnnotationHostCommand = {
      type: 'start_session',
      sessionId: this.documentSessionId
    }
    try {
      this.webContents.send(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, command)
      this.ready = true
    } catch {
      this.ready = false
    }
  }

  run<T>(documentSessionId: string, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (!this.isCurrent(documentSessionId)) return Promise.reject(new Error(STALE_SESSION_MESSAGE))
    const taskController = this.taskController

    const result = this.queue
      .catch(() => undefined)
      .then(async () => {
        this.assertCurrent(documentSessionId, taskController)
        try {
          const value = await task(taskController.signal)
          this.assertCurrent(documentSessionId, taskController)
          return value
        } catch (error) {
          this.assertCurrent(documentSessionId, taskController)
          throw error
        }
      })
    this.queue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.ready = false
    this.taskController.abort()
    this.webContents.removeListener('did-start-navigation', this.handleNavigation)
    this.webContents.removeListener('did-redirect-navigation', this.handleRedirect)
    this.webContents.removeListener('did-navigate', this.handleDidNavigate)
    this.webContents.removeListener('did-fail-load', this.handleDidFailLoad)
    this.webContents.removeListener('render-process-gone', this.handleRenderProcessGone)
    this.webContents.removeListener('dom-ready', this.handleDomReady)
    this.webContents.removeListener('destroyed', this.handleDestroyed)
  }

  waitForIdle(): Promise<void> {
    return this.queue
  }

  private assertCurrent(documentSessionId: string, taskController?: AbortController) {
    if (!this.isCurrent(documentSessionId) || (taskController && taskController !== this.taskController)) {
      throw new Error(STALE_SESSION_MESSAGE)
    }
  }

  private rotate() {
    this.taskController.abort()
    this.taskController = new AbortController()
    this.documentSessionId = this.createSessionId()
    this.ready = false
  }

  private handleNavigation = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
    if (!details.isMainFrame || details.isSameDocument) return
    if (!this.provisionalUrl) this.resumeReady = this.ready
    this.provisionalUrl = details.url
    this.ready = false
    this.taskController.abort()
  }

  private handleRedirect = (details: Electron.Event<Electron.WebContentsDidRedirectNavigationEventParams>) => {
    if (this.provisionalUrl && details.isMainFrame && !details.isSameDocument) {
      this.provisionalUrl = details.url
    }
  }

  private handleDidNavigate = (_event: Electron.Event, url: string) => {
    if (!this.provisionalUrl || url !== this.provisionalUrl) return
    this.provisionalUrl = null
    this.resumeReady = false
    this.rotate()
  }

  private handleDidFailLoad = (
    _event: Electron.Event,
    _errorCode: number,
    _errorDescription: string,
    validatedUrl: string,
    isMainFrame: boolean
  ) => {
    if (!isMainFrame || !this.provisionalUrl || validatedUrl !== this.provisionalUrl) return
    this.provisionalUrl = null
    this.taskController = new AbortController()
    this.ready = this.resumeReady && !this.disposed && !this.webContents.isDestroyed()
    this.resumeReady = false
  }

  private handleRenderProcessGone = () => {
    this.provisionalUrl = null
    this.resumeReady = false
    this.rotate()
  }

  private handleDomReady = () => {
    this.announce()
  }

  private handleDestroyed = () => {
    if (this.destroyedReported) return
    this.destroyedReported = true
    this.dispose()
    this.onDestroyed()
  }
}
