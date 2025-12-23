import { randomUUID } from 'crypto'
import { app, BrowserView, BrowserWindow } from 'electron'
import TurndownService from 'turndown'

import { logger, type TabInfo, userAgent,type WindowInfo } from './types'

const TAB_BAR_HEIGHT = 40 // Height for tab bar UI
const SESSION_KEY_DEFAULT = 'default'
const SESSION_KEY_PRIVATE = 'private'

/**
 * Controller for managing browser windows via Chrome DevTools Protocol (CDP).
 * Supports two modes: normal (persistent) and private (ephemeral).
 * Normal mode persists user data (cookies, localStorage, etc.) globally across all clients.
 * Private mode is ephemeral - data is cleared when the window closes.
 */
export class CdpBrowserController {
  private windows: Map<string, WindowInfo> = new Map()
  private readonly maxWindows: number
  private readonly idleTimeoutMs: number
  private readonly turndownService: TurndownService

  constructor(options?: { maxWindows?: number; idleTimeoutMs?: number }) {
    this.maxWindows = options?.maxWindows ?? 5
    this.idleTimeoutMs = options?.idleTimeoutMs ?? 5 * 60 * 1000
    this.turndownService = new TurndownService()
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

  private touchWindow(windowKey: string) {
    const windowInfo = this.windows.get(windowKey)
    if (windowInfo) windowInfo.lastActive = Date.now()
  }

  private touchTab(windowKey: string, tabId: string) {
    const windowInfo = this.windows.get(windowKey)
    if (windowInfo) {
      const tab = windowInfo.tabs.get(tabId)
      if (tab) tab.lastActive = Date.now()
      windowInfo.lastActive = Date.now()
    }
  }

  private closeTabInternal(windowInfo: WindowInfo, tabId: string) {
    try {
      const tab = windowInfo.tabs.get(tabId)
      if (!tab) return

      if (!tab.view.webContents.isDestroyed()) {
        if (tab.view.webContents.debugger.isAttached()) {
          tab.view.webContents.debugger.detach()
        }
      }

      // Remove view from window
      if (!windowInfo.window.isDestroyed()) {
        windowInfo.window.removeBrowserView(tab.view)
      }

      // Destroy the view using safe cast
      const viewWithDestroy = tab.view as BrowserView & { destroy?: () => void }
      if (viewWithDestroy.destroy) {
        viewWithDestroy.destroy()
      }
    } catch (error) {
      logger.warn('Error closing tab', { error, windowKey: windowInfo.windowKey, tabId })
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
    for (const [windowKey, windowInfo] of this.windows.entries()) {
      if (now - windowInfo.lastActive > this.idleTimeoutMs) {
        for (const [tabId] of windowInfo.tabs.entries()) {
          this.closeTabInternal(windowInfo, tabId)
        }
        if (!windowInfo.window.isDestroyed()) {
          windowInfo.window.close()
        }
        this.windows.delete(windowKey)
      }
    }
  }

  private evictIfNeeded(newWindowKey: string) {
    if (this.windows.size < this.maxWindows) return
    let lruKey: string | null = null
    let lruTime = Number.POSITIVE_INFINITY
    for (const [key, windowInfo] of this.windows.entries()) {
      if (key === newWindowKey) continue
      if (windowInfo.lastActive < lruTime) {
        lruTime = windowInfo.lastActive
        lruKey = key
      }
    }
    if (lruKey) {
      const windowInfo = this.windows.get(lruKey)
      if (windowInfo) {
        for (const [tabId] of windowInfo.tabs.entries()) {
          this.closeTabInternal(windowInfo, tabId)
        }
        if (!windowInfo.window.isDestroyed()) {
          windowInfo.window.close()
        }
      }
      this.windows.delete(lruKey)
      logger.info('Evicted window to respect maxWindows', { evicted: lruKey })
    }
  }

  private async createBrowserWindow(windowKey: string, privateMode: boolean): Promise<BrowserWindow> {
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
      const windowInfo = this.windows.get(windowKey)
      if (windowInfo) {
        for (const [tabId] of windowInfo.tabs.entries()) {
          this.closeTabInternal(windowInfo, tabId)
        }
        this.windows.delete(windowKey)
      }
    })

    return win
  }

  private async getOrCreateWindow(privateMode: boolean): Promise<WindowInfo> {
    await this.ensureAppReady()
    this.sweepIdle()

    const windowKey = this.getSessionKey(privateMode)

    let windowInfo = this.windows.get(windowKey)
    if (!windowInfo) {
      this.evictIfNeeded(windowKey)
      const window = await this.createBrowserWindow(windowKey, privateMode)
      windowInfo = {
        windowKey,
        privateMode,
        window,
        tabs: new Map(),
        activeTabId: null,
        lastActive: Date.now()
      }
      this.windows.set(windowKey, windowInfo)
      logger.info('Created new window', { windowKey, privateMode })
    }

    this.touchWindow(windowKey)
    return windowInfo
  }

