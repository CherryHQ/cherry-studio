import { randomUUID } from 'crypto'
import { app, BrowserView, BrowserWindow } from 'electron'
import TurndownService from 'turndown'

import { logger, type SessionInfo, type TabInfo, userAgent } from './types'

const TAB_BAR_HEIGHT = 40 // Height for tab bar UI
const SESSION_KEY_DEFAULT = 'default'
const SESSION_KEY_PRIVATE = 'private'

/**
 * Controller for managing browser windows via Chrome DevTools Protocol (CDP).
 * Supports two modes: normal (persistent) and private (ephemeral).
 * Normal mode persists user data (cookies, localStorage, etc.).
 * Private mode is ephemeral - data is cleared when the session closes.
 */
export class CdpBrowserController {
  private sessions: Map<string, SessionInfo> = new Map()
  private readonly maxSessions: number
  private readonly idleTimeoutMs: number

  constructor(options?: { maxSessions?: number; idleTimeoutMs?: number }) {
    this.maxSessions = options?.maxSessions ?? 5
    this.idleTimeoutMs = options?.idleTimeoutMs ?? 5 * 60 * 1000
  }

  private getSessionKey(privateMode: boolean): string {
    return privateMode ? SESSION_KEY_PRIVATE : SESSION_KEY_DEFAULT
  }

  private getPartition(privateMode: boolean): string {
    return privateMode ? SESSION_KEY_PRIVATE : `persist:${SESSION_KEY_DEFAULT}`
  }

  private async ensureAppReady() {
    if (!app.isReady()) {
      await app.whenReady()
    }
  }

  private touchSession(sessionKey: string) {
    const session = this.sessions.get(sessionKey)
    if (session) session.lastActive = Date.now()
  }

  private touchTab(sessionKey: string, tabId: string) {
    const session = this.sessions.get(sessionKey)
    if (session) {
      const tab = session.tabs.get(tabId)
      if (tab) tab.lastActive = Date.now()
      session.lastActive = Date.now()
    }
  }

