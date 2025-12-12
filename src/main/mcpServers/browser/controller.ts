import { app, BrowserWindow } from 'electron'
import TurndownService from 'turndown'

import { logger, userAgent } from './types'

/**
 * Controller for managing browser windows via Chrome DevTools Protocol (CDP).
 * Supports multiple sessions with LRU eviction and idle timeout cleanup.
 */
export class CdpBrowserController {
  private windows: Map<string, { win: BrowserWindow; lastActive: number }> = new Map()
  private readonly maxSessions: number
  private readonly idleTimeoutMs: number

  constructor(options?: { maxSessions?: number; idleTimeoutMs?: number }) {
    this.maxSessions = options?.maxSessions ?? 5
    this.idleTimeoutMs = options?.idleTimeoutMs ?? 5 * 60 * 1000
  }

  private async ensureAppReady() {
    if (!app.isReady()) {
      await app.whenReady()
    }
  }

  private touch(sessionId: string) {
    const entry = this.windows.get(sessionId)
    if (entry) entry.lastActive = Date.now()
  }

  private closeWindow(win: BrowserWindow, sessionId: string) {
    try {
      if (!win.isDestroyed()) {
        if (win.webContents.debugger.isAttached()) {
          win.webContents.debugger.detach()
        }
        win.close()
      }
    } catch (error) {
      logger.warn('Error closing window', { error, sessionId })
    }
  }

  private async ensureDebuggerAttached(dbg: Electron.Debugger, sessionId: string) {
    if (!dbg.isAttached()) {
      try {
        logger.info('Attaching debugger', { sessionId })
        dbg.attach('1.3')
        await dbg.sendCommand('Page.enable')
        await dbg.sendCommand('Runtime.enable')
        logger.info('Debugger attached and domains enabled')
      } catch (error) {
        logger.error('Failed to attach debugger', { error })
        throw error
      }
    }
  }

  private sweepIdle() {
    const now = Date.now()
    for (const [id, entry] of this.windows.entries()) {
      if (now - entry.lastActive > this.idleTimeoutMs) {
        this.closeWindow(entry.win, id)
        this.windows.delete(id)
      }
    }
  }

  private evictIfNeeded(newSessionId: string) {
    if (this.windows.size < this.maxSessions) return
    let lruId: string | null = null
    let lruTime = Number.POSITIVE_INFINITY
    for (const [id, entry] of this.windows.entries()) {
      if (id === newSessionId) continue
      if (entry.lastActive < lruTime) {
        lruTime = entry.lastActive
        lruId = id
      }
    }
    if (lruId) {
      const entry = this.windows.get(lruId)
      if (entry) {
        this.closeWindow(entry.win, lruId)
      }
      this.windows.delete(lruId)
      logger.info('Evicted session to respect maxSessions', { evicted: lruId })
    }
  }

  private async getWindow(sessionId = 'default', forceNew = false, show = false): Promise<BrowserWindow> {
    await this.ensureAppReady()

    this.sweepIdle()

    const existing = this.windows.get(sessionId)
    if (existing && !existing.win.isDestroyed() && !forceNew) {
      this.touch(sessionId)
      return existing.win
    }

    if (existing && !existing.win.isDestroyed() && forceNew) {
      try {
        if (existing.win.webContents.debugger.isAttached()) {
          existing.win.webContents.debugger.detach()
        }
      } catch (error) {
        logger.warn('Error detaching debugger before recreate', { error, sessionId })
      }
      existing.win.destroy()
      this.windows.delete(sessionId)
    }

    this.evictIfNeeded(sessionId)

    const win = new BrowserWindow({
      show,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        devTools: true
      }
    })

    // Use a standard Chrome UA to avoid some anti-bot blocks
    win.webContents.setUserAgent(userAgent)

    // Log navigation lifecycle to help diagnose slow loads
    win.webContents.on('did-start-loading', () => logger.info(`did-start-loading`, { sessionId }))
    win.webContents.on('dom-ready', () => logger.info(`dom-ready`, { sessionId }))
    win.webContents.on('did-finish-load', () => logger.info(`did-finish-load`, { sessionId }))
    win.webContents.on('did-fail-load', (_e, code, desc) => logger.warn('Navigation failed', { code, desc }))

    win.on('closed', () => {
      this.windows.delete(sessionId)
    })

