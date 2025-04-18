import { windowService } from '@main/services/WindowService'
import { loadManifestV3 } from '@main/utils/extension'
import { CHROME_WEB_STORE_URL } from '@shared/config/constant'
import { ChromeWebStoreOptions, Extension, InstallExtensionOptions } from '@shared/config/types'
import { app, BrowserWindow, session, WebContents } from 'electron'
import { ChromeExtensionOptions, ElectronChromeExtensions } from 'electron-chrome-extensions'
import {
  installChromeWebStore,
  installExtension,
  uninstallExtension,
  updateExtensions
} from 'electron-chrome-web-store'
import Logger from 'electron-log'
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'

import { Tabs } from './ExtensionTabs'
import { reduxService } from './ReduxService'
// Extension events
export enum ExtensionEvent {
  INSTALLED = 'extension-installed',
  UNINSTALLED = 'extension-uninstalled',
  ENABLED = 'extension-enabled',
  DISABLED = 'extension-disabled',
  UPDATED = 'extension-updated'
}

export class ExtensionService extends EventEmitter {
  private static instance: ExtensionService | null = null
  public extensions: ElectronChromeExtensions | null = null
  private mainSession!: Electron.Session
  private extensionsPath!: string
  private chromeWebStoreInitialized = false
  private extensionWindow: BrowserWindow | null = null
  private tabs: Tabs | null = null

  private constructor() {
    super()
    this.openChromeWebStore = this.openChromeWebStore.bind(this)
    this.installExtension = this.installExtension.bind(this)
    this.uninstallExtension = this.uninstallExtension.bind(this)
    this.updateExtensions = this.updateExtensions.bind(this)
    this.loadExtension = this.loadExtension.bind(this)
    this.unloadExtension = this.unloadExtension.bind(this)
    this.createExtensionTab = this.createExtensionTab.bind(this)
    this.selectExtensionTab = this.selectExtensionTab.bind(this)
    this.removeExtensionTab = this.removeExtensionTab.bind(this)
    this.getOrCreateExtensionWindow = this.getOrCreateExtensionWindow.bind(this)
    this.openPopup = this.openPopup.bind(this)
  }

  get getExtensionsPath(): string {
    return this.extensionsPath
  }

  get getExtensions(): ElectronChromeExtensions | null {
    return this.extensions
  }

  public static getInstance(): ExtensionService {
    if (!ExtensionService.instance) {
      ExtensionService.instance = new ExtensionService()
    }
    return ExtensionService.instance
  }

  /**
   * 获取或创建扩展窗口
   * 这是一个共享窗口，用于显示所有扩展相关内容
   */
  private getOrCreateExtensionWindow(): BrowserWindow {
    if (this.extensionWindow && !this.extensionWindow.isDestroyed()) {
      return this.extensionWindow
    }

    Logger.info('[Extension] Creating extension window')
    this.extensionWindow = windowService.createExtensionWindow()

    // 初始化标签页管理器
    this.tabs = new Tabs(this.extensionWindow)

    // 监听窗口关闭事件，但不销毁标签管理器，因为窗口可能会被重新创建
    this.extensionWindow.on('closed', () => {
      Logger.info('[Extension] Extension window closed')
      this.extensionWindow = null
      // 不销毁tabs，因为Tabs类内部会处理自己的清理
    })

    return this.extensionWindow
  }

  /**
   * 创建扩展标签页
   * @param details 标签页创建参数
   * @returns [标签页WebContents, 扩展窗口]
   */
  public async createExtensionTab(details: any): Promise<[Electron.WebContents, BrowserWindow]> {
    const win = this.getOrCreateExtensionWindow()

    if (!this.tabs) {
      Logger.error('[Extension] Tabs manager not initialized')
      throw new Error('Tabs manager not initialized')
    }

    // 创建新标签页
    const tab = this.tabs.create({
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    })

    // 加载URL
    if (details.url) {
      await tab.loadURL(details.url)
    }

    // 如果需要激活标签页
    if (details.active !== false) {
      this.tabs.select(tab.id)
      win.focus()
    }

    return [tab.webContents, win]
  }

