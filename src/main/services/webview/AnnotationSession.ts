import { randomUUID } from 'node:crypto'

import { WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, type WebviewAnnotationHostCommand } from '@shared/types/webviewAnnotation'

const STALE_SESSION_MESSAGE = 'Annotation document session is stale'

export class AnnotationSession {
  private documentSessionId: string
  private ready = false
  private disposed = false
  private destroyedReported = false
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly webContents: Electron.WebContents,
    private readonly onDestroyed: () => void,
    private readonly createSessionId: () => string = randomUUID
  ) {
    this.documentSessionId = createSessionId()
    webContents.on('did-start-navigation', this.handleNavigation)
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
    if (this.disposed || this.ready || this.webContents.isDestroyed()) return
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

  run<T>(documentSessionId: string, task: () => Promise<T>): Promise<T> {
    if (!this.isCurrent(documentSessionId)) return Promise.reject(new Error(STALE_SESSION_MESSAGE))

    const result = this.queue
      .catch(() => undefined)
      .then(async () => {
        this.assertCurrent(documentSessionId)
        const value = await task()
        this.assertCurrent(documentSessionId)
        return value
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
    this.webContents.removeListener('did-start-navigation', this.handleNavigation)
    this.webContents.removeListener('render-process-gone', this.handleRenderProcessGone)
    this.webContents.removeListener('dom-ready', this.handleDomReady)
    this.webContents.removeListener('destroyed', this.handleDestroyed)
  }

  private assertCurrent(documentSessionId: string) {
    if (!this.isCurrent(documentSessionId)) throw new Error(STALE_SESSION_MESSAGE)
  }

  private rotate() {
    this.documentSessionId = this.createSessionId()
    this.ready = false
  }

  private handleNavigation = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
    if (details.isMainFrame && !details.isSameDocument) this.rotate()
  }

  private handleRenderProcessGone = () => {
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