    this.windows.set(sessionId, { win, lastActive: Date.now() })
    return win
  }

  /**
   * Opens a URL in a browser window and waits for navigation to complete.
   * @param url - The URL to navigate to
   * @param timeout - Navigation timeout in milliseconds (default: 10000)
   * @param show - Whether to show the browser window (default: false)
   * @param sessionId - Session identifier for window reuse (default: 'default')
   * @returns Object containing the current URL and page title after navigation
   */
  public async open(url: string, timeout = 10000, show = false, sessionId = 'default') {
    const win = await this.getWindow(sessionId, true, show)
    logger.info('Loading URL', { url, sessionId })
    const { webContents } = win
    this.touch(sessionId)

    // Track resolution state to prevent multiple handlers from firing
    let resolved = false
    let onFinish: () => void
    let onDomReady: () => void
    let onFail: (_event: Electron.Event, code: number, desc: string) => void

    // Define cleanup outside Promise to ensure it's callable in finally block,
    // preventing memory leaks when timeout occurs before navigation completes
    const cleanup = () => {
      webContents.removeListener('did-finish-load', onFinish)
      webContents.removeListener('did-fail-load', onFail)
      webContents.removeListener('dom-ready', onDomReady)
    }

    const loadPromise = new Promise<void>((resolve, reject) => {
      onFinish = () => {
        if (resolved) return
        resolved = true
        cleanup()
        resolve()
      }
      onDomReady = () => {
        if (resolved) return
        resolved = true
        cleanup()
        resolve()
      }
      onFail = (_event: Electron.Event, code: number, desc: string) => {
        if (resolved) return
        resolved = true
        cleanup()
        reject(new Error(`Navigation failed (${code}): ${desc}`))
      }
      webContents.once('did-finish-load', onFinish)
      webContents.once('dom-ready', onDomReady)
      webContents.once('did-fail-load', onFail)
    })

    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('Navigation timed out')), timeout)
    })

    try {
      await Promise.race([win.loadURL(url), loadPromise, timeoutPromise])
    } finally {
      // Always cleanup listeners to prevent memory leaks on timeout
      cleanup()
    }

    const currentUrl = webContents.getURL()
    const title = await webContents.getTitle()
    return { currentUrl, title }
  }

  public async execute(code: string, timeout = 5000, sessionId = 'default') {
    const win = await this.getWindow(sessionId)
    this.touch(sessionId)
    const dbg = win.webContents.debugger

    await this.ensureDebuggerAttached(dbg, sessionId)

    const evalPromise = dbg.sendCommand('Runtime.evaluate', {
      expression: code,
      awaitPromise: true,
      returnByValue: true
    })

    const result = await Promise.race([
      evalPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Execution timed out')), timeout))
    ])

    const evalResult = result as any

    if (evalResult?.exceptionDetails) {
      const message = evalResult.exceptionDetails.exception?.description || 'Unknown script error'
      logger.warn('Runtime.evaluate raised exception', { message })
      throw new Error(message)
    }

    const value = evalResult?.result?.value ?? evalResult?.result?.description ?? null
    return value
  }

  public async reset(sessionId?: string) {
    if (sessionId) {
      const entry = this.windows.get(sessionId)
      if (entry) {
        this.closeWindow(entry.win, sessionId)
      }
      this.windows.delete(sessionId)
      logger.info('Browser CDP context reset', { sessionId })
      return
    }

    for (const [id, entry] of this.windows.entries()) {
      this.closeWindow(entry.win, id)
      this.windows.delete(id)
    }
    logger.info('Browser CDP context reset (all sessions)')
  }

  /**
   * Fetches a URL and returns content in the specified format.
   * @param url - The URL to fetch
   * @param format - Output format: 'html', 'txt', 'markdown', or 'json' (default: 'markdown')
   * @param timeout - Navigation timeout in milliseconds (default: 10000)
   * @param sessionId - Session identifier (default: 'default')
   * @returns Content in the requested format. For 'json', returns parsed object or { data: rawContent } if parsing fails
   */
  public async fetch(
    url: string,
    format: 'html' | 'txt' | 'markdown' | 'json' = 'markdown',
    timeout = 10000,
    sessionId = 'default'
  ) {
    await this.open(url, timeout, false, sessionId)

    const win = await this.getWindow(sessionId)
    const dbg = win.webContents.debugger

    await this.ensureDebuggerAttached(dbg, sessionId)

    let expression: string
    if (format === 'json' || format === 'txt') {
      expression = 'document.body.innerText'
    } else {
      expression = 'document.documentElement.outerHTML'
    }

    const result = (await dbg.sendCommand('Runtime.evaluate', {
      expression,
      returnByValue: true
    })) as { result?: { value?: string } }

    const content = result?.result?.value ?? ''

    if (format === 'markdown') {
      const turndownService = new TurndownService()
      return turndownService.turndown(content)
    }
    if (format === 'json') {
      // Attempt to parse as JSON; if content is not valid JSON, wrap it in a data object
      try {
        return JSON.parse(content)
      } catch {
        return { data: content }
      }
    }
    return content
  }
}