  private updateViewBounds(windowInfo: WindowInfo) {
    if (windowInfo.window.isDestroyed()) return

    const [width, height] = windowInfo.window.getContentSize()
    const bounds = {
      x: 0,
      y: TAB_BAR_HEIGHT,
      width,
      height: height - TAB_BAR_HEIGHT
    }

    // Update active view bounds
    if (windowInfo.activeTabId) {
      const activeTab = windowInfo.tabs.get(windowInfo.activeTabId)
      if (activeTab && !activeTab.view.webContents.isDestroyed()) {
        activeTab.view.setBounds(bounds)
      }
    }
  }

  /**
   * Creates a new tab in the window
   * @param privateMode - If true, uses private browsing mode (default: false)
   * @returns Tab ID and view
   */
  public async createTab(privateMode = false): Promise<{ tabId: string; view: BrowserView }> {
    const windowInfo = await this.getOrCreateWindow(privateMode)
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

    const windowKey = windowInfo.windowKey
    view.webContents.on('did-start-loading', () => logger.info(`did-start-loading`, { windowKey, tabId }))
    view.webContents.on('dom-ready', () => logger.info(`dom-ready`, { windowKey, tabId }))
    view.webContents.on('did-finish-load', () => logger.info(`did-finish-load`, { windowKey, tabId }))
    view.webContents.on('did-fail-load', (_e, code, desc) => logger.warn('Navigation failed', { code, desc }))

    view.webContents.on('destroyed', () => {
      windowInfo.tabs.delete(tabId)
      if (windowInfo.activeTabId === tabId) {
        windowInfo.activeTabId = windowInfo.tabs.keys().next().value ?? null
        if (windowInfo.activeTabId) {
          const newActiveTab = windowInfo.tabs.get(windowInfo.activeTabId)
          if (newActiveTab && !windowInfo.window.isDestroyed()) {
            windowInfo.window.setBrowserView(newActiveTab.view)
            this.updateViewBounds(windowInfo)
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

    windowInfo.tabs.set(tabId, tabInfo)

    // Set as active tab and add to window
    if (!windowInfo.activeTabId || windowInfo.tabs.size === 1) {
      windowInfo.activeTabId = tabId
      windowInfo.window.setBrowserView(view)
      this.updateViewBounds(windowInfo)

      // Listen for window resize
      windowInfo.window.on('resize', () => this.updateViewBounds(windowInfo))
    }

    logger.info('Created new tab', { windowKey, tabId, privateMode })
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
    const windowInfo = await this.getOrCreateWindow(privateMode)

    // If newTab is requested, create a fresh tab
    if (newTab) {
      const { tabId: freshTabId } = await this.createTab(privateMode)
      const tab = windowInfo.tabs.get(freshTabId)!
      return { tabId: freshTabId, tab }
    }

    if (tabId) {
      const tab = windowInfo.tabs.get(tabId)
      if (tab && !tab.view.webContents.isDestroyed()) {
        this.touchTab(windowInfo.windowKey, tabId)
        return { tabId, tab }
      }
    }

    // Use active tab or create new one
    if (windowInfo.activeTabId) {
      const activeTab = windowInfo.tabs.get(windowInfo.activeTabId)
      if (activeTab && !activeTab.view.webContents.isDestroyed()) {
        this.touchTab(windowInfo.windowKey, windowInfo.activeTabId)
        return { tabId: windowInfo.activeTabId, tab: activeTab }
      }
    }

    // Create new tab
    const { tabId: newTabId } = await this.createTab(privateMode)
    const tab = windowInfo.tabs.get(newTabId)!
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
    const windowKey = this.getSessionKey(privateMode)

    logger.info('Loading URL', { url, windowKey, tabId: actualTabId, privateMode })
    const { webContents } = view
    this.touchTab(windowKey, actualTabId)

    let resolved = false
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    let onFinish: () => void
    let onDomReady: () => void
    let onFail: (_event: Electron.Event, code: number, desc: string) => void

    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
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
      timeoutHandle = setTimeout(() => reject(new Error('Navigation timed out')), timeout)
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
    const windowKey = this.getSessionKey(privateMode)
    this.touchTab(windowKey, actualTabId)
    const dbg = tab.view.webContents.debugger

    await this.ensureDebuggerAttached(dbg, windowKey)

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const evalPromise = dbg.sendCommand('Runtime.evaluate', {
      expression: code,
      awaitPromise: true,
      returnByValue: true
    })

    try {
      const result = await Promise.race([
        evalPromise,
        new Promise((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error('Execution timed out')), timeout)
        })
      ])

      const evalResult = result as any

      if (evalResult?.exceptionDetails) {
        const message = evalResult.exceptionDetails.exception?.description || 'Unknown script error'
        logger.warn('Runtime.evaluate raised exception', { message })
        throw new Error(message)
      }

      const value = evalResult?.result?.value ?? evalResult?.result?.description ?? null
      return value
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
    }
  }

  public async reset(privateMode?: boolean, tabId?: string) {
    if (privateMode !== undefined && tabId) {
      const windowKey = this.getSessionKey(privateMode)
      const windowInfo = this.windows.get(windowKey)
      if (windowInfo) {
        this.closeTabInternal(windowInfo, tabId)
        windowInfo.tabs.delete(tabId)
        if (windowInfo.activeTabId === tabId) {
          windowInfo.activeTabId = windowInfo.tabs.keys().next().value ?? null
        }
      }
      logger.info('Browser CDP tab reset', { windowKey, tabId })
      return
    }

    if (privateMode !== undefined) {
      const windowKey = this.getSessionKey(privateMode)
      const windowInfo = this.windows.get(windowKey)
      if (windowInfo) {
        for (const [tid] of windowInfo.tabs.entries()) {
          this.closeTabInternal(windowInfo, tid)
        }
        if (!windowInfo.window.isDestroyed()) {
          windowInfo.window.close()
        }
      }
      this.windows.delete(windowKey)
      logger.info('Browser CDP window reset', { windowKey, privateMode })
      return
    }

    for (const [, windowInfo] of this.windows.entries()) {
      for (const [tid] of windowInfo.tabs.entries()) {
        this.closeTabInternal(windowInfo, tid)
      }
      if (!windowInfo.window.isDestroyed()) {
        windowInfo.window.close()
      }
    }
    this.windows.clear()
    logger.info('Browser CDP context reset (all windows)')
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
    const windowKey = this.getSessionKey(privateMode)

    await this.ensureDebuggerAttached(dbg, windowKey)

    let expression: string
    if (format === 'json' || format === 'txt') {
      expression = 'document.body.innerText'
    } else {
      expression = 'document.documentElement.outerHTML'
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    try {
      const result = (await Promise.race([
        dbg.sendCommand('Runtime.evaluate', {
          expression,
          returnByValue: true
        }),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error('Fetch content timed out')), timeout)
        })
      ])) as { result?: { value?: string } }

      const content = result?.result?.value ?? ''

      if (format === 'markdown') {
        return this.turndownService.turndown(content)
      }
      if (format === 'json') {
        try {
          return JSON.parse(content)
        } catch {
          return { data: content }
        }
      }
      return content
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
    }
  }

