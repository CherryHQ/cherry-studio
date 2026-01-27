import { is } from '@electron-toolkit/utils'
import { titleBarOverlayDark, titleBarOverlayLight } from '@main/config'
import { isMac } from '@main/constant'
import { IpcChannel } from '@shared/IpcChannel'
import { BrowserWindow, ipcMain, nativeImage, nativeTheme, shell } from 'electron'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'

import icon from '../../../build/icon.png?asset'
import { loggerService } from './LoggerService'
import { windowService } from './WindowService'

const logger = loggerService.withContext('DetachedWindowManager')

interface TabDragData {
  id: string
  url: string
  title: string
  type: string
  isPinned?: boolean
}

export class DetachedWindowManager {
  private windows: Map<string, BrowserWindow> = new Map()

  // Tab 拖拽缓存
  private dragCache: Map<string, TabDragData> = new Map()
  private tempDir: string

  constructor() {
    // 初始化临时目录
    this.tempDir = join(os.tmpdir(), 'cherry-studio-drag')
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true })
    }
    this.registerIpc()
  }

  private registerIpc() {
    ipcMain.on(IpcChannel.Tab_Detach, (_, payload) => {
      this.createWindow(payload)
    })

    ipcMain.handle(IpcChannel.Tab_Attach, (_, payload) => {
      const mainWindow = windowService.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IpcChannel.Tab_Attach, payload)
      }
    })

    // Tab 拖拽开始
    ipcMain.on(IpcChannel.Tab_DragStart, (event, tabData: TabDragData) => {
      const dragId = `${Date.now()}-${tabData.id}`
      logger.info('Tab drag start', { dragId, tabId: tabData.id })

      // 1. 缓存 Tab 数据
      this.dragCache.set(dragId, tabData)

      // 2. 创建临时文件（startDrag 需要真实文件路径）
      const tempFile = join(this.tempDir, `tab-${dragId}.json`)
      fs.writeFileSync(tempFile, JSON.stringify({ dragId, tabId: tabData.id }))

      // 3. 创建 Ghost Image（Tab 预览图）
      const dragIcon = this.createTabIcon()

      // 4. 调用 startDrag - 操作系统接管拖拽
      event.sender.startDrag({
        file: tempFile,
        icon: dragIcon
      })

      // 5. 广播给其他窗口（用于显示 Drop 指示器）
      BrowserWindow.getAllWindows().forEach((win) => {
        if (win.webContents.id !== event.sender.id && !win.isDestroyed()) {
          win.webContents.send(IpcChannel.Tab_DragStart, { dragId, tab: tabData })
        }
      })
    })

    // 获取拖拽数据
    ipcMain.handle(IpcChannel.Tab_GetDragData, (_, dragId: string) => {
      const data = this.dragCache.get(dragId)
      logger.info('Get drag data', { dragId, found: !!data })
      return data || null
    })

    // 拖拽结束
    ipcMain.on(IpcChannel.Tab_DragEnd, (_, dragId: string) => {
      logger.info('Tab drag end', { dragId })

      // 清理缓存
      this.dragCache.delete(dragId)

      // 清理临时文件
      const tempFile = join(this.tempDir, `tab-${dragId}.json`)
      if (fs.existsSync(tempFile)) {
        try {
          fs.unlinkSync(tempFile)
        } catch (err) {
          logger.error('Failed to delete temp file', { tempFile, error: err })
        }
      }

      // 通知所有窗口退出接收模式
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send(IpcChannel.Tab_DragEnd)
        }
      })
    })
  }

  /**
   * 创建 Tab 拖拽时的 Ghost Image
   * 使用应用图标作为基础，后续可优化为动态生成 Tab 预览
   */
  private createTabIcon(): Electron.NativeImage {
    try {
      // 使用应用图标
      const iconImage = nativeImage.createFromPath(icon)
      return iconImage.resize({ width: 32, height: 32 })
    } catch (err) {
      logger.error('Failed to create tab icon', { error: err })
      // 返回空图标
      return nativeImage.createEmpty()
    }
  }

  public createWindow(payload: any) {
    const { id: tabId, url, title, isPinned, type } = payload

    // 基础参数构建
    const params = new URLSearchParams({
      url,
      tabId,
      title: title || '',
      type: type || 'route',
      isPinned: String(!!isPinned)
    })

    const win = new BrowserWindow({
      width: 800,
      height: 600,
      minWidth: 400,
      minHeight: 300,
      show: false, // Wait for ready-to-show
      autoHideMenuBar: true,
      title: title || 'Cherry Studio Tab',
      icon,
      transparent: false,
      vibrancy: 'sidebar',
      visualEffectState: 'active',
      // For Windows and Linux, we use frameless window with custom controls
      // For Mac, we keep the native title bar style
      ...(isMac
        ? {
            titleBarStyle: 'hidden',
            titleBarOverlay: nativeTheme.shouldUseDarkColors ? titleBarOverlayDark : titleBarOverlayLight,
            trafficLightPosition: { x: 8, y: 13 }
          }
        : {
            frame: false // Frameless window for Windows and Linux
          }),
      backgroundColor: isMac ? undefined : nativeTheme.shouldUseDarkColors ? '#181818' : '#FFFFFF',
      darkTheme: nativeTheme.shouldUseDarkColors,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        webSecurity: false, // 根据需求调整
        webviewTag: true,
        backgroundThrottling: false
      }
    })

    // 加载 detachedWindow.html
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/detachedWindow.html?${params.toString()}`)
    } else {
      win.loadFile(join(__dirname, '../renderer/detachedWindow.html'), {
        search: params.toString()
      })
    }

    win.on('ready-to-show', () => {
      win.show()
    })

    // 处理窗口打开链接
    win.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    win.on('closed', () => {
      this.windows.delete(tabId)
    })

    this.windows.set(tabId, win)
    logger.info(`Created detached window for tab ${tabId}`, payload)

    return win
  }
}

export const detachedWindowManager = new DetachedWindowManager()
