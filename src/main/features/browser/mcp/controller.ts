import { once } from 'node:events'

import { application } from '@application'
import { isMac, isWin } from '@main/core/platform'
import { WindowType } from '@main/core/window/types'
import { sanitizeRemoteUrl } from '@main/utils/remoteUrlSafety'
import { randomUUID } from 'crypto'
import type { Protocol } from 'devtools-protocol'
import { app, BrowserView, type BrowserWindow, nativeTheme } from 'electron'
import type TurndownService from 'turndown'

import type { BrowserSessionService } from '../BrowserSessionService'
import { BrowserSessionError } from '../session/BrowserSessionError'
import { SESSION_KEY_DEFAULT, SESSION_KEY_PRIVATE, TAB_BAR_HEIGHT } from './constants'
import { TAB_BAR_HTML } from './tabbarHtml'
import { logger, type TabInfo, userAgent, type WindowInfo } from './types'

/**
 * Controller for managing browser windows via Chrome DevTools Protocol (CDP).
 * Supports two modes: normal (persistent) and private (ephemeral).
 * Normal mode persists user data (cookies, localStorage, etc.) globally across all clients.
 * Private mode is ephemeral - data is cleared when the window closes.
 */
export class CdpBrowserController {
  private windows: Map<string, WindowInfo> = new Map()
  private readonly owner = `mcp:${randomUUID()}`
  private disposed = false
  private closing?: Promise<void>
  private creatingTabs = 0
  private readonly openingWindows = new Map<string, Promise<WindowInfo>>()
  private turndownServicePromise?: Promise<TurndownService>

  // Update all tab bars on theme change. Named so dispose() can unregister it —
  // nativeTheme is app-global, and one controller is created per MCP connection.
  private readonly handleThemeUpdated = () => {
    const isDark = nativeTheme.shouldUseDarkColors
    for (const windowInfo of this.windows.values()) {
      if (windowInfo.tabBarView && !windowInfo.tabBarView.webContents.isDestroyed()) {
        windowInfo.tabBarView.webContents.executeJavaScript(`window.setTheme(${isDark})`).catch(() => {
          // Ignore errors if tab bar is not ready
        })
      }
    }
  }

  constructor(private readonly service: BrowserSessionService) {
    nativeTheme.on('updated', this.handleThemeUpdated)
  }

  private getTurndownService(): Promise<TurndownService> {
    return (this.turndownServicePromise ??= import('turndown').then(
      ({ default: TurndownService }) => new TurndownService()
    ))
  }

  /**
   * Removes the global nativeTheme listener and closes all windows.
   * Must be called when the owning MCP server connection closes; safe to call more than once.
   */
  public dispose(): Promise<void> {
    if (this.closing) return this.closing
    this.disposed = true
    this.closing = Promise.resolve().then(async () => {
      nativeTheme.removeListener('updated', this.handleThemeUpdated)
      await Promise.allSettled(this.openingWindows.values())
      const windows = [...this.windows.values()]
      const pending = windows.flatMap((info) => [...info.tabs.values()].flatMap((tab) => [tab.ready, tab.popup]))
      const controller = new AbortController()
      const closed = Promise.allSettled(
        windows.flatMap((info) => {
          const contents = [...info.tabs.values()].map((tab) => tab.view.webContents)
          if (info.tabBarView) contents.push(info.tabBarView.webContents)
          return [
            ...contents
              .filter((guest) => !guest.isDestroyed())
              .map((guest) => once(guest, 'destroyed', { signal: controller.signal })),
            ...(info.window.isDestroyed() ? [] : [once(info.window, 'closed', { signal: controller.signal })])
          ]
        })
      )
      try {
        await this.reset()
        await Promise.allSettled([...pending, closed])
      } finally {
        controller.abort()
      }
    })
    return this.closing
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

  private touchTab(windowKey: string, tabId: string) {
    const windowInfo = this.windows.get(windowKey)
    if (windowInfo) {
      const tab = windowInfo.tabs.get(tabId)
      if (tab) {
        tab.session.lastActive = Date.now()
      }
    }
  }

  private closeTabInternal(windowInfo: WindowInfo, tabId: string) {
    const tab = windowInfo.tabs.get(tabId)
    if (tab) this.service.closeGuest(tab.view.webContents)
  }

  private destroyTab(windowInfo: WindowInfo, tabId: string) {
    const tab = windowInfo.tabs.get(tabId)
    if (!tab) return
    windowInfo.tabs.delete(tabId)
    if (!windowInfo.window.isDestroyed()) windowInfo.window.removeBrowserView(tab.view)
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close({ waitForBeforeUnload: false })
    if (windowInfo.activeTabId === tabId) {
      windowInfo.activeTabId = windowInfo.tabs.keys().next().value ?? null
      const next = windowInfo.activeTabId && windowInfo.tabs.get(windowInfo.activeTabId)
      if (next && !windowInfo.window.isDestroyed()) {
        windowInfo.window.setTopBrowserView(next.view)
        this.updateViewBounds(windowInfo)
      }
    }
    this.sendTabBarUpdate(windowInfo)
    if (!windowInfo.tabs.size && !this.creatingTabs) this.closeWindow(windowInfo)
  }

  // All controller-initiated window closes go through WindowManager, which owns
  // the BrowserWindow lifecycle; the per-window 'closed' listener does map cleanup.
  private closeWindow(windowInfo: WindowInfo) {
    if (!windowInfo.window.isDestroyed()) {
      application.get('WindowManager').close(windowInfo.windowId)
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
      this.closeWindow(windowInfo)
    }
  }

  private createTabBarView(windowInfo: WindowInfo): BrowserView {
    const tabBarView = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    })

