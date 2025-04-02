import fs from 'node:fs'

import { isMac, isWin } from '@main/constant'
import { getBinaryPath, isBinaryExists, runInstallScript } from '@main/utils/process'
import { Shortcut, ThemeMode } from '@types'
import { BrowserWindow, ipcMain, session, shell } from 'electron'
import log from 'electron-log'

import { titleBarOverlayDark, titleBarOverlayLight } from './config'
import AppUpdater from './services/AppUpdater'
import BackupManager from './services/BackupManager'
import { configManager } from './services/ConfigManager'
import CopilotService from './services/CopilotService'
import { ExportService } from './services/ExportService'
import FileService from './services/FileService'
import FileStorage from './services/FileStorage'
import { GeminiService } from './services/GeminiService'
import KnowledgeService from './services/KnowledgeService'
import mcpService from './services/MCPService'
import * as NutstoreService from './services/NutstoreService'
import ObsidianVaultService from './services/ObsidianVaultService'
import { ProxyConfig, proxyManager } from './services/ProxyManager'
import { registerShortcuts, unregisterAllShortcuts } from './services/ShortcutService'
import { TrayService } from './services/TrayService'
import { windowService } from './services/WindowService'
import { getResourcePath } from './utils'
import { decrypt, encrypt } from './utils/aes'
import { getFilesDir } from './utils/file'
import { compress, decompress } from './utils/zip'

const fileManager = new FileStorage()
const backupManager = new BackupManager()
const exportService = new ExportService(fileManager)
const obsidianVaultService = new ObsidianVaultService()

export function registerIpc(mainWindow: BrowserWindow, app: Electron.App) {
  const appUpdater = new AppUpdater(mainWindow)

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    filesPath: getFilesDir(),
    appDataPath: app.getPath('userData'),
    resourcesPath: getResourcePath(),
    logsPath: log.transports.file.getFile().path
  }))

  ipcMain.handle('app:proxy', async (_, proxy: string) => {
    let proxyConfig: ProxyConfig

    if (proxy === 'system') {
      proxyConfig = { mode: 'system' }
    } else if (proxy) {
      proxyConfig = { mode: 'custom', url: proxy }
    } else {
      proxyConfig = { mode: 'none' }
    }

    await proxyManager.configureProxy(proxyConfig)
  })

  ipcMain.handle('app:reload', () => mainWindow.reload())
  ipcMain.handle('open:website', (_, url: string) => shell.openExternal(url))

  // Update
  ipcMain.handle('app:show-update-dialog', () => appUpdater.showUpdateDialog(mainWindow))

  // language
  ipcMain.handle('app:set-language', (_, language) => {
    configManager.setLanguage(language)
  })

  // launch on boot
  ipcMain.handle('app:set-launch-on-boot', (_, openAtLogin: boolean) => {
    // Set login item settings for windows and mac
    // linux is not supported because it requires more file operations
    if (isWin || isMac) {
      app.setLoginItemSettings({ openAtLogin })
    }
  })

  // launch to tray
  ipcMain.handle('app:set-launch-to-tray', (_, isActive: boolean) => {
    configManager.setLaunchToTray(isActive)
  })

  // tray
  ipcMain.handle('app:set-tray', (_, isActive: boolean) => {
    configManager.setTray(isActive)
  })

  // to tray on close
  ipcMain.handle('app:set-tray-on-close', (_, isActive: boolean) => {
    configManager.setTrayOnClose(isActive)
  })

  ipcMain.handle('app:restart-tray', () => TrayService.getInstance().restartTray())

  ipcMain.handle('config:set', (_, key: string, value: any) => {
    configManager.set(key, value)
  })

  ipcMain.handle('config:get', (_, key: string) => {
    return configManager.get(key)
  })

  // theme
  ipcMain.handle('app:set-theme', (event, theme: ThemeMode) => {
    if (theme === configManager.getTheme()) return

    configManager.setTheme(theme)

    // should sync theme change to all windows
    const senderWindowId = event.sender.id
    const windows = BrowserWindow.getAllWindows()
    // 向其他窗口广播主题变化
    windows.forEach((win) => {
      if (win.webContents.id !== senderWindowId) {
        win.webContents.send('theme:change', theme)
      }
    })

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
    const update = await appUpdater.autoUpdater.checkForUpdates()
    return {
      currentVersion: appUpdater.autoUpdater.currentVersion,
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
  ipcMain.handle('backup:listWebdavFiles', backupManager.listWebdavFiles)
  ipcMain.handle('backup:checkConnection', backupManager.checkConnection)
  ipcMain.handle('backup:createDirectory', backupManager.createDirectory)

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
  ipcMain.handle('knowledge-base:rerank', KnowledgeService.rerank)

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
  ipcMain.handle('miniwindow:set-pin', (_, isPinned) => windowService.setPinMiniWindow(isPinned))

  // aes
  ipcMain.handle('aes:encrypt', (_, text: string, secretKey: string, iv: string) => encrypt(text, secretKey, iv))
  ipcMain.handle('aes:decrypt', (_, encryptedData: string, iv: string, secretKey: string) =>
    decrypt(encryptedData, iv, secretKey)
  )

  // Register MCP handlers
  ipcMain.handle('mcp:remove-server', mcpService.removeServer)
  ipcMain.handle('mcp:restart-server', mcpService.restartServer)
  ipcMain.handle('mcp:stop-server', mcpService.stopServer)
  ipcMain.handle('mcp:list-tools', mcpService.listTools)
  ipcMain.handle('mcp:call-tool', mcpService.callTool)
  ipcMain.handle('mcp:get-install-info', mcpService.getInstallInfo)

  ipcMain.handle('app:is-binary-exist', (_, name: string) => isBinaryExists(name))
  ipcMain.handle('app:get-binary-path', (_, name: string) => getBinaryPath(name))
  ipcMain.handle('app:install-uv-binary', () => runInstallScript('install-uv.js'))
  ipcMain.handle('app:install-bun-binary', () => runInstallScript('install-bun.js'))

  //copilot
  ipcMain.handle('copilot:get-auth-message', CopilotService.getAuthMessage)
  ipcMain.handle('copilot:get-copilot-token', CopilotService.getCopilotToken)
  ipcMain.handle('copilot:save-copilot-token', CopilotService.saveCopilotToken)
  ipcMain.handle('copilot:get-token', CopilotService.getToken)
  ipcMain.handle('copilot:logout', CopilotService.logout)
  ipcMain.handle('copilot:get-user', CopilotService.getUser)

  // Obsidian service
  ipcMain.handle('obsidian:get-vaults', () => {
    return obsidianVaultService.getVaults()
  })

  ipcMain.handle('obsidian:get-files', (_event, vaultName) => {
    return obsidianVaultService.getFilesByVaultName(vaultName)
  })

  // nutstore
  ipcMain.handle('nutstore:get-sso-url', NutstoreService.getNutstoreSSOUrl)
  ipcMain.handle('nutstore:decrypt-token', (_, token: string) => NutstoreService.decryptToken(token))
  ipcMain.handle('nutstore:get-directory-contents', (_, token: string, path: string) =>
    NutstoreService.getDirectoryContents(token, path)
  )
}
