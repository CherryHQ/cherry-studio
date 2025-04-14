// https://github.com/samuelmaddock/electron-browser-shell/blob/master/packages/shell/browser/tabs.js
import { BrowserWindow, WebContentsView } from 'electron'
import Logger from 'electron-log'
import { EventEmitter } from 'events'

const TOOLBAR_HEIGHT = 64

export class Tab {
  public id: number
  public window: BrowserWindow
  public view: WebContentsView
  public webContents: Electron.WebContents
  public destroyed = false

  constructor(parentWindow: BrowserWindow, webContentsViewOptions: Electron.WebContentsViewConstructorOptions = {}) {
    this.invalidateLayout = this.invalidateLayout.bind(this)

    this.view = new WebContentsView(webContentsViewOptions)
    this.id = this.view.webContents.id
    this.window = parentWindow
    this.webContents = this.view.webContents
    this.window.webContents.setWindowOpenHandler(({ url }) => {
      this.loadURL(url)
      return { action: 'deny' }
    })
    this.window.contentView.addChildView(this.view)
  }

  destroy() {
    if (this.destroyed) return

    this.destroyed = true

    this.hide()

    if (this.window && !this.window.isDestroyed() && this.view) {
      try {
        this.window.contentView.removeChildView(this.view)
      } catch (error) {
        Logger.error('[ExtensionTabs] Error removing child view:', error)
      }
    }
    this.window = undefined as any

    if (this.webContents && !this.webContents.isDestroyed()) {
      if (this.webContents.isDevToolsOpened()) {
        this.webContents.closeDevTools()
      }
    }

    this.webContents = undefined as any
    this.view = undefined as any
  }

  loadURL(url: string) {
    return this.view.webContents.loadURL(url)
  }

  show() {
    this.invalidateLayout()
    this.startResizeListener()
    this.view.webContents.focus()
  }

  hide() {
    this.stopResizeListener()
    if (this.view) {
      this.view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    }
  }

  reload() {
    this.view.webContents.reload()
  }

  invalidateLayout() {
    const [width, height] = this.window.getSize()
    const padding = 4
    this.view.setBounds({
      x: padding,
      y: TOOLBAR_HEIGHT,
      width: width - padding * 2,
      height: height - TOOLBAR_HEIGHT - padding
    })
  }

  // Replacement for BrowserView.setAutoResize
  startResizeListener() {
    this.stopResizeListener()
    this.window.on('resize', this.invalidateLayout)
  }

  stopResizeListener() {
    this.window.off('resize', this.invalidateLayout)
  }
}

export class Tabs extends EventEmitter {
  tabList: Tab[] = []
  selected: Tab | null = null
  window: BrowserWindow

  constructor(browserWindow: BrowserWindow) {
    super()
    this.window = browserWindow

    // Handle window close to clean up tabs
    this.window.on('closed', () => {
      this.destroy()
    })
  }

  destroy() {
    Logger.info('[ExtensionTabs] Destroying all tabs')
    // Make a copy of the tab list before modifying it
    const tabsToDestroy = [...this.tabList]
    tabsToDestroy.forEach((tab) => tab.destroy())
    this.tabList = []
    this.selected = null
    this.window = undefined as any
  }

  get(tabId: number): Tab | undefined {
    return this.tabList.find((tab) => tab.id === tabId)
  }

  getByWebContents(webContents: Electron.WebContents): Tab | undefined {
    return this.tabList.find((tab) => tab.webContents.id === webContents.id)
  }

  create(webContentsViewOptions: Electron.WebContentsViewConstructorOptions = {}): Tab {
    Logger.info('[ExtensionTabs] Creating new tab')
    const tab = new Tab(this.window, webContentsViewOptions)
    this.tabList.push(tab)

    if (!this.selected) {
      this.selected = tab
    }

    // Hide all other tabs
    this.tabList.forEach((t) => {
      if (t !== tab) {
        t.hide()
      }
    })

    tab.show()
    this.emit('tab-created', tab)
    this.select(tab.id)
    return tab
  }

  remove(tabId: number): void {
    const tabIndex = this.tabList.findIndex((tab) => tab.id === tabId)
    if (tabIndex < 0) {
      Logger.warn(`[ExtensionTabs] Unable to find tab.id = ${tabId}`)
      return
    }

    Logger.info(`[ExtensionTabs] Removing tab with id ${tabId}`)
    const tab = this.tabList[tabIndex]
    this.tabList.splice(tabIndex, 1)
    tab.destroy()

    if (this.selected === tab) {
      this.selected = null
      const nextTab = this.tabList[tabIndex] || this.tabList[tabIndex - 1]
      if (nextTab) {
        this.select(nextTab.id)
      }
    }

    this.emit('tab-destroyed', tab)

    // If no tabs left, hide the window but don't close it
    // as we want to reuse it for future extension tabs
    if (this.tabList.length === 0) {
      Logger.info('[ExtensionTabs] No tabs left, hiding window')
      if (this.window && !this.window.isDestroyed()) {
        this.window.hide()
      }
    }
  }

  select(tabId: number): void {
    const tab = this.get(tabId)
    if (!tab) {
      Logger.warn(`[ExtensionTabs] Cannot select tab with id ${tabId}, not found`)
      return
    }

    Logger.info(`[ExtensionTabs] Selecting tab with id ${tabId}`)

    if (this.selected) {
      this.selected.hide()
    }

    tab.show()
    this.selected = tab
    this.emit('tab-selected', tab)

    // Ensure window is visible and focused
    if (this.window && !this.window.isDestroyed() && !this.window.isVisible()) {
      this.window.show()
      this.window.focus()
    }
  }
}