    windowInfo.window.addBrowserView(tabBarView)
    const [width] = windowInfo.window.getContentSize()
    tabBarView.setBounds({ x: 0, y: 0, width, height: TAB_BAR_HEIGHT })
    tabBarView.setAutoResize({ width: true, height: false })
    void tabBarView.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(TAB_BAR_HTML)}`)

    tabBarView.webContents.on('did-finish-load', () => {
      // Initialize platform for proper styling
      const platform = isMac ? 'mac' : isWin ? 'win' : 'linux'
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
  ): Promise<{ window: BrowserWindow; windowId: string }> {
    await this.ensureAppReady()

    const windowManager = application.get('WindowManager')
    // The per-mode session partition is the only dynamic option; everything else
    // lives in the WindowType.McpBrowser registry entry.
    const windowId = windowManager.open(WindowType.McpBrowser, {
      options: { webPreferences: { partition: this.getPartition(privateMode) } }
    })
    const win = windowManager.getWindow(windowId)
    if (!win) {
      windowManager.close(windowId)
      throw new Error('MCP browser window not found after open')
    }
    if (showWindow) win.show()

    win.on('closed', () => {
      const windowInfo = this.windows.get(windowKey)
      if (windowInfo) {
        this.windows.delete(windowKey)
        if (windowInfo.tabBarView && !windowInfo.tabBarView.webContents.isDestroyed())
          windowInfo.tabBarView.webContents.close({ waitForBeforeUnload: false })
        const tabIds = Array.from(windowInfo.tabs.keys())
        for (const tabId of tabIds) {
          this.closeTabInternal(windowInfo, tabId)
        }
        this.windows.delete(windowKey)
      }
    })

    return { window: win, windowId }
  }

  private async getOrCreateWindow(privateMode: boolean, showWindow = false): Promise<WindowInfo> {
    if (this.disposed) throw new BrowserSessionError('debugger_unavailable')
    const key = this.getWindowKey(privateMode)
    let pending = this.openingWindows.get(key)
    if (!pending) {
      pending = this.createOrReuseWindow(privateMode, showWindow)
      this.openingWindows.set(key, pending)
    }
    try {
      const info = await pending
      if (this.disposed) throw new BrowserSessionError('debugger_unavailable')
      if (showWindow) info.window.show()
      return info
    } finally {
      if (this.openingWindows.get(key) === pending) this.openingWindows.delete(key)
    }
  }

  private async createOrReuseWindow(privateMode: boolean, showWindow = false): Promise<WindowInfo> {
    await this.ensureAppReady()
    if (this.disposed) throw new BrowserSessionError('debugger_unavailable')

    const windowKey = this.getWindowKey(privateMode)

    let windowInfo = this.windows.get(windowKey)
    if (!windowInfo) {
      const { window, windowId } = await this.createBrowserWindow(windowKey, privateMode, showWindow)
      windowInfo = {
        windowKey,
        privateMode,
        window,
        windowId,
        tabs: new Map(),
        activeTabId: null,
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

    return windowInfo
  }

  private updateViewBounds(windowInfo: WindowInfo) {
    if (windowInfo.window.isDestroyed()) return

    const [width, height] = windowInfo.window.getContentSize()

    // Update tab bar bounds
    if (windowInfo.tabBarView && !windowInfo.tabBarView.webContents.isDestroyed()) {
      windowInfo.tabBarView.setBounds({ x: 0, y: 0, width, height: TAB_BAR_HEIGHT })
    }

    for (const tab of windowInfo.tabs.values()) {
      if (!tab.view.webContents.isDestroyed()) {
        tab.view.setBounds({ x: 0, y: TAB_BAR_HEIGHT, width, height: Math.max(0, height - TAB_BAR_HEIGHT) })
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
    if (this.disposed) throw new BrowserSessionError('debugger_unavailable')
    const tabId = randomUUID()
    const partition = this.getPartition(privateMode)

    const view = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        devTools: true,
        backgroundThrottling: false,
        partition
      }
    })

    const [width, height] = windowInfo.window.getContentSize()
    view.webContents.setUserAgent(userAgent)

    const windowKey = windowInfo.windowKey
    view.webContents.on('did-start-loading', () => logger.info(`did-start-loading`, { windowKey, tabId }))
    view.webContents.on('dom-ready', () => logger.info(`dom-ready`, { windowKey, tabId }))
    view.webContents.on('did-finish-load', () => logger.info(`did-finish-load`, { windowKey, tabId }))
    view.webContents.on('did-fail-load', (_e, code, desc) => logger.warn('Navigation failed', { code, desc }))

    view.webContents.on('destroyed', () => this.destroyTab(windowInfo, tabId))

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

    view.webContents.setWindowOpenHandler(({ url }) => {
      let safeUrl: string
      try {
        safeUrl = sanitizeRemoteUrl(url)
      } catch {
        return { action: 'deny' }
      }
      tabInfo.popup = this.createTab(privateMode, false)
        .then(async ({ tabId: newTabId }) => {
          await this.switchTab(privateMode, newTabId)
          const { session } = await this.getSession(privateMode, newTabId)
          await session.run(async () => {
            const { settleAction } = await import('../actions/settle')
            await settleAction(session, () => session.send('Page.navigate', { url: safeUrl }))
          })
          return newTabId
        })
        .catch((error) => {
          logger.warn('Failed to open link in new tab', { error, url })
          return undefined
        })
      return { action: 'deny' }
    })

    this.creatingTabs++
    let session
    try {
      session = this.service.acquire(view.webContents, this.owner, {
        ownership: 'managed',
        close: () => this.destroyTab(windowInfo, tabId)
      })
    } catch (error) {
      view.webContents.close({ waitForBeforeUnload: false })
      if (!windowInfo.tabs.size) this.closeWindow(windowInfo)
      throw error
    } finally {
      this.creatingTabs--
    }
    const ready = session.run(() => view.webContents.loadURL('about:blank'))
    const tabInfo: TabInfo = {
      session,
      ready,
      id: tabId,
      view,
      url: '',
      title: ''
    }

    windowInfo.tabs.set(tabId, tabInfo)

    windowInfo.window.addBrowserView(view)
    view.setBounds({ x: 0, y: TAB_BAR_HEIGHT, width, height: Math.max(0, height - TAB_BAR_HEIGHT) })
    const active = windowInfo.activeTabId && windowInfo.tabs.get(windowInfo.activeTabId)
    if (active) windowInfo.window.setTopBrowserView(active.view)

    // Set as active tab and add to window
    if (!windowInfo.activeTabId || windowInfo.tabs.size === 1) {
      windowInfo.activeTabId = tabId
      windowInfo.window.setTopBrowserView(view)
      this.updateViewBounds(windowInfo)
    }

    this.sendTabBarUpdate(windowInfo)
    logger.info('Created new tab', { windowKey, tabId, privateMode })
    try {
      // Chromium needs a document before enabling CDP domains on a fresh BrowserView.
      await ready
      if (this.disposed) throw new BrowserSessionError('debugger_unavailable')
    } catch (error) {
      this.closeTabInternal(windowInfo, tabId)
      throw error
    }
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
    if (tabId && !this.windows.get(this.getWindowKey(privateMode))?.tabs.has(tabId))
      throw new BrowserSessionError('not_found')
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
        await tab.ready
        this.touchTab(windowInfo.windowKey, tabId)
        return { tabId, tab }
      }
      throw new BrowserSessionError('not_found')
    }

    // Use active tab or create new one
    if (windowInfo.activeTabId) {
      const activeTab = windowInfo.tabs.get(windowInfo.activeTabId)
      if (activeTab && !activeTab.view.webContents.isDestroyed()) {
        await activeTab.ready
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
    // Reject non-http(s) schemes (e.g. file://) and local/private hosts before navigating
    // (covers fetch() too, which routes through open()) to prevent local-file read / SSRF.
    url = sanitizeRemoteUrl(url)

    const { tabId: actualTabId, tab } = await this.getTab(privateMode, undefined, newTab, showWindow)
    const webContents = tab.view.webContents
    await tab.session.run(async () => {
      const { settleAction } = await import('../actions/settle')
      await settleAction(
        tab.session,
        async () => {
          const result = await tab.session.send('Page.navigate', { url }, { deadline: Date.now() + timeout })
          if (result.errorText) throw new Error(result.errorText)
        },
        { deadline: Date.now() + timeout }
      )
    })

    const currentUrl = webContents.getURL()
    const title = webContents.getTitle()

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
  public async takeNewTabId(privateMode: boolean | undefined, tabId: string) {
    const tab = this.windows.get(this.getWindowKey(privateMode ?? false))?.tabs.get(tabId)
    const popup = tab?.popup
    if (tab) tab.popup = undefined
    return popup
  }

  public async getSession(privateMode = false, tabId?: string) {
    const target = await this.getTab(privateMode, tabId)
    return { tabId: target.tabId, session: target.tab.session }
  }

  public async execute(code: string, timeout = 5000, privateMode = false, tabId?: string, signal?: AbortSignal) {
    const { session } = await this.getSession(privateMode, tabId)
    return session.run(async () => {
      const result = await session.send(
        'Runtime.evaluate',
        {
          expression: code,
          awaitPromise: true,
          returnByValue: true,
          timeout
        },
        { deadline: Date.now() + timeout, signal }
      )
      if (result.exceptionDetails)
        throw new Error(result.exceptionDetails.exception?.description ?? 'Script evaluation failed')
      return result.result?.value ?? result.result?.description ?? null
    })
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
          this.closeWindow(windowInfo)
          this.windows.delete(windowKey)
          logger.info('Browser CDP window closed (last tab closed)', { windowKey, tabId })
          return
        }

        if (windowInfo.activeTabId === tabId) {
          windowInfo.activeTabId = windowInfo.tabs.keys().next().value ?? null
          if (windowInfo.activeTabId) {
            const newActiveTab = windowInfo.tabs.get(windowInfo.activeTabId)
            if (newActiveTab && !windowInfo.window.isDestroyed()) {
              windowInfo.window.setTopBrowserView(newActiveTab.view)
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
        this.closeWindow(windowInfo)
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
      this.closeWindow(windowInfo)
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
    showWindow = false,
    selector?: string
  ): Promise<{ tabId: string; content: string | object }> {
    const { tabId } = await this.open(url, timeout, privateMode, newTab, showWindow)

    let expression: string
    const root = selector
      ? `(document.querySelector(${JSON.stringify(selector)}) || document.body)`
      : format === 'json' || format === 'txt'
        ? 'document.body'
        : 'document.documentElement'

    if (format === 'json' || format === 'txt') {
      expression = `${root}.innerText`
    } else {
      expression = `${root}.outerHTML`
    }

    const rawContent = String((await this.execute(expression, timeout, privateMode, tabId)) ?? '')

    let content: string | object
    if (format === 'markdown') {
      content = (await this.getTurndownService()).turndown(rawContent)
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
  }

  /**
   * Takes a screenshot of the current page using CDP Page.captureScreenshot.
   * @param options - Screenshot options
   * @param privateMode - If true, targets private window (default: false)
   * @param tabId - Optional specific tab ID to target
   * @returns Base64-encoded image data
   */
  public async screenshot(
    options: { fullPage?: boolean; format?: 'png' | 'jpeg'; quality?: number } = {},
    privateMode = false,
    tabId?: string
  ): Promise<string> {
    const { session } = await this.getSession(privateMode, tabId)

    const format = options.format ?? 'png'
    const params: Protocol.Page.CaptureScreenshotRequest = {
      format,
      captureBeyondViewport: options.fullPage ?? false
    }
    if (format === 'jpeg' && options.quality !== undefined) {
      params.quality = options.quality
    }

    const result = await session.run(() => session.send('Page.captureScreenshot', params))
    return result.data
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

    windowInfo.activeTabId = tabId

    // Add the new active tab view
    if (!windowInfo.window.isDestroyed()) {
      windowInfo.window.setTopBrowserView(tab.view)
      this.updateViewBounds(windowInfo)
    }

    this.touchTab(windowKey, tabId)
    this.sendTabBarUpdate(windowInfo)
    logger.info('Switched active tab', { windowKey, tabId, privateMode })
  }
}