  /**
   * Lists all tabs in a window
   * @param privateMode - If true, lists tabs from private window (default: false)
   */
  public async listTabs(privateMode = false): Promise<Array<{ tabId: string; url: string; title: string }>> {
    const windowKey = this.getSessionKey(privateMode)
    const windowInfo = this.windows.get(windowKey)
    if (!windowInfo) return []

    return Array.from(windowInfo.tabs.values()).map((tab) => ({
      tabId: tab.id,
      url: tab.url,
      title: tab.title
    }))
  }

  /**
   * Closes a specific tab
   * @param privateMode - If true, closes tab from private window (default: false)
   * @param tabId - Tab identifier to close
   */
  public async closeTab(privateMode: boolean, tabId: string) {
    await this.reset(privateMode, tabId)
  }

  /**
   * Switches the active tab
   * @param privateMode - If true, switches tab in private window (default: false)
   * @param tabId - Tab identifier to switch to
   */
  public async switchTab(privateMode: boolean, tabId: string) {
    const windowKey = this.getSessionKey(privateMode)
    const windowInfo = this.windows.get(windowKey)
    if (!windowInfo) throw new Error(`Window not found for ${privateMode ? 'private' : 'normal'} mode`)

    const tab = windowInfo.tabs.get(tabId)
    if (!tab) throw new Error(`Tab ${tabId} not found`)

    windowInfo.activeTabId = tabId

    // Update the displayed view
    if (!windowInfo.window.isDestroyed()) {
      windowInfo.window.setBrowserView(tab.view)
      this.updateViewBounds(windowInfo)
    }

    this.touchTab(windowKey, tabId)
    logger.info('Switched active tab', { windowKey, tabId, privateMode })
  }
}