  /**
   * 选择扩展标签页
   * @param webContents 要选择的标签页WebContents
   */
  private selectExtensionTab(webContents: Electron.WebContents): void {
    if (
      !this.tabs &&
      this.extensionWindow &&
      !this.extensionWindow.isDestroyed() &&
      webContents.id !== this.extensionWindow.webContents.id
    ) {
      Logger.warn('[Extension] Cannot select tab: Tabs manager not initialized')
      return
    }

    if (!this.tabs) {
      // Log differently if the manager simply isn't initialized (e.g., no extension window created yet)
      Logger.warn('[Extension] Cannot select tab via callback: Tabs manager not initialized.')
      return
    }

    const tab = this.tabs.getByWebContents(webContents)
    if (tab) {
      this.tabs.select(tab.id)

      // 确保窗口可见并聚焦
      if (this.extensionWindow && !this.extensionWindow.isDestroyed()) {
        this.extensionWindow.show()
        this.extensionWindow.focus()
      }
    } else {
      Logger.warn('[Extension] Cannot select tab: Tab not found for WebContents ID', webContents.id)
    }
  }

  /**
   * 移除扩展标签页
   * @param webContents 要移除的标签页WebContents
   */
  private removeExtensionTab(webContents: Electron.WebContents): void {
    if (!this.tabs) {
      Logger.warn('[Extension] Cannot remove tab: Tabs manager not initialized')
      return
    }

    // 检查是否是主窗口的WebContents，如果是，不进行处理
    const mainWindow = windowService.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.id === webContents.id) {
      Logger.warn('[Extension] Not removing main window tab to prevent closing issues')
      return
    }

