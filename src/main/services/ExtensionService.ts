import { windowService } from '@main/services/WindowService'
import { loadManifestV3 } from '@main/utils/extension'
import { CHROME_WEB_STORE_URL } from '@shared/config/constant'
import { ChromeWebStoreOptions, Extension, InstallExtensionOptions } from '@shared/config/types'
import { app, BrowserWindow, ContextMenuParams, MenuItemConstructorOptions, session, WebContents } from 'electron'
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

  private constructor() {
    super()
    this.openChromeWebStore = this.openChromeWebStore.bind(this)
    this.installExtension = this.installExtension.bind(this)
    this.uninstallExtension = this.uninstallExtension.bind(this)
    this.updateExtensions = this.updateExtensions.bind(this)
    this.loadExtension = this.loadExtension.bind(this)
    this.unloadExtension = this.unloadExtension.bind(this)
  }

  get getExtensionsPath(): string {
    return this.extensionsPath
  }

  public static getInstance(): ExtensionService {
    if (!ExtensionService.instance) {
      ExtensionService.instance = new ExtensionService()
    }
    return ExtensionService.instance
  }

  public async initialize(): Promise<{ success: boolean; error?: unknown }> {
    if (this.extensions) {
      Logger.warn('[Extension] ExtensionService already initialized.')
      return { success: true }
    }

    // Initialize session and paths here, after app is ready
    this.mainSession = session.defaultSession
    this.extensionsPath = path.join(app.getPath('userData'), 'extensions', 'local')

    Logger.info('[Extension] Initializing ElectronChromeExtensions...')

    try {
      // 创建扩展配置
      const extensionOptions: ChromeExtensionOptions = {
        license: 'GPL-3.0',
        session: this.mainSession,
        createTab: async (details) => {
          Logger.info('[Extension API] createTab request:', details)

          // 如果是扩展相关的URL，使用扩展窗口
          const win = windowService.createExtensionWindow()

          if (details.url) {
            // Load the requested URL once window is ready
            win.webContents.once('did-finish-load', () => {
              if (!win.isDestroyed()) {
                win.loadURL(details.url as string)
              }
            })
          }

          // Focus the new window if requested
          if (details.active !== false) {
            win.focus()
          }

          return [win.webContents, win]
        },

        selectTab: (targetWebContents: WebContents, browserWindow: BrowserWindow) => {
          Logger.info('[Extension API] selectTab request for wcId:', targetWebContents.id)
          if (browserWindow && !browserWindow.isDestroyed()) {
            browserWindow.focus()
          }
        },

        removeTab: (targetWebContents: WebContents, browserWindow: BrowserWindow) => {
          Logger.info('[Extension API] removeTab request for wcId:', targetWebContents.id)
          if (browserWindow && !browserWindow.isDestroyed()) {
            browserWindow.close()
          }
        },

        createWindow: async (details) => {
          Logger.info('[Extension API] createWindow request:', details)

          // 判断是否是扩展相关的URL
          const isExtensionUrl =
            details.url &&
            (details.url.includes('chrome-extension://') ||
              details.url.includes('chrome.google.com/webstore') ||
              details.url.includes('chrome://extensions'))

          // 如果是扩展相关的URL，使用扩展窗口
          const win = isExtensionUrl ? windowService.createExtensionWindow() : windowService.createMainWindow()

          if (details.url) {
            win.webContents.once('did-finish-load', () => {
              if (!win.isDestroyed()) {
                win.loadURL(details.url as string)
              }
            })
          }

          if (details.focused !== false) {
            win.focus()
          }

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
          Logger.info('[Extension API] removeWindow request for winId:', browserWindow.id)
          if (!browserWindow.isDestroyed()) {
            browserWindow.close()
          }
        }
      }

      this.extensions = new ElectronChromeExtensions(extensionOptions)

      Logger.info('[Extension] ElectronChromeExtensions initialized successfully')

      // 设置本地扩展目录
      await this.setupLocalExtensionsDirectory()

      // 设置事件监听器
      this.setupEventListeners()

      return { success: true }
    } catch (error) {
      Logger.error('[Extension] Failed to initialize ElectronChromeExtensions:', error)
      return { success: false, error }
    }
  }

  private async listExtensions(): Promise<Extension[]> {
    try {
      return (await reduxService.select('state.extensions.extensions')) ?? []
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
      const localExtensionsPath = path.join(app.getPath('userData'), 'extensions', 'local')
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
                Logger.info('[Extension] Loaded extension from:', ext.path)
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

  // 将窗口添加为标签页
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
    this.extensions.addTab(browserWindow.webContents, browserWindow)
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
    this.extensions.selectTab(browserWindow.webContents)
  }

  // 获取扩展的上下文菜单项
  public getContextMenuItems(webContents: WebContents, params: ContextMenuParams): MenuItemConstructorOptions[] {
    if (!this.extensions) {
      return []
    }

    try {
      // 获取菜单项并将类型转换为MenuItemConstructorOptions[]
      // 注意：这里的类型转换可能会引起类型不匹配问题，但在实际运行时应该是正常的
      return this.extensions.getContextMenuItems(webContents, params) as unknown as MenuItemConstructorOptions[]
    } catch (error) {
      Logger.error('[Extension] Error getting extension context menu items:', error)
      return []
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

      // 使用WindowService加载Chrome Web Store URL
      windowService.loadURLInExtensionWindow(CHROME_WEB_STORE_URL)
    } catch (error) {
      Logger.error('[Extension] Failed to open Chrome Web Store:', error)
      throw error
    }
  }

  public async installExtension(_: Electron.IpcMainInvokeEvent, options: InstallExtensionOptions): Promise<Extension> {
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

      return {
        id: extension.id,
        name: extension.manifest.name,
        description: extension.manifest.description,
        version: extension.manifest.version,
        icon: extension.manifest.icons?.[0]?.url,
        path: extension.path,
        enabled: true,
        source: extension.manifest.key ? 'store' : 'unpacked'
      }
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

  /**
   * Setup event listeners for extension-related events
   */
  private setupEventListeners(): void {
    Logger.info('[Extension] Setting up event listeners for ExtensionService')

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
}

export const extensionService = ExtensionService.getInstance()