  private closeTabInternal(session: SessionInfo, tabId: string) {
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
      logger.warn('Error closing tab', { error, sessionKey: session.sessionKey, tabId })
    }
  }

  private async ensureDebuggerAttached(dbg: Electron.Debugger, sessionKey: string) {
    if (!dbg.isAttached()) {
      try {
        logger.info('Attaching debugger', { sessionKey })
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
    for (const [sessionKey, session] of this.sessions.entries()) {
      if (now - session.lastActive > this.idleTimeoutMs) {
        for (const [tabId] of session.tabs.entries()) {
          this.closeTabInternal(session, tabId)
        }
        if (!session.window.isDestroyed()) {
          session.window.close()
        }
        this.sessions.delete(sessionKey)
      }
    }
  }

  private evictIfNeeded(newSessionKey: string) {
    if (this.sessions.size < this.maxSessions) return
    let lruKey: string | null = null
    let lruTime = Number.POSITIVE_INFINITY
    for (const [key, session] of this.sessions.entries()) {
      if (key === newSessionKey) continue
      if (session.lastActive < lruTime) {
        lruTime = session.lastActive
        lruKey = key
      }
    }
    if (lruKey) {
      const session = this.sessions.get(lruKey)
      if (session) {
        for (const [tabId] of session.tabs.entries()) {
          this.closeTabInternal(session, tabId)
        }
        if (!session.window.isDestroyed()) {
          session.window.close()
        }
      }
      this.sessions.delete(lruKey)
      logger.info('Evicted session to respect maxSessions', { evicted: lruKey })
    }
  }

  private async createSessionWindow(sessionKey: string, privateMode: boolean): Promise<BrowserWindow> {
    await this.ensureAppReady()

    const partition = this.getPartition(privateMode)

    const win = new BrowserWindow({
      show: true, // Always show windows
      width: 1200,
      height: 800,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        devTools: true,
        partition
      }
    })

    win.on('closed', () => {
      const session = this.sessions.get(sessionKey)
      if (session) {
        for (const [tabId] of session.tabs.entries()) {
          this.closeTabInternal(session, tabId)
        }
        this.sessions.delete(sessionKey)
      }
    })

    return win
  }

  private async getOrCreateSession(privateMode: boolean): Promise<SessionInfo> {
    await this.ensureAppReady()
    this.sweepIdle()

    const sessionKey = this.getSessionKey(privateMode)

    let session = this.sessions.get(sessionKey)
    if (!session) {
      this.evictIfNeeded(sessionKey)
      const window = await this.createSessionWindow(sessionKey, privateMode)
      session = {
        sessionKey,
        privateMode,
        window,
        tabs: new Map(),
        activeTabId: null,
        lastActive: Date.now()
      }
      this.sessions.set(sessionKey, session)
      logger.info('Created new session', { sessionKey, privateMode })
    }

    this.touchSession(sessionKey)
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
   * Creates a new tab in the session
   * @param privateMode - If true, uses private browsing mode (default: false)
   * @returns Tab ID and view
   */
  public async createTab(privateMode = false): Promise<{ tabId: string; view: BrowserView }> {
    const session = await this.getOrCreateSession(privateMode)
    const tabId = randomUUID()
    const partition = this.getPartition(privateMode)

    const view = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        devTools: true,
        partition
      }
    })

    view.webContents.setUserAgent(userAgent)

    const sessionKey = session.sessionKey
    view.webContents.on('did-start-loading', () => logger.info(`did-start-loading`, { sessionKey, tabId }))
    view.webContents.on('dom-ready', () => logger.info(`dom-ready`, { sessionKey, tabId }))
    view.webContents.on('did-finish-load', () => logger.info(`did-finish-load`, { sessionKey, tabId }))
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

    logger.info('Created new tab', { sessionKey, tabId, privateMode })
    return { tabId, view }
  }

  /**
   * Gets an existing tab or creates a new one
   * @param privateMode - Whether to use private browsing mode
   * @param tabId - Optional specific tab ID to use
   * @param newTab - If true, always create a new tab (useful for parallel requests)
   */
  private async getTab(
    privateMode: boolean,
    tabId?: string,
    newTab?: boolean
  ): Promise<{ tabId: string; tab: TabInfo }> {
    const session = await this.getOrCreateSession(privateMode)

    // If newTab is requested, create a fresh tab
    if (newTab) {
      const { tabId: freshTabId } = await this.createTab(privateMode)
      const tab = session.tabs.get(freshTabId)!
      return { tabId: freshTabId, tab }
    }

    if (tabId) {
      const tab = session.tabs.get(tabId)
      if (tab && !tab.view.webContents.isDestroyed()) {
        this.touchTab(session.sessionKey, tabId)
        return { tabId, tab }
      }
    }

    // Use active tab or create new one
    if (session.activeTabId) {
      const activeTab = session.tabs.get(session.activeTabId)
      if (activeTab && !activeTab.view.webContents.isDestroyed()) {
        this.touchTab(session.sessionKey, session.activeTabId)
        return { tabId: session.activeTabId, tab: activeTab }
      }
    }

    // Create new tab
    const { tabId: newTabId } = await this.createTab(privateMode)
    const tab = session.tabs.get(newTabId)!
    return { tabId: newTabId, tab }
  }

  /**
   * Opens a URL in a browser window and waits for navigation to complete.
   * @param url - The URL to navigate to
   * @param timeout - Navigation timeout in milliseconds (default: 10000)
   * @param privateMode - If true, uses private browsing mode (default: false)
   * @param newTab - If true, always creates a new tab (useful for parallel requests)
   * @returns Object containing the current URL, page title, and tab ID after navigation
   */
  public async open(url: string, timeout = 10000, privateMode = false, newTab = false) {
    const { tabId: actualTabId, tab } = await this.getTab(privateMode, undefined, newTab)
    const view = tab.view
    const sessionKey = this.getSessionKey(privateMode)

    logger.info('Loading URL', { url, sessionKey, tabId: actualTabId, privateMode })
    const { webContents } = view
    this.touchTab(sessionKey, actualTabId)

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

  public async execute(code: string, timeout = 5000, privateMode = false, tabId?: string) {
    const { tabId: actualTabId, tab } = await this.getTab(privateMode, tabId)
    const sessionKey = this.getSessionKey(privateMode)
    this.touchTab(sessionKey, actualTabId)
    const dbg = tab.view.webContents.debugger

    await this.ensureDebuggerAttached(dbg, sessionKey)

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

  public async reset(privateMode?: boolean, tabId?: string) {
    if (privateMode !== undefined && tabId) {
      const sessionKey = this.getSessionKey(privateMode)
      const session = this.sessions.get(sessionKey)
      if (session) {
        this.closeTabInternal(session, tabId)
        session.tabs.delete(tabId)
        if (session.activeTabId === tabId) {
          session.activeTabId = session.tabs.keys().next().value ?? null
        }
      }
      logger.info('Browser CDP tab reset', { sessionKey, tabId })
      return
    }

    if (privateMode !== undefined) {
      const sessionKey = this.getSessionKey(privateMode)
      const session = this.sessions.get(sessionKey)
      if (session) {
        for (const [tid] of session.tabs.entries()) {
          this.closeTabInternal(session, tid)
        }
        if (!session.window.isDestroyed()) {
          session.window.close()
        }
      }
      this.sessions.delete(sessionKey)
      logger.info('Browser CDP session reset', { sessionKey, privateMode })
      return
    }

    for (const [, session] of this.sessions.entries()) {
      for (const [tid] of session.tabs.entries()) {
        this.closeTabInternal(session, tid)
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
   * @param privateMode - If true, uses private browsing mode (default: false)
   * @param newTab - If true, always creates a new tab (useful for parallel requests)
   * @returns Content in the requested format. For 'json', returns parsed object or { data: rawContent } if parsing fails
   */
  public async fetch(
    url: string,
    format: 'html' | 'txt' | 'markdown' | 'json' = 'markdown',
    timeout = 10000,
    privateMode = false,
    newTab = false
  ) {
    const { tabId } = await this.open(url, timeout, privateMode, newTab)

    const { tab } = await this.getTab(privateMode, tabId)
    const dbg = tab.view.webContents.debugger
    const sessionKey = this.getSessionKey(privateMode)

    await this.ensureDebuggerAttached(dbg, sessionKey)

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
   * @param privateMode - If true, lists tabs from private session (default: false)
   */
  public async listTabs(privateMode = false): Promise<Array<{ tabId: string; url: string; title: string }>> {
    const sessionKey = this.getSessionKey(privateMode)
    const session = this.sessions.get(sessionKey)
    if (!session) return []

    return Array.from(session.tabs.values()).map((tab) => ({
      tabId: tab.id,
      url: tab.url,
      title: tab.title
    }))
  }

  /**
   * Closes a specific tab
   * @param privateMode - If true, closes tab from private session (default: false)
   * @param tabId - Tab identifier to close
   */
  public async closeTab(privateMode: boolean, tabId: string) {
    await this.reset(privateMode, tabId)
  }

  /**
   * Switches the active tab
   * @param privateMode - If true, switches tab in private session (default: false)
   * @param tabId - Tab identifier to switch to
   */
  public async switchTab(privateMode: boolean, tabId: string) {
    const sessionKey = this.getSessionKey(privateMode)
    const session = this.sessions.get(sessionKey)
    if (!session) throw new Error(`Session not found for ${privateMode ? 'private' : 'normal'} mode`)

    const tab = session.tabs.get(tabId)
    if (!tab) throw new Error(`Tab ${tabId} not found`)

    session.activeTabId = tabId

    // Update the displayed view
    if (!session.window.isDestroyed()) {
      session.window.setBrowserView(tab.view)
      this.updateViewBounds(session)
    }

    this.touchTab(sessionKey, tabId)
    logger.info('Switched active tab', { sessionKey, tabId, privateMode })
  }
}