    const tab = this.tabs.getByWebContents(webContents)
    if (tab) {
      this.tabs.remove(tab.id)
    } else {
      Logger.warn('[Extension] Cannot remove tab: Tab not found for WebContents ID', webContents.id)
    }
  }

  public async initialize(): Promise<void> {
    if (this.extensions) {
      Logger.warn('[Extension] ExtensionService already initialized.')
      return
    }

    // Initialize session and paths here, after app is ready
    this.mainSession = session.defaultSession
    this.extensionsPath = path.join(app.getPath('userData'), 'extensions')

    Logger.info('[Extension] Initializing ElectronChromeExtensions...')

    try {
      // 创建扩展配置
      const extensionOptions: ChromeExtensionOptions = {
        license: 'GPL-3.0',
        session: this.mainSession,
        createTab: async (details) => {
          Logger.info('[Extension API] createTab request:', details)
          return this.createExtensionTab(details)
        },

        selectTab: (targetWebContents: WebContents /* browserWindow */) => {
          Logger.info('[Extension API] selectTab request for wcId:', targetWebContents.id)
          this.selectExtensionTab(targetWebContents)
        },

        removeTab: (targetWebContents: WebContents /* browserWindow */) => {
          Logger.info('[Extension API] removeTab request for wcId:', targetWebContents.id)
          this.removeExtensionTab(targetWebContents)
        },

        createWindow: async (details) => {
          Logger.info('[Extension API] createWindow request:', details)
          const [, win] = await this.createExtensionTab({ url: details.url })

          // Handle window state if specified
          if (details.state === 'minimized') {
            win.minimize()
          } else if (details.state === 'maximized') {
            win.maximize()
          } else if (details.state === 'fullscreen') {
            win.setFullScreen(true)
          }

          return win
        },

        removeWindow: (browserWindow: BrowserWindow) => {
          Logger.info(`[Extension API] removeWindow request for winId: ${browserWindow.id}`)
          if (!browserWindow.isDestroyed()) {
            if (this.extensionWindow && browserWindow.id === this.extensionWindow.id) {
              Logger.info(
                `[Extension API] Request to remove the shared extension window (ID: ${browserWindow.id}). Hiding/closing is managed by Tabs class.`
              )
            } else {
              Logger.warn(
                `[Extension API] Request to remove an unexpected window (ID: ${browserWindow.id}). Closing it directly.`
              )
              browserWindow.close()
            }
          }
        },
        requestPermissions: (extension, permissions) => {
          Logger.info('[Extension Chrome API] requestPermissions request for extension:', extension, permissions)
          return Promise.resolve(true)
        }
      }

      this.extensions = new ElectronChromeExtensions(extensionOptions)

      this.extensions.on('browser-action-popup-created', (popup) => {
        Logger.info('[Extension] Browser action popup created:', popup)
      })

      this.mainSession.serviceWorkers.on('running-status-changed', (event) => {
        Logger.info(`service worker ${event.versionId} ${event.runningStatus}`)
      })

      // 设置本地扩展目录
      await this.setupLocalExtensionsDirectory()

      // 设置事件监听器
      this.setupEventListeners()
    } catch (error) {
      Logger.error('[Extension] Failed to initialize ElectronChromeExtensions:', error)
    }
  }

  private async listExtensions(): Promise<Extension[]> {
    try {
      return (await reduxService.select('state.extensions')).extensions ?? []
    } catch (error) {
      Logger.error('[Extension] Failed to list extensions:', error)
      return []
    }
  }

  private async getExtension(extensionId: string): Promise<Extension | null> {
    const extensions = await this.listExtensions()
    return extensions.find((ext) => ext.id === extensionId) ?? null
  }

  // 更新扩展状态
  private async updateExtensionState(extensionId: string, enabled: boolean): Promise<void> {
    try {
      await reduxService.dispatch({
        type: 'extensions/updateExtensionState',
        payload: {
          extensionId,
          enabled
        }
      })
    } catch (error) {
      Logger.error(`Failed to update extension state: ${extensionId}`, error)
      throw error
    }
  }

  public async loadExtension(_: Electron.IpcMainInvokeEvent, extensionId: string): Promise<void> {
    if (!this.mainSession) {
      throw new Error('Session not initialized')
    }

    const extension = await installExtension(extensionId, {
      session: this.mainSession,
      extensionsPath: this.extensionsPath || undefined
    })
    await loadManifestV3(extension, this.mainSession)
    await this.updateExtensionState(extensionId, true)
  }

  public async unloadExtension(_: Electron.IpcMainInvokeEvent, extensionId: string): Promise<void> {
    try {
      this.mainSession.removeExtension(extensionId)
      Logger.info('[Extension] Extension unloaded:', extensionId)
      await this.updateExtensionState(extensionId, false)
    } catch (error) {
      Logger.error('[Extension] Failed to unload extension:', extensionId, ':', error)
      throw error
    }
  }

  // 设置本地扩展目录
  private async setupLocalExtensionsDirectory(): Promise<void> {
    try {
      const localExtensionsPath = path.join(app.getPath('userData'), 'extensions')
      fs.mkdirSync(localExtensionsPath, { recursive: true })

      Logger.info('[Extension] Local extensions directory:', localExtensionsPath)

      // 尝试加载目录中已存在的扩展
      try {
        const extensions = await this.listExtensions()

        if (extensions.length > 0) {
          Logger.info('[Extension] Found', extensions.length, 'extensions, attempting to load...')

          for (const ext of extensions) {
            const isEnabled = ext.enabled
            if (isEnabled) {
              try {
                const extension = await this.mainSession.loadExtension(ext.path, { allowFileAccess: true })
                await loadManifestV3(extension, this.mainSession)
                Logger.info('[Extension] Loaded extension', extension.manifest, extension.id)
              } catch (err) {
                Logger.error('[Extension] Failed to load extension from', ext.path, ':', err)
              }
            }
          }
        }
      } catch (error) {
        // If Redux is not available yet, just log and continue
        Logger.warn('[Extension] Could not load extensions from Redux store:', error)
      }
    } catch (error) {
      Logger.error('[Extension] Failed to setup local extensions directory:', error)
    }
  }

  public addWindowAsTab(browserWindow: BrowserWindow): void {
    if (
      !this.extensions ||
      !browserWindow ||
      browserWindow.isDestroyed() ||
      !browserWindow.webContents ||
      browserWindow.webContents.isDestroyed()
    ) {
      return
    }

    Logger.info('[Extension] Adding window as tab:', browserWindow.id, browserWindow.webContents.id)

    // 判断是否是扩展窗口
    if (this.extensionWindow && browserWindow.id === this.extensionWindow.id) {
      // 如果是扩展窗口，不需要做额外处理，因为标签页由Tabs类管理
      Logger.info('[Extension] Window is extension window, managed by Tabs class')
    } else {
      // 如果是其他窗口，添加到ElectronChromeExtensions的标签系统
      this.extensions.addTab(browserWindow.webContents, browserWindow)
    }
  }

  // 将窗口选择为活动标签页
  public selectWindowAsTab(browserWindow: BrowserWindow): void {
    if (
      !this.extensions ||
      !browserWindow ||
      browserWindow.isDestroyed() ||
      !browserWindow.webContents ||
      browserWindow.webContents.isDestroyed()
    ) {
      return
    }

    Logger.info('[Extension] Selecting window as tab:', browserWindow.id, browserWindow.webContents.id)

    // 判断是否是扩展窗口
    if (this.extensionWindow && browserWindow.id === this.extensionWindow.id) {
      // 如果是扩展窗口，由Tabs类处理选择
      Logger.info('[Extension] Window is extension window, selection managed by Tabs class')
      // We might still need to inform our Tabs manager if the window gets focus
      const tab = this.tabs?.getByWebContents(browserWindow.webContents)
      if (tab) {
        this.tabs?.select(tab.id)
      }
    } else {
      // 如果是其他窗口 (including main window now), 选择对应的标签页
      this.extensions.selectTab(browserWindow.webContents)
    }
  }

  public async openChromeWebStore(
    _: Electron.IpcMainInvokeEvent,
    chromeWebStoreOptions: ChromeWebStoreOptions
  ): Promise<void> {
    try {
      // 只在第一次初始化
      if (!this.chromeWebStoreInitialized) {
        await installChromeWebStore({
          ...chromeWebStoreOptions,
          session: this.mainSession,
          extensionsPath: this.extensionsPath
        })
        this.chromeWebStoreInitialized = true
      }

      // 使用标签页系统加载Chrome Web Store URL
      await this.createExtensionTab({ url: CHROME_WEB_STORE_URL, active: true })
    } catch (error) {
      Logger.error('[Extension] Failed to open Chrome Web Store:', error)
      throw error
    }
  }

  public async installExtension(
    _: Electron.IpcMainInvokeEvent | undefined,
    options: InstallExtensionOptions
  ): Promise<Extension> {
    try {
      const extension = await installExtension(options.extensionId, {
        session: this.mainSession,
        extensionsPath: this.extensionsPath,
        loadExtensionOptions: {
          allowFileAccess: options.allowFileAccess ?? false
        }
      })

      Logger.info('[Extension] Extension installed:', extension.name || options.extensionId)
      this.emit(ExtensionEvent.INSTALLED, extension)

      return this.mapElectronExtension(extension)
    } catch (error: any) {
      Logger.error('[Extension] Failed to install extension:', error)
      throw error
    }
  }

  public async uninstallExtension(_: Electron.IpcMainInvokeEvent, extensionId: string): Promise<void> {
    try {
      await uninstallExtension(extensionId, { session: this.mainSession })
      Logger.info('[Extension] Extension uninstalled:', extensionId)
      fs.promises.rm(path.join(this.extensionsPath, extensionId), { recursive: true, force: true })
      this.emit(ExtensionEvent.UNINSTALLED, extensionId)
    } catch (error: any) {
      Logger.error('[Extension] Failed to uninstall extension:', error)
      throw error
    }
  }

  public async updateExtensions(): Promise<void> {
    try {
      // Notify loading state
      this.broadcastToAllWindows('extension-loading', true)

      await updateExtensions(this.mainSession)
      this.emit(ExtensionEvent.UPDATED)

      // Get all current extensions from Redux
      const currentExtensions = await this.listExtensions()

      // Get updated extensions from Chrome store
      const updatedStoreExtensions = await Promise.all(
        this.mainSession
          .getAllExtensions()
          .filter((ext) => ext.manifest.key)
          .map(async (ext) => {
            const oldExtension = await this.getExtension(ext.id)
            return {
              ...oldExtension,
              id: ext.id,
              name: ext.manifest.name,
              version: ext.manifest.version,
              path: ext.path,
              source: 'store',
              enabled: oldExtension?.enabled ?? false
            }
          })
      )

      // Create a map of extension IDs for quick lookup
      const updatedExtensionIds = new Set(updatedStoreExtensions.map((ext) => ext.id))

      // Keep all extensions that weren't updated (unpacked extensions) and add the updated ones
      const allExtensions = [
        ...currentExtensions.filter((ext) => !updatedExtensionIds.has(ext.id)),
        ...updatedStoreExtensions
      ]

      // Update Redux store with extensions only
      await reduxService.dispatch({
        type: 'extensions/setExtensions',
        payload: allExtensions
      })

      // Notify loading complete
      this.broadcastToAllWindows('extension-loading', false)

      Logger.info('[Extension] Updated extensions in Redux store')
    } catch (error: any) {
      Logger.error('[Extension] Failed to update extensions:', error)
      // Notify error state
      this.broadcastToAllWindows('extension-error', 'Failed to update extensions')
      this.broadcastToAllWindows('extension-loading', false)
      throw error
    }
  }

  public async openPopup(
    invokingEvent: Electron.IpcMainInvokeEvent,
    extensionId: string,
    rect: { x: number; y: number; width: number; height: number }
  ): Promise<void> {
    if (!this.extensions) {
      Logger.error('[ExtensionService] Extensions instance not initialized.')
      throw new Error('Extensions instance not initialized.')
    }

    const browserActionApi = (this.extensions as any).api?.browserAction
    const router = (this.extensions as any).ctx?.router
    const store = (this.extensions as any).ctx?.store

    if (!browserActionApi || !router || !store) {
      Logger.error('[ExtensionService] Internal API components (browserAction, router, store) not found.')
      throw new Error('Internal API components not found.')
    }

    const hostWindow = BrowserWindow.fromWebContents(invokingEvent.sender)
    if (!hostWindow || hostWindow.isDestroyed()) {
      Logger.error('[ExtensionService] Could not find the host window for openPopup.')
      throw new Error('Host window not found or destroyed.')
    }

    Logger.info(
      `[ExtensionService] Attempting to open popup for ${extensionId} from WinID: ${hostWindow.webContents.id}`
    )

    const popupUrl = browserActionApi.getPopupUrl(extensionId, hostWindow.webContents.id)

    if (popupUrl) {
      Logger.info(`[ExtensionService] Found popup URL: ${popupUrl}`)
      try {
        browserActionApi.activateClick({
          eventType: 'click',
          extensionId,
          tabId: hostWindow.webContents.id,
          anchorRect: rect,
          alignment: 'right'
        })
      } catch (error) {
        Logger.error('[ExtensionService] Failed to create popup:', error)
        throw error
      }
    } else {
      Logger.info(`[ExtensionService] No popup URL configured for ${extensionId}. Triggering onClicked.`)
    }
  }

  /**
   * 将 Electron 的 Extension 对象映射为内部的 Extension 类型
   */
  private mapElectronExtension(electronExt: Electron.Extension): Extension {
    const iconPath = this.getExtensionIconPath(electronExt)

    return {
      id: electronExt.id,
      name: electronExt.manifest.name,
      description: electronExt.manifest.description,
      version: electronExt.manifest.version,
      permissions: electronExt.manifest.permissions,
      icon: iconPath,
      path: electronExt.path,
      enabled: true,
      isDev: !!electronExt.manifest.devtools_page,
      source: electronExt.manifest.key ? 'store' : 'unpacked'
    }
  }

  /**
   * 辅助函数：获取扩展图标的 Data URI
   */
  // private getExtensionIconDataUri(extension: Electron.Extension): string | undefined {
  //   if (!extension.manifest.icons) {
  //     return undefined
  //   }
  //   // Get the first available icon size
  //   const iconSizes = Object.keys(extension.manifest.icons)
  //   const iconSize = iconSizes.length > 0 ? extension.manifest.icons[iconSizes[0]] : undefined
  //   return `crx://extension-icon/${extension.id}/${iconSize}/2`
  // }

  /**
   * 辅助函数：获取扩展图标路径 (保持此函数，可能在其他地方有用)
   */
  private getExtensionIconPath(extension: Electron.Extension): string | undefined {
    if (!extension.manifest.icons) {
      return undefined
    }

    const sizes = Object.keys(extension.manifest.icons)
      .map(Number)
      .sort((a, b) => a - b)
    const bestSize = sizes.find((size) => size >= 16) // 找一个合适的尺寸，比如 >= 16
    if (bestSize) {
      const iconPath = extension.manifest.icons[bestSize.toString()]
      // Ensure iconPath doesn't start with / if extension.id already provides the root
      const cleanIconPath = iconPath.startsWith('/') ? iconPath.substring(1) : iconPath
      Logger.info(
        '[Extension Service] Extension',
        extension.name,
        'icon path:',
        `chrome-extension://${extension.id}/${cleanIconPath}`
      )
      return `chrome-extension://${extension.id}/${cleanIconPath}`
    }
    return undefined
  }

  /**
   * Setup event listeners for extension-related events
   */
  private setupEventListeners(): void {
    Logger.info('[Extension] Setting up event listeners for ExtensionService')

    if (this.extensions) {
      // 监听扩展弹出窗口创建事件
      this.extensions.on('browser-action-popup-created', (popup) => {
        Logger.info('[Extension] Browser action popup created')
        this.emit('browser-action-popup-created', popup)
      })

      // 监听 URL 覆盖更新事件
      this.extensions.on('url-overrides-updated', (urlOverrides) => {
        Logger.info('[Extension] URL overrides updated:', urlOverrides)
        this.emit('url-overrides-updated', urlOverrides)
      })
    }

    // 不再将主窗口添加为标签页，这会导致关闭扩展窗口时主窗口也被关闭
    // 主窗口和扩展窗口应该是独立的

    // 监听 Session 的 'extension-loaded' 事件
    this.mainSession.on('extension-loaded', async (_event, extension) => {
      Logger.info(
        `[Extension] Session detected extension loaded: ${extension.name} (ID: ${extension.id}) Path: ${extension.path}`
      )
      try {
        // 检查扩展是否来自我们的管理目录（可选，但推荐）
        if (!extension.path.startsWith(this.extensionsPath)) {
          Logger.warn(
            `[Extension] Loaded extension ${extension.id} is outside the managed path. Ignoring for state update.`
          )
          return // 如果只想管理特定目录下的扩展，可以取消注释
        }
        const mappedExtension = this.mapElectronExtension(extension)

        // 检查 Redux 中是否已存在该扩展 (防止重复添加)
        const existingExtensions = await this.listExtensions()
        const alreadyExists = existingExtensions.some((ext) => ext.id === mappedExtension.id)

        if (!alreadyExists) {
          Logger.info(`[Extension] Adding new extension to Redux store: ${mappedExtension.name}`)
          // 更新 Redux 状态
          await reduxService.dispatch({
            type: 'extensions/addExtension',
            payload: mappedExtension
          })

          this.emit(ExtensionEvent.INSTALLED, mappedExtension)
        }
      } catch (error) {
        Logger.error(`[Extension] Error processing loaded extension ${extension.id}:`, error)
      }
    })

    // 监听 Session 的 'extension-unloaded' 事件 (对应卸载或禁用)
    this.mainSession.on('extension-unloaded', async (_event, extension) => {
      Logger.info(`[Extension] Session detected extension unloaded: ${extension.name} (ID: ${extension.id})`)
      try {
        // 从 Redux 状态中移除 (或标记为 disabled)
        // 注意：直接卸载可能需要用 uninstallExtension 处理文件删除，
        // 这里只处理 session 级别的卸载事件
        await reduxService.dispatch({
          type: 'extensions/removeExtension',
          payload: extension.id
        })
        // 触发内部 UNINSTALLED 事件
        this.emit(ExtensionEvent.UNINSTALLED, extension.id)
      } catch (error) {
        Logger.error(`[Extension] Error processing unloaded extension ${extension.id}:`, error)
      }
    })

    this.on(ExtensionEvent.INSTALLED, (extension) => {
      Logger.info('[Extension] Broadcasting extension installed event:', extension?.name || 'unknown')
      this.broadcastToAllWindows('extension-installed', extension)
      this.broadcastToAllWindows('extension-loading', false)
    })

    this.on(ExtensionEvent.UNINSTALLED, (extensionId) => {
      Logger.info('[Extension] Broadcasting extension uninstalled event:', extensionId || 'unknown')
      this.broadcastToAllWindows('extension-uninstalled', extensionId)
      this.broadcastToAllWindows('extension-loading', false)
    })

    this.on(ExtensionEvent.UPDATED, () => {
      Logger.info('[Extension] Broadcasting extension updated event')
      this.broadcastToAllWindows('extension-updated')
      this.broadcastToAllWindows('extension-loading', false)
    })
  }

  /**
   * Broadcast a message to all windows
   */
  private broadcastToAllWindows(channel: string, ...args: any[]): void {
    const windows = BrowserWindow.getAllWindows()
    windows.forEach((win) => {
      if (!win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
        win.webContents.send(channel, ...args)
      }
    })
  }

  /**
   * Enable an extension
   */
  public async enableExtension(extensionId: string): Promise<void> {
    try {
      if (!this.mainSession) {
        throw new Error('Session not initialized')
      }

      // Electron doesn't have direct enableExtension method, so we need to use a workaround
      // Get the extension and re-load it if it exists
      const extensions = this.mainSession.getAllExtensions()
      const extension = extensions.find((ext) => ext.id === extensionId)

      if (extension) {
        Logger.info('[Extension] Re-enabling extension:', extensionId)
        // We can't directly enable, so we'll reload it
        const extPath = extension.path
        await this.mainSession.loadExtension(extPath, { allowFileAccess: true })
        Logger.info('[Extension] Extension enabled:', extensionId)
        this.emit(ExtensionEvent.ENABLED, extensionId)
      } else {
        Logger.warn('[Extension] Extension not found for enabling:', extensionId)
        throw new Error(`Extension not found: ${extensionId}`)
      }
    } catch (error: any) {
      Logger.error('[Extension] Failed to enable extension', extensionId, ':', error)
      throw error
    }
  }

  /**
   * Disable an extension
   */
  public async disableExtension(extensionId: string): Promise<void> {
    try {
      if (!this.mainSession) {
        throw new Error('Session not initialized')
      }

      // Electron has removeExtension method which effectively disables it
      this.mainSession.removeExtension(extensionId)
      Logger.info('[Extension] Extension disabled:', extensionId)
      this.emit(ExtensionEvent.DISABLED, extensionId)
    } catch (error: any) {
      Logger.error('[Extension] Failed to disable extension', extensionId, ':', error)
      throw error
    }
  }

  /**
   * Explicitly register a host window (like the main window) with electron-chrome-extensions.
   * This ensures the library is aware of the window for context lookups.
   * @param browserWindow The host window to register.
   */
  public registerHostWindow(browserWindow: BrowserWindow): void {
    if (!this.extensions) {
      Logger.warn('[ExtensionService] Cannot register host window: Extensions not initialized.')
      return
    }
    if (
      !browserWindow ||
      browserWindow.isDestroyed() ||
      !browserWindow.webContents ||
      browserWindow.webContents.isDestroyed()
    ) {
      Logger.warn('[ExtensionService] Cannot register host window: Invalid window or webContents.')
      return
    }

    Logger.info(
      `[ExtensionService] Registering host window (ID: ${browserWindow.id}, WCID: ${browserWindow.webContents.id}) with electron-chrome-extensions`
    )
    try {
      // Add the window and its webContents to the internal tracking
      this.extensions.addTab(browserWindow.webContents, browserWindow)
      // Select it initially if no other tab is actively selected by the library internally
      // Note: This might conflict if an extension immediately opens a tab. Consider if initial selection is always desired.
      this.extensions.selectTab(browserWindow.webContents)
    } catch (error) {
      Logger.error(`[ExtensionService] Failed to register host window (ID: ${browserWindow.id}):`, error)
    }
  }

  /**
   * Explicitly select the tab corresponding to a host window in electron-chrome-extensions.
   * Call this when the host window gains focus.
   * @param browserWindow The host window to select.
   */
  public selectHostWindowTab(browserWindow: BrowserWindow): void {
    if (!this.extensions) {
      // Silently return if not initialized, as focus events might fire early
      return
    }
    if (
      !browserWindow ||
      browserWindow.isDestroyed() ||
      !browserWindow.webContents ||
      browserWindow.webContents.isDestroyed()
    ) {
      // Silently return for invalid windows
      return
    }

    // Avoid logging spam on every focus, uncomment if needed for debugging
    // Logger.info(`[ExtensionService] Selecting host window tab (ID: ${browserWindow.id}, WCID: ${browserWindow.webContents.id}) in electron-chrome-extensions`)
    try {
      this.extensions.selectTab(browserWindow.webContents)
    } catch (error) {
      // Log error if selection fails, might indicate the tab wasn't registered
      Logger.error(`[ExtensionService] Failed to select host window tab (ID: ${browserWindow.id}):`, error)
    }
  }
}

export const extensionService = ExtensionService.getInstance()
