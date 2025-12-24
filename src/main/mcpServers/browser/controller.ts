import { randomUUID } from 'crypto'
import { app, BrowserView, BrowserWindow } from 'electron'
import TurndownService from 'turndown'

import { logger, type TabInfo, userAgent, type WindowInfo } from './types'

const TAB_BAR_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      height: 100%;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      user-select: none;
    }
    body {
      background: #202124;
      display: flex;
      align-items: flex-end;
      padding: 0 8px;
    }
    #tabs-container {
      display: flex;
      align-items: flex-end;
      height: 34px;
      flex: 1;
      overflow-x: auto;
      overflow-y: hidden;
    }
    #tabs-container::-webkit-scrollbar { display: none; }
    .tab {
      display: flex;
      align-items: center;
      height: 28px;
      min-width: 60px;
      max-width: 200px;
      padding: 0 8px 0 12px;
      margin-right: 1px;
      background: #35363a;
      border-radius: 8px 8px 0 0;
      cursor: pointer;
      transition: background 0.1s;
      flex-shrink: 0;
    }
    .tab:hover { background: #3c3d41; }
    .tab.active { background: #4a4b4f; height: 32px; }
    .tab-title {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #9aa0a6;
      font-size: 12px;
    }
    .tab.active .tab-title { color: #e8eaed; }
    .tab-close {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-left: 4px;
      opacity: 0;
      transition: opacity 0.1s, background 0.1s;
    }
    .tab:hover .tab-close, .tab.active .tab-close { opacity: 1; }
    .tab-close:hover { background: rgba(255,255,255,0.1); }
    .tab-close svg { width: 10px; height: 10px; fill: #9aa0a6; }
    .tab-close:hover svg { fill: #e8eaed; }
    #new-tab-btn {
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      cursor: pointer;
      margin-left: 4px;
    }
    #new-tab-btn:hover { background: rgba(255,255,255,0.1); }
    #new-tab-btn svg { width: 14px; height: 14px; fill: #9aa0a6; }
    .empty-state { color: #9aa0a6; padding: 8px 12px; }
  </style>
</head>
<body>
  <div id="tabs-container"><div class="empty-state">No tabs open</div></div>
  <div id="new-tab-btn" title="New tab">
    <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
  </div>
  <script>
    const tabsContainer = document.getElementById('tabs-container');
    const newTabBtn = document.getElementById('new-tab-btn');
    
    window.updateTabs = function(tabs) {
      if (!tabs || tabs.length === 0) {
        tabsContainer.innerHTML = '<div class="empty-state">No tabs open</div>';
        return;
      }
      tabsContainer.innerHTML = tabs.map(function(tab) {
        var cls = 'tab' + (tab.isActive ? ' active' : '');
        var title = (tab.title || 'New Tab').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        var url = (tab.url || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        return '<div class="' + cls + '" data-id="' + tab.id + '" title="' + url + '">' +
          '<span class="tab-title">' + title + '</span>' +
          '<div class="tab-close" data-id="' + tab.id + '">' +
            '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>' +
          '</div>' +
        '</div>';
      }).join('');
    };
    
    window.tabBarAction = null;
    
    tabsContainer.addEventListener('click', function(e) {
      var closeBtn = e.target.closest('.tab-close');
      if (closeBtn) { 
        e.stopPropagation(); 
        window.tabBarAction = { type: 'close', tabId: closeBtn.dataset.id };
        return; 
      }
      var tab = e.target.closest('.tab');
      if (tab) { 
        window.tabBarAction = { type: 'switch', tabId: tab.dataset.id };
      }
    });
    
    tabsContainer.addEventListener('auxclick', function(e) {
      if (e.button === 1) {
        var tab = e.target.closest('.tab');
        if (tab) { 
          window.tabBarAction = { type: 'close', tabId: tab.dataset.id };
        }
      }
    });
    
    newTabBtn.addEventListener('click', function() { 
      window.tabBarAction = { type: 'new' };
    });
  </script>
</body>
</html>`

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

  private sendTabBarUpdate(windowInfo: WindowInfo) {
    if (!windowInfo.tabBarView || windowInfo.tabBarView.webContents.isDestroyed()) return

    const tabs = Array.from(windowInfo.tabs.values()).map((tab) => ({
      id: tab.id,
      title: tab.title || 'New Tab',
      url: tab.url,
      isActive: tab.id === windowInfo.activeTabId
    }))

    const script = `window.updateTabs(${JSON.stringify(tabs)})`
    windowInfo.tabBarView.webContents.executeJavaScript(script).catch(() => {})
  }

  private pollTabBarActions(windowInfo: WindowInfo) {
    if (windowInfo.window.isDestroyed() || !windowInfo.tabBarView) return

    const poll = async () => {
      if (windowInfo.window.isDestroyed() || !windowInfo.tabBarView?.webContents) return

      try {
        const action = await windowInfo.tabBarView.webContents.executeJavaScript(
          '(function() { var a = window.tabBarAction; window.tabBarAction = null; return a; })()'
        )
        if (action) {
          if (action.type === 'switch' && action.tabId) {
            this.switchTab(windowInfo.privateMode, action.tabId).catch(() => {})
          } else if (action.type === 'close' && action.tabId) {
            this.closeTab(windowInfo.privateMode, action.tabId).catch(() => {})
          } else if (action.type === 'new') {
            this.createTab(windowInfo.privateMode, true)
              .then(({ tabId }) => this.switchTab(windowInfo.privateMode, tabId))
              .catch(() => {})
          }
        }
      } catch {
        return
      }

      if (!windowInfo.window.isDestroyed()) {
        setTimeout(poll, 100)
      }
    }

    setTimeout(poll, 500)
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
      this.pollTabBarActions(windowInfo)
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

  private async getOrCreateWindow(privateMode: boolean, showWindow = false): Promise<WindowInfo> {
    await this.ensureAppReady()
    this.sweepIdle()

    const windowKey = this.getSessionKey(privateMode)

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

      // Listen for window resize
      windowInfo.window.on('resize', () => this.updateViewBounds(windowInfo))
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
    const { tabId: newTabId } = await this.createTab(privateMode, showWindow)
    const tab = windowInfo.tabs.get(newTabId)!
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
   * @param showWindow - If true, shows the browser window (default: false)
   * @returns Content in the requested format. For 'json', returns parsed object or { data: rawContent } if parsing fails
   */
  public async fetch(
    url: string,
    format: 'html' | 'txt' | 'markdown' | 'json' = 'markdown',
    timeout = 10000,
    privateMode = false,
    newTab = false,
    showWindow = false
  ) {
    const { tabId } = await this.open(url, timeout, privateMode, newTab, showWindow)

    const { tab } = await this.getTab(privateMode, tabId, false, showWindow)
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
