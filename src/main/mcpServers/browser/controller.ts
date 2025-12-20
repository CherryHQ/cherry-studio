import { app, BrowserWindow, BrowserView } from 'electron'
import TurndownService from 'turndown'
import { randomUUID } from 'crypto'

import { logger, userAgent, type SessionInfo, type TabInfo } from './types'

const TAB_BAR_HEIGHT = 40 // Height for tab bar UI

/**
 * Controller for managing browser windows via Chrome DevTools Protocol (CDP).
 * Supports multiple sessions with multi-tab support using BrowserView, user data persistence, LRU eviction and idle timeout cleanup.
 */
export class CdpBrowserController {
  private sessions: Map<string, SessionInfo> = new Map()
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

  private touchSession(sessionId: string) {
    const session = this.sessions.get(sessionId)
    if (session) session.lastActive = Date.now()
  }

  private touchTab(sessionId: string, tabId: string) {
    const session = this.sessions.get(sessionId)
    if (session) {
      const tab = session.tabs.get(tabId)
      if (tab) tab.lastActive = Date.now()
      session.lastActive = Date.now()
    }
  }

  private closeTab(session: SessionInfo, tabId: string) {
    try {
      const tab = session.tabs.get(tabId)
      if (!tab) return

      if (!tab.view.webContents.isDestroyed()) {
        if (tab.view.webContents.debugger.isAttached()) {
          tab.view.webContents.debugger.detach()
        }
      }
      
      // Remove view from window
      if (!session.window.isDestroyed()) {
        session.window.removeBrowserView(tab.view)
      }
      
      // Destroy the view
      // @ts-expect-error - destroy exists but not in types
      if (tab.view.destroy) {
        // @ts-expect-error
        tab.view.destroy()
      }
    } catch (error) {
      logger.warn('Error closing tab', { error, sessionId: session.sessionId, tabId })
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
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActive > this.idleTimeoutMs) {
        for (const [tabId] of session.tabs.entries()) {
          this.closeTab(session, tabId)
        }
        if (!session.window.isDestroyed()) {
          session.window.close()
        }
        this.sessions.delete(sessionId)
      }
    }
  }

  private evictIfNeeded(newSessionId: string) {
    if (this.sessions.size < this.maxSessions) return
    let lruId: string | null = null
    let lruTime = Number.POSITIVE_INFINITY
    for (const [id, session] of this.sessions.entries()) {
      if (id === newSessionId) continue
      if (session.lastActive < lruTime) {
        lruTime = session.lastActive
        lruId = id
      }
    }
    if (lruId) {
      const session = this.sessions.get(lruId)
      if (session) {
        for (const [tabId] of session.tabs.entries()) {
          this.closeTab(session, tabId)
        }
        if (!session.window.isDestroyed()) {
          session.window.close()
        }
      }
      this.sessions.delete(lruId)
      logger.info('Evicted session to respect maxSessions', { evicted: lruId })
    }
  }

  private async createSessionWindow(sessionId: string): Promise<BrowserWindow> {
    await this.ensureAppReady()

    const win = new BrowserWindow({
      show: true, // Always show windows
      width: 1200,
      height: 800,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        devTools: true,
        partition: `persist:${sessionId}` // Enables user data persistence per session
      }
    })

    win.on('closed', () => {
      const session = this.sessions.get(sessionId)
      if (session) {
        for (const [tabId] of session.tabs.entries()) {
          this.closeTab(session, tabId)
        }
        this.sessions.delete(sessionId)
      }
    })

    return win
  }

  private async getOrCreateSession(sessionId: string): Promise<SessionInfo> {
    await this.ensureAppReady()
    this.sweepIdle()

    let session = this.sessions.get(sessionId)
    if (!session) {
      this.evictIfNeeded(sessionId)
      const window = await this.createSessionWindow(sessionId)
      session = {
        sessionId,
        window,
        tabs: new Map(),
        activeTabId: null,
        lastActive: Date.now()
      }
      this.sessions.set(sessionId, session)
      logger.info('Created new session', { sessionId })
    }

    this.touchSession(sessionId)
    return session
  }

  private updateViewBounds(session: SessionInfo) {
    if (session.window.isDestroyed()) return
    
    const [width, height] = session.window.getContentSize()
    const bounds = {
      x: 0,
      y: TAB_BAR_HEIGHT,
      width,
      height: height - TAB_BAR_HEIGHT
    }

    // Update active view bounds
    if (session.activeTabId) {
      const activeTab = session.tabs.get(session.activeTabId)
      if (activeTab && !activeTab.view.webContents.isDestroyed()) {
        activeTab.view.setBounds(bounds)
      }
    }
  }

  /**
   * Creates a new tab in the specified session
   * @param sessionId - Session identifier
   * @returns Tab ID and view
   */
  public async createTab(sessionId = 'default'): Promise<{ tabId: string; view: BrowserView }> {
    const session = await this.getOrCreateSession(sessionId)
    const tabId = randomUUID()
    
    const view = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        devTools: true,
        partition: `persist:${sessionId}`
      }
    })

    view.webContents.setUserAgent(userAgent)

    view.webContents.on('did-start-loading', () => logger.info(`did-start-loading`, { sessionId, tabId }))
    view.webContents.on('dom-ready', () => logger.info(`dom-ready`, { sessionId, tabId }))
    view.webContents.on('did-finish-load', () => logger.info(`did-finish-load`, { sessionId, tabId }))
    view.webContents.on('did-fail-load', (_e, code, desc) => logger.warn('Navigation failed', { code, desc }))

    view.webContents.on('destroyed', () => {
      session.tabs.delete(tabId)
      if (session.activeTabId === tabId) {
        session.activeTabId = session.tabs.keys().next().value ?? null
        if (session.activeTabId) {
          const newActiveTab = session.tabs.get(session.activeTabId)
          if (newActiveTab && !session.window.isDestroyed()) {
            session.window.setBrowserView(newActiveTab.view)
            this.updateViewBounds(session)
          }
        }
      }
    })

    const tabInfo: TabInfo = {
      id: tabId,
      view,
      url: '',
      title: '',
      lastActive: Date.now()
    }

    session.tabs.set(tabId, tabInfo)
    
    // Set as active tab and add to window
    if (!session.activeTabId || session.tabs.size === 1) {
      session.activeTabId = tabId
      session.window.setBrowserView(view)
      this.updateViewBounds(session)
      
      // Listen for window resize
      session.window.on('resize', () => this.updateViewBounds(session))
    }

    logger.info('Created new tab', { sessionId, tabId })
    return { tabId, view }
  }

  /**
   * Gets an existing tab or creates a new one
   */
  private async getTab(sessionId: string, tabId?: string): Promise<{ tabId: string; tab: TabInfo }> {
    const session = await this.getOrCreateSession(sessionId)

    if (tabId) {
      const tab = session.tabs.get(tabId)
      if (tab && !tab.view.webContents.isDestroyed()) {
        this.touchTab(sessionId, tabId)
        return { tabId, tab }
      }
    }

    // Use active tab or create new one
    if (session.activeTabId) {
      const activeTab = session.tabs.get(session.activeTabId)
      if (activeTab && !activeTab.view.webContents.isDestroyed()) {
        this.touchTab(sessionId, session.activeTabId)
        return { tabId: session.activeTabId, tab: activeTab }
      }
    }

    // Create new tab
    const { tabId: newTabId } = await this.createTab(sessionId)
    const tab = session.tabs.get(newTabId)!
    return { tabId: newTabId, tab }
  }

  /**
   * Opens a URL in a browser window and waits for navigation to complete.
   * @param url - The URL to navigate to
   * @param timeout - Navigation timeout in milliseconds (default: 10000)
   * @param sessionId - Session identifier for window reuse (default: 'default')
   * @param tabId - Optional tab ID. If not provided, uses active tab or creates new one
   * @returns Object containing the current URL, page title, and tab ID after navigation
   */
  public async open(url: string, timeout = 10000, sessionId = 'default', tabId?: string) {
    const { tabId: actualTabId, tab } = await this.getTab(sessionId, tabId)
    const view = tab.view
    
    logger.info('Loading URL', { url, sessionId, tabId: actualTabId })
    const { webContents } = view
    this.touchTab(sessionId, actualTabId)

    let resolved = false
    let onFinish: () => void
    let onDomReady: () => void
    let onFail: (_event: Electron.Event, code: number, desc: string) => void

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
      await Promise.race([view.webContents.loadURL(url), loadPromise, timeoutPromise])
    } finally {
      cleanup()
    }

    const currentUrl = webContents.getURL()
    const title = await webContents.getTitle()
    
    // Update tab info
    tab.url = currentUrl
    tab.title = title
    
    return { currentUrl, title, tabId: actualTabId }
  }

  public async execute(code: string, timeout = 5000, sessionId = 'default', tabId?: string) {
    const { tabId: actualTabId, tab } = await this.getTab(sessionId, tabId)
    this.touchTab(sessionId, actualTabId)
    const dbg = tab.view.webContents.debugger

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

  public async reset(sessionId?: string, tabId?: string) {
    if (sessionId && tabId) {
      const session = this.sessions.get(sessionId)
      if (session) {
        this.closeTab(session, tabId)
        session.tabs.delete(tabId)
        if (session.activeTabId === tabId) {
          session.activeTabId = session.tabs.keys().next().value ?? null
        }
      }
      logger.info('Browser CDP tab reset', { sessionId, tabId })
      return
    }

    if (sessionId) {
      const session = this.sessions.get(sessionId)
      if (session) {
        for (const [tid] of session.tabs.entries()) {
          this.closeTab(session, tid)
        }
        if (!session.window.isDestroyed()) {
          session.window.close()
        }
      }
      this.sessions.delete(sessionId)
      logger.info('Browser CDP session reset', { sessionId })
      return
    }

    for (const [sid, session] of this.sessions.entries()) {
      for (const [tid] of session.tabs.entries()) {
        this.closeTab(session, tid)
      }
      if (!session.window.isDestroyed()) {
        session.window.close()
      }
    }
    this.sessions.clear()
    logger.info('Browser CDP context reset (all sessions)')
  }

  /**
   * Fetches a URL and returns content in the specified format.
   * @param url - The URL to fetch
   * @param format - Output format: 'html', 'txt', 'markdown', or 'json' (default: 'markdown')
   * @param timeout - Navigation timeout in milliseconds (default: 10000)
   * @param sessionId - Session identifier (default: 'default')
   * @param tabId - Optional tab ID
   * @returns Content in the requested format. For 'json', returns parsed object or { data: rawContent } if parsing fails
   */
  public async fetch(
    url: string,
    format: 'html' | 'txt' | 'markdown' | 'json' = 'markdown',
    timeout = 10000,
    sessionId = 'default',
    tabId?: string
  ) {
    await this.open(url, timeout, sessionId, tabId)

    const { tab } = await this.getTab(sessionId, tabId)
    const dbg = tab.view.webContents.debugger

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
      try {
        return JSON.parse(content)
      } catch {
        return { data: content }
      }
    }
    return content
  }

  /**
   * Lists all tabs in a session
   */
  public async listTabs(sessionId = 'default'): Promise<Array<{ tabId: string; url: string; title: string }>> {
    const session = this.sessions.get(sessionId)
    if (!session) return []

    return Array.from(session.tabs.values()).map((tab) => ({
      tabId: tab.id,
      url: tab.url,
      title: tab.title
    }))
  }

  /**
   * Closes a specific tab
   */
  public async closeTab(sessionId: string, tabId: string) {
    await this.reset(sessionId, tabId)
  }

  /**
   * Switches the active tab
   */
  public async switchTab(sessionId: string, tabId: string) {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)

    const tab = session.tabs.get(tabId)
    if (!tab) throw new Error(`Tab ${tabId} not found in session ${sessionId}`)

    session.activeTabId = tabId
    
    // Update the displayed view
    if (!session.window.isDestroyed()) {
      session.window.setBrowserView(tab.view)
      this.updateViewBounds(session)
    }
    
    this.touchTab(sessionId, tabId)
    logger.info('Switched active tab', { sessionId, tabId })
  }
}
