import fs from 'node:fs'
import path from 'node:path'

import { Shortcut, ThemeMode } from '@types'
import { BrowserWindow, ipcMain, ProxyConfig, session, shell } from 'electron'
import log from 'electron-log'

import { titleBarOverlayDark, titleBarOverlayLight } from './config'
import AppUpdater from './services/AppUpdater'
import BackupManager from './services/BackupManager'
import { configManager } from './services/ConfigManager'
import { ExportService } from './services/ExportService'
import FileService from './services/FileService'
import FileStorage from './services/FileStorage'
import { GeminiService } from './services/GeminiService'
import KnowledgeService from './services/KnowledgeService'
import { registerShortcuts, unregisterAllShortcuts } from './services/ShortcutService'
import { TrayService } from './services/TrayService'
import { windowService } from './services/WindowService'
import { getResourcePath } from './utils'
import { decrypt } from './utils/aes'
import { encrypt } from './utils/aes'
import { compress, decompress } from './utils/zip'

const fileManager = new FileStorage()
const backupManager = new BackupManager()
const exportService = new ExportService(fileManager)

export function registerIpc(mainWindow: BrowserWindow, app: Electron.App) {
  const { autoUpdater } = new AppUpdater(mainWindow)

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    filesPath: path.join(app.getPath('userData'), 'Data', 'Files'),
    appDataPath: app.getPath('userData'),
    resourcesPath: getResourcePath(),
    logsPath: log.transports.file.getFile().path
  }))

  ipcMain.handle('app:proxy', async (_, proxy: string) => {
    const sessions = [session.defaultSession, session.fromPartition('persist:webview')]
    const proxyConfig: ProxyConfig = proxy === 'system' ? { mode: 'system' } : proxy ? { proxyRules: proxy } : {}
    await Promise.all(sessions.map((session) => session.setProxy(proxyConfig)))
  })

  ipcMain.handle('app:reload', () => mainWindow.reload())
  ipcMain.handle('open:website', (_, url: string) => shell.openExternal(url))

  // language
  ipcMain.handle('app:set-language', (_, language) => {
    configManager.setLanguage(language)
  })

  // tray
  ipcMain.handle('app:set-tray', (_, isActive: boolean) => {
    configManager.setTray(isActive)
  })

  ipcMain.handle('app:restart-tray', () => TrayService.getInstance().restartTray())

  ipcMain.handle('config:set', (_, key: string, value: any) => {
    configManager.set(key, value)
  })

  ipcMain.handle('config:get', (_, key: string) => {
    return configManager.get(key)
  })

  // theme
  ipcMain.handle('app:set-theme', (_, theme: ThemeMode) => {
    configManager.setTheme(theme)
    mainWindow?.setTitleBarOverlay &&
      mainWindow.setTitleBarOverlay(theme === 'dark' ? titleBarOverlayDark : titleBarOverlayLight)
  })

  // clear cache
  ipcMain.handle('app:clear-cache', async () => {
    const sessions = [session.defaultSession, session.fromPartition('persist:webview')]

    try {
      await Promise.all(
        sessions.map(async (session) => {
          await session.clearCache()
          await session.clearStorageData({
            storages: ['cookies', 'filesystem', 'shadercache', 'websql', 'serviceworkers', 'cachestorage']
          })
        })
      )
      await fileManager.clearTemp()
      await fs.writeFileSync(log.transports.file.getFile().path, '')
      return { success: true }
    } catch (error: any) {
      log.error('Failed to clear cache:', error)
      return { success: false, error: error.message }
    }
  })

  // check for update
  ipcMain.handle('app:check-for-update', async () => {
    const update = await autoUpdater.checkForUpdates()
    return {
      currentVersion: autoUpdater.currentVersion,
      updateInfo: update?.updateInfo
    }
  })

  // zip
  ipcMain.handle('zip:compress', (_, text: string) => compress(text))
  ipcMain.handle('zip:decompress', (_, text: Buffer) => decompress(text))

  // backup
  ipcMain.handle('backup:backup', backupManager.backup)
  ipcMain.handle('backup:restore', backupManager.restore)
  ipcMain.handle('backup:backupToWebdav', backupManager.backupToWebdav)
  ipcMain.handle('backup:restoreFromWebdav', backupManager.restoreFromWebdav)

  // file
  ipcMain.handle('file:open', fileManager.open)
  ipcMain.handle('file:openPath', fileManager.openPath)
  ipcMain.handle('file:save', fileManager.save)
  ipcMain.handle('file:select', fileManager.selectFile)
  ipcMain.handle('file:upload', fileManager.uploadFile)
  ipcMain.handle('file:clear', fileManager.clear)
  ipcMain.handle('file:read', fileManager.readFile)
  ipcMain.handle('file:delete', fileManager.deleteFile)
  ipcMain.handle('file:get', fileManager.getFile)
  ipcMain.handle('file:selectFolder', fileManager.selectFolder)
  ipcMain.handle('file:create', fileManager.createTempFile)
  ipcMain.handle('file:write', fileManager.writeFile)
  ipcMain.handle('file:saveImage', fileManager.saveImage)
  ipcMain.handle('file:base64Image', fileManager.base64Image)
  ipcMain.handle('file:download', fileManager.downloadFile)
  ipcMain.handle('file:copy', fileManager.copyFile)
  ipcMain.handle('file:binaryFile', fileManager.binaryFile)

  // fs
  ipcMain.handle('fs:read', FileService.readFile)

  // minapp
  ipcMain.handle('minapp', (_, args) => {
    windowService.createMinappWindow({
      url: args.url,
      parent: mainWindow,
      windowOptions: {
        ...mainWindow.getBounds(),
        ...args.windowOptions
      }
    })
  })

  // export
  ipcMain.handle('export:word', exportService.exportToWord)

  // open path
  ipcMain.handle('open:path', async (_, path: string) => {
    await shell.openPath(path)
  })

  // shortcuts
  ipcMain.handle('shortcuts:update', (_, shortcuts: Shortcut[]) => {
    configManager.setShortcuts(shortcuts)
    // Refresh shortcuts registration
    if (mainWindow) {
      unregisterAllShortcuts()
      registerShortcuts(mainWindow)
    }
  })

  // knowledge base
  ipcMain.handle('knowledge-base:create', KnowledgeService.create)
  ipcMain.handle('knowledge-base:reset', KnowledgeService.reset)
  ipcMain.handle('knowledge-base:delete', KnowledgeService.delete)
  ipcMain.handle('knowledge-base:add', KnowledgeService.add)
  ipcMain.handle('knowledge-base:remove', KnowledgeService.remove)
  ipcMain.handle('knowledge-base:search', KnowledgeService.search)

  // window
  ipcMain.handle('window:set-minimum-size', (_, width: number, height: number) => {
    mainWindow?.setMinimumSize(width, height)
  })

  ipcMain.handle('window:reset-minimum-size', () => {
    mainWindow?.setMinimumSize(1080, 600)
    const [width, height] = mainWindow?.getSize() ?? [1080, 600]
    if (width < 1080) {
      mainWindow?.setSize(1080, height)
    }
  })

  // gemini
  ipcMain.handle('gemini:upload-file', GeminiService.uploadFile)
  ipcMain.handle('gemini:base64-file', GeminiService.base64File)
  ipcMain.handle('gemini:retrieve-file', GeminiService.retrieveFile)
  ipcMain.handle('gemini:list-files', GeminiService.listFiles)
  ipcMain.handle('gemini:delete-file', GeminiService.deleteFile)

  // mini window
  ipcMain.handle('miniwindow:show', () => windowService.showMiniWindow())
  ipcMain.handle('miniwindow:hide', () => windowService.hideMiniWindow())
  ipcMain.handle('miniwindow:close', () => windowService.closeMiniWindow())
  ipcMain.handle('miniwindow:toggle', () => windowService.toggleMiniWindow())

  // aes
  ipcMain.handle('aes:encrypt', (_, text: string, secretKey: string, iv: string) => encrypt(text, secretKey, iv))
  ipcMain.handle('aes:decrypt', (_, encryptedData: string, iv: string, secretKey: string) =>
    decrypt(encryptedData, iv, secretKey)
  )
}
