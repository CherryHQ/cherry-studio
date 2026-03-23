import { titleBarOverlayDark, titleBarOverlayLight } from '@main/config'
import { isMac } from '@main/constant'
import { randomUUID } from 'crypto'
import { app, BrowserView, BrowserWindow, nativeTheme } from 'electron'
import TurndownService from 'turndown'

import { SESSION_KEY_DEFAULT, SESSION_KEY_PRIVATE, TAB_BAR_HEIGHT } from './constants'
import { TAB_BAR_HTML } from './tabbar-html'
import { logger, type TabInfo, userAgent, type WindowInfo } from './types'

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

    // Listen for theme changes and update all tab bars
    nativeTheme.on('updated', () => {
      const isDark = nativeTheme.shouldUseDarkColors
      for (const windowInfo of this.windows.values()) {
        if (windowInfo.tabBarView && !windowInfo.tabBarView.webContents.isDestroyed()) {
          windowInfo.tabBarView.webContents.executeJavaScript(`window.setTheme(${isDark})`).catch(() => {
            // Ignore errors if tab bar is not ready
          })
        }
      }
    })
  }

  private getWindowKey(privateMode: boolean): string {
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
    const windowKeys = Array.from(this.windows.keys())
    for (const windowKey of windowKeys) {
      const windowInfo = this.windows.get(windowKey)
      if (!windowInfo) continue
      if (now - windowInfo.lastActive > this.idleTimeoutMs) {
        const tabIds = Array.from(windowInfo.tabs.keys())
        for (const tabId of tabIds) {
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

  private sendTabBarUpdate(windowInfo: WindowInfo) {
    if (!windowInfo.tabBarView || !windowInfo.tabBarView.webContents || windowInfo.tabBarView.webContents.isDestroyed())
      return

    const tabs = Array.from(windowInfo.tabs.values()).map((tab) => ({
      id: tab.id,
      title: tab.title || 'New Tab',
      url: tab.url,
      isActive: tab.id === windowInfo.activeTabId
    }))

    let activeUrl = ''
    let canGoBack = false
    let canGoForward = false

    if (windowInfo.activeTabId) {
      const activeTab = windowInfo.tabs.get(windowInfo.activeTabId)
      if (activeTab && !activeTab.view.webContents.isDestroyed()) {
        activeUrl = activeTab.view.webContents.getURL()
        canGoBack = activeTab.view.webContents.canGoBack()
        canGoForward = activeTab.view.webContents.canGoForward()
      }
    }

    const script = `window.updateTabs(${JSON.stringify(tabs)}, ${JSON.stringify(activeUrl)}, ${canGoBack}, ${canGoForward})`
    windowInfo.tabBarView.webContents.executeJavaScript(script).catch((error) => {
      logger.debug('Tab bar update failed', { error, windowKey: windowInfo.windowKey })
    })
  }

  private handleNavigateAction(windowInfo: WindowInfo, url: string) {
    if (!windowInfo.activeTabId) return
    const activeTab = windowInfo.tabs.get(windowInfo.activeTabId)
    if (!activeTab || activeTab.view.webContents.isDestroyed()) return

    let finalUrl = url.trim()
    if (!/^https?:\/\//i.test(finalUrl)) {
      if (/^[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,}/.test(finalUrl) || finalUrl.includes('.')) {
        finalUrl = 'https://' + finalUrl
      } else {
        finalUrl = 'https://www.google.com/search?q=' + encodeURIComponent(finalUrl)
      }
    }

    activeTab.view.webContents.loadURL(finalUrl).catch((error) => {
      logger.warn('Navigation failed in tab bar', { error, url: finalUrl, tabId: windowInfo.activeTabId })
    })
  }

  private handleBackAction(windowInfo: WindowInfo) {
    if (!windowInfo.activeTabId) return
    const activeTab = windowInfo.tabs.get(windowInfo.activeTabId)
    if (!activeTab || activeTab.view.webContents.isDestroyed()) return

    if (activeTab.view.webContents.canGoBack()) {
      activeTab.view.webContents.goBack()
    }
  }

  private handleForwardAction(windowInfo: WindowInfo) {
    if (!windowInfo.activeTabId) return
    const activeTab = windowInfo.tabs.get(windowInfo.activeTabId)
    if (!activeTab || activeTab.view.webContents.isDestroyed()) return

    if (activeTab.view.webContents.canGoForward()) {
      activeTab.view.webContents.goForward()
    }
  }

  private handleRefreshAction(windowInfo: WindowInfo) {
    if (!windowInfo.activeTabId) return
    const activeTab = windowInfo.tabs.get(windowInfo.activeTabId)
    if (!activeTab || activeTab.view.webContents.isDestroyed()) return

    activeTab.view.webContents.reload()
  }

  private setupTabBarMessageHandler(windowInfo: WindowInfo) {
    if (!windowInfo.tabBarView) return

    windowInfo.tabBarView.webContents.on('console-message', (_event, _level, message) => {
      try {
        const parsed = JSON.parse(message)
        if (parsed?.channel === 'tabbar-action' && parsed?.payload) {
          this.handleTabBarAction(windowInfo, parsed.payload)
        }
      } catch {
        // Not a JSON message, ignore
      }
    })

    windowInfo.tabBarView.webContents
      .executeJavaScript(`
      (function() {
        window.addEventListener('message', function(e) {
          if (e.data && e.data.channel === 'tabbar-action') {
            console.log(JSON.stringify(e.data));
          }
        });
      })();
    `)
      .catch((error) => {
        logger.debug('Tab bar message handler setup failed', { error, windowKey: windowInfo.windowKey })
      })
  }

  private handleTabBarAction(windowInfo: WindowInfo, action: { type: string; tabId?: string; url?: string }) {
    if (action.type === 'switch' && action.tabId) {
      this.switchTab(windowInfo.privateMode, action.tabId).catch((error) => {
        logger.warn('Tab switch failed', { error, tabId: action.tabId, windowKey: windowInfo.windowKey })
      })
    } else if (action.type === 'close' && action.tabId) {
      this.closeTab(windowInfo.privateMode, action.tabId).catch((error) => {
        logger.warn('Tab close failed', { error, tabId: action.tabId, windowKey: windowInfo.windowKey })
      })
    } else if (action.type === 'new') {
      this.createTab(windowInfo.privateMode, true)
        .then(({ tabId }) => this.switchTab(windowInfo.privateMode, tabId))
        .catch((error) => {
          logger.warn('New tab creation failed', { error, windowKey: windowInfo.windowKey })
        })
    } else if (action.type === 'navigate' && action.url) {
      this.handleNavigateAction(windowInfo, action.url)
    } else if (action.type === 'back') {
      this.handleBackAction(windowInfo)
    } else if (action.type === 'forward') {
      this.handleForwardAction(windowInfo)
    } else if (action.type === 'refresh') {
      this.handleRefreshAction(windowInfo)
    } else if (action.type === 'window-minimize') {
      if (!windowInfo.window.isDestroyed()) {
        windowInfo.window.minimize()
      }
    } else if (action.type === 'window-maximize') {
      if (!windowInfo.window.isDestroyed()) {
        if (windowInfo.window.isMaximized()) {
          windowInfo.window.unmaximize()
        } else {
          windowInfo.window.maximize()
        }
      }
    } else if (action.type === 'window-close') {
      if (!windowInfo.window.isDestroyed()) {
        windowInfo.window.close()
      }
    }
  }

  private createTabBarView(windowInfo: WindowInfo): BrowserView {
    const tabBarView = new BrowserView({
      webPreferences: {
        contextIsolation: false,
        sandbox: false,
        nodeIntegration: false
      }
    })

    windowInfo.window.addBrowserView(tabBarView)
    const [width] = windowInfo.window.getContentSize()
    tabBarView.setBounds({ x: 0, y: 0, width, height: TAB_BAR_HEIGHT })
    tabBarView.setAutoResize({ width: true, height: false })
    tabBarView.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(TAB_BAR_HTML)}`)

    tabBarView.webContents.on('did-finish-load', () => {
      // Initialize platform for proper styling
      const platform = isMac ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'
      tabBarView.webContents.executeJavaScript(`window.initPlatform('${platform}')`).catch((error) => {
        logger.debug('Platform init failed', { error, windowKey: windowInfo.windowKey })
      })
      // Initialize theme
      const isDark = nativeTheme.shouldUseDarkColors
      tabBarView.webContents.executeJavaScript(`window.setTheme(${isDark})`).catch((error) => {
        logger.debug('Theme init failed', { error, windowKey: windowInfo.windowKey })
      })
      this.setupTabBarMessageHandler(windowInfo)
      this.sendTabBarUpdate(windowInfo)
    })

    return tabBarView
  }

  private async createBrowserWindow(
    windowKey: string,
    privateMode: boolean,
    showWindow = false
  ): Promise<BrowserWindow> {
    await this.ensureAppReady()

    const partition = this.getPartition(privateMode)

    const win = new BrowserWindow({
      show: showWindow,
      width: 1200,
      height: 800,
      ...(isMac
        ? {
            titleBarStyle: 'hidden',
            titleBarOverlay: nativeTheme.shouldUseDarkColors ? titleBarOverlayDark : titleBarOverlayLight,
            trafficLightPosition: { x: 8, y: 13 }
          }
        : {
            frame: false // Frameless window for Windows and Linux
          }),
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
        const tabIds = Array.from(windowInfo.tabs.keys())
        for (const tabId of tabIds) {
          this.closeTabInternal(windowInfo, tabId)
        }
        this.windows.delete(windowKey)
      }
    })

    return win
  }

  private async getOrCreateWindow(privateMode: boolean, showWindow = false): Promise<WindowInfo> {
    await this.ensureAppReady()
    this.sweepIdle()

    const windowKey = this.getWindowKey(privateMode)

    let windowInfo = this.windows.get(windowKey)
    if (!windowInfo) {
      this.evictIfNeeded(windowKey)
      const window = await this.createBrowserWindow(windowKey, privateMode, showWindow)
      windowInfo = {
        windowKey,
        privateMode,
        window,
        tabs: new Map(),
        activeTabId: null,
        lastActive: Date.now(),
        tabBarView: undefined
      }
      this.windows.set(windowKey, windowInfo)
      const tabBarView = this.createTabBarView(windowInfo)
      windowInfo.tabBarView = tabBarView

      // Register resize listener once per window (not per tab)
      // Capture windowKey to look up fresh windowInfo on each resize
      windowInfo.window.on('resize', () => {
        const info = this.windows.get(windowKey)
        if (info) this.updateViewBounds(info)
      })

      logger.info('Created new window', { windowKey, privateMode })
    } else if (showWindow && !windowInfo.window.isDestroyed()) {
      windowInfo.window.show()
    }

    this.touchWindow(windowKey)
    return windowInfo
  }

  private updateViewBounds(windowInfo: WindowInfo) {
    if (windowInfo.window.isDestroyed()) return

    const [width, height] = windowInfo.window.getContentSize()

    // Update tab bar bounds
    if (windowInfo.tabBarView && !windowInfo.tabBarView.webContents.isDestroyed()) {
      windowInfo.tabBarView.setBounds({ x: 0, y: 0, width, height: TAB_BAR_HEIGHT })
    }

    // Update active tab view bounds
    if (windowInfo.activeTabId) {
      const activeTab = windowInfo.tabs.get(windowInfo.activeTabId)
      if (activeTab && !activeTab.view.webContents.isDestroyed()) {
        activeTab.view.setBounds({
          x: 0,
          y: TAB_BAR_HEIGHT,
          width,
          height: Math.max(0, height - TAB_BAR_HEIGHT)
        })
      }
    }
  }

  /**
   * Creates a new tab in the window
   * @param privateMode - If true, uses private browsing mode (default: false)
   * @param showWindow - If true, shows the browser window (default: false)
   * @returns Tab ID and view
   */
  public async createTab(privateMode = false, showWindow = false): Promise<{ tabId: string; view: BrowserView }> {
    const windowInfo = await this.getOrCreateWindow(privateMode, showWindow)
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
            windowInfo.window.addBrowserView(newActiveTab.view)
            this.updateViewBounds(windowInfo)
          }
        }
      }
      this.sendTabBarUpdate(windowInfo)
    })

    view.webContents.on('page-title-updated', (_event, title) => {
      tabInfo.title = title
      this.sendTabBarUpdate(windowInfo)
    })

    view.webContents.on('did-navigate', (_event, url) => {
      tabInfo.url = url
      this.sendTabBarUpdate(windowInfo)
    })

    view.webContents.on('did-navigate-in-page', (_event, url) => {
      tabInfo.url = url
      this.sendTabBarUpdate(windowInfo)
    })

    // Handle new window requests (e.g., target="_blank" links) - open in new tab instead
    view.webContents.setWindowOpenHandler(({ url }) => {
      // Create a new tab and navigate to the URL
      this.createTab(privateMode, true)
        .then(({ tabId: newTabId }) => {
          return this.switchTab(privateMode, newTabId).then(() => {
            const newTab = windowInfo.tabs.get(newTabId)
            if (newTab && !newTab.view.webContents.isDestroyed()) {
              newTab.view.webContents.loadURL(url)
            }
          })
        })
        .catch((error) => {
          logger.warn('Failed to open link in new tab', { error, url })
        })
      return { action: 'deny' }
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
      windowInfo.window.addBrowserView(view)
      this.updateViewBounds(windowInfo)
    }

    this.sendTabBarUpdate(windowInfo)
    logger.info('Created new tab', { windowKey, tabId, privateMode })
    return { tabId, view }
  }

  /**
   * Gets an existing tab or creates a new one
   * @param privateMode - Whether to use private browsing mode
   * @param tabId - Optional specific tab ID to use
   * @param newTab - If true, always create a new tab (useful for parallel requests)
   * @param showWindow - If true, shows the browser window (default: false)
   */
  private async getTab(
    privateMode: boolean,
    tabId?: string,
    newTab?: boolean,
    showWindow = false
  ): Promise<{ tabId: string; tab: TabInfo }> {
    const windowInfo = await this.getOrCreateWindow(privateMode, showWindow)

    // If newTab is requested, create a fresh tab
    if (newTab) {
      const { tabId: freshTabId } = await this.createTab(privateMode, showWindow)
      const tab = windowInfo.tabs.get(freshTabId)
      if (!tab) {
        throw new Error(`Tab ${freshTabId} was created but not found - it may have been closed`)
      }
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
    const { tabId: newTabId } = await this.createTab(privateMode, showWindow)
    const tab = windowInfo.tabs.get(newTabId)
    if (!tab) {
      throw new Error(`Tab ${newTabId} was created but not found - it may have been closed`)
    }
    return { tabId: newTabId, tab }
  }

  /**
   * Opens a URL in a browser window and waits for navigation to complete.
   * @param url - The URL to navigate to
   * @param timeout - Navigation timeout in milliseconds (default: 10000)
   * @param privateMode - If true, uses private browsing mode (default: false)
   * @param newTab - If true, always creates a new tab (useful for parallel requests)
   * @param showWindow - If true, shows the browser window (default: false)
   * @returns Object containing the current URL, page title, and tab ID after navigation
   */
  public async open(url: string, timeout = 10000, privateMode = false, newTab = false, showWindow = false) {
    const { tabId: actualTabId, tab } = await this.getTab(privateMode, undefined, newTab, showWindow)
    const view = tab.view
    const windowKey = this.getWindowKey(privateMode)

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

  /**
   * Executes JavaScript code in the page context using Chrome DevTools Protocol.
   * @param code - JavaScript code to evaluate in the page
   * @param timeout - Execution timeout in milliseconds (default: 5000)
   * @param privateMode - If true, targets the private browsing window (default: false)
   * @param tabId - Optional specific tab ID to target; if omitted, uses the active tab
   * @returns The result value from the evaluated code, or null if no value returned
   */
  public async execute(code: string, timeout = 5000, privateMode = false, tabId?: string) {
    const { tabId: actualTabId, tab } = await this.getTab(privateMode, tabId)
    const windowKey = this.getWindowKey(privateMode)
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
      const windowKey = this.getWindowKey(privateMode)
      const windowInfo = this.windows.get(windowKey)
      if (windowInfo) {
        this.closeTabInternal(windowInfo, tabId)
        windowInfo.tabs.delete(tabId)

        // If no tabs left, close the window
        if (windowInfo.tabs.size === 0) {
          if (!windowInfo.window.isDestroyed()) {
            windowInfo.window.close()
          }
          this.windows.delete(windowKey)
          logger.info('Browser CDP window closed (last tab closed)', { windowKey, tabId })
          return
        }

        if (windowInfo.activeTabId === tabId) {
          windowInfo.activeTabId = windowInfo.tabs.keys().next().value ?? null
          if (windowInfo.activeTabId) {
            const newActiveTab = windowInfo.tabs.get(windowInfo.activeTabId)
            if (newActiveTab && !windowInfo.window.isDestroyed()) {
              windowInfo.window.addBrowserView(newActiveTab.view)
              this.updateViewBounds(windowInfo)
            }
          }
        }
        this.sendTabBarUpdate(windowInfo)
      }
      logger.info('Browser CDP tab reset', { windowKey, tabId })
      return
    }

    if (privateMode !== undefined) {
      const windowKey = this.getWindowKey(privateMode)
      const windowInfo = this.windows.get(windowKey)
      if (windowInfo) {
        const tabIds = Array.from(windowInfo.tabs.keys())
        for (const tid of tabIds) {
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

    const allWindowInfos = Array.from(this.windows.values())
    for (const windowInfo of allWindowInfos) {
      const tabIds = Array.from(windowInfo.tabs.keys())
      for (const tid of tabIds) {
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
   * @param showWindow - If true, shows the browser window (default: false)
   * @returns Object with tabId and content in the requested format. For 'json', content is parsed object or { data: rawContent } if parsing fails
   */
  public async fetch(
    url: string,
    format: 'html' | 'txt' | 'markdown' | 'json' = 'markdown',
    timeout = 10000,
    privateMode = false,
    newTab = false,
    showWindow = false
  ): Promise<{ tabId: string; content: string | object }> {
    const { tabId } = await this.open(url, timeout, privateMode, newTab, showWindow)

    const { tab } = await this.getTab(privateMode, tabId, false, showWindow)
    const dbg = tab.view.webContents.debugger
    const windowKey = this.getWindowKey(privateMode)

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

      const rawContent = result?.result?.value ?? ''

      let content: string | object
      if (format === 'markdown') {
        content = this.turndownService.turndown(rawContent)
      } else if (format === 'json') {
        try {
          content = JSON.parse(rawContent)
        } catch (parseError) {
          logger.warn('JSON parse failed, returning raw content', {
            url,
            contentLength: rawContent.length,
            error: parseError
          })
          content = { data: rawContent }
        }
      } else {
        content = rawContent
      }

      return { tabId, content }
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
    }
  }

  /**
   * Lists all tabs in a window
   * @param privateMode - If true, lists tabs from private window (default: false)
   */
  public async listTabs(privateMode = false): Promise<Array<{ tabId: string; url: string; title: string }>> {
    const windowKey = this.getWindowKey(privateMode)
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
    const windowKey = this.getWindowKey(privateMode)
    const windowInfo = this.windows.get(windowKey)
    if (!windowInfo) throw new Error(`Window not found for ${privateMode ? 'private' : 'normal'} mode`)

    const tab = windowInfo.tabs.get(tabId)
    if (!tab) throw new Error(`Tab ${tabId} not found`)

    // Remove previous active tab view (but NOT the tabBarView)
    if (windowInfo.activeTabId && windowInfo.activeTabId !== tabId) {
      const prevTab = windowInfo.tabs.get(windowInfo.activeTabId)
      if (prevTab && !windowInfo.window.isDestroyed()) {
        windowInfo.window.removeBrowserView(prevTab.view)
      }
    }

    windowInfo.activeTabId = tabId

    // Add the new active tab view
    if (!windowInfo.window.isDestroyed()) {
      windowInfo.window.addBrowserView(tab.view)
      this.updateViewBounds(windowInfo)
    }

    this.touchTab(windowKey, tabId)
    this.sendTabBarUpdate(windowInfo)
    logger.info('Switched active tab', { windowKey, tabId, privateMode })
  }
}
