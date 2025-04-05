import fs from 'node:fs'

import { isMac, isWin } from '@main/constant'
import { getBinaryPath, isBinaryExists, runInstallScript } from '@main/utils/process'
import { IpcChannel } from '@shared/IpcChannel'
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
import { getConfigDir, getFilesDir } from './utils/file'
import { compress, decompress } from './utils/zip'

const fileManager = new FileStorage()
const backupManager = new BackupManager()
const exportService = new ExportService(fileManager)
const obsidianVaultService = new ObsidianVaultService()

export function registerIpc(mainWindow: BrowserWindow, app: Electron.App) {
  const appUpdater = new AppUpdater(mainWindow)

  ipcMain.handle(IpcChannel.App_Info, () => ({
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    filesPath: getFilesDir(),
    configPath: getConfigDir(),
    appDataPath: app.getPath('userData'),
    resourcesPath: getResourcePath(),
    logsPath: log.transports.file.getFile().path
  }))

  ipcMain.handle(IpcChannel.App_Proxy, async (_, proxy: string) => {
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

  ipcMain.handle(IpcChannel.App_Reload, () => mainWindow.reload())
  ipcMain.handle(IpcChannel.Open_Website, (_, url: string) => shell.openExternal(url))

  // Update
  ipcMain.handle(IpcChannel.App_ShowUpdateDialog, () => appUpdater.showUpdateDialog(mainWindow))

  // language
  ipcMain.handle(IpcChannel.App_SetLanguage, (_, language) => {
    configManager.setLanguage(language)
  })

  // launch on boot
  ipcMain.handle(IpcChannel.App_SetLaunchOnBoot, (_, openAtLogin: boolean) => {
    // Set login item settings for windows and mac
    // linux is not supported because it requires more file operations
    if (isWin || isMac) {
      app.setLoginItemSettings({ openAtLogin })
    }
  })

  // launch to tray
  ipcMain.handle(IpcChannel.App_SetLaunchToTray, (_, isActive: boolean) => {
    configManager.setLaunchToTray(isActive)
  })

  // tray
  ipcMain.handle(IpcChannel.App_SetTray, (_, isActive: boolean) => {
    configManager.setTray(isActive)
  })

  // to tray on close
  ipcMain.handle(IpcChannel.App_SetTrayOnClose, (_, isActive: boolean) => {
    configManager.setTrayOnClose(isActive)
  })

  ipcMain.handle(IpcChannel.App_RestartTray, () => TrayService.getInstance().restartTray())

  ipcMain.handle(IpcChannel.Config_Set, (_, key: string, value: any) => {
    configManager.set(key, value)
  })

  ipcMain.handle(IpcChannel.Config_Get, (_, key: string) => {
    return configManager.get(key)
  })

  // theme
  ipcMain.handle(IpcChannel.App_SetTheme, (event, theme: ThemeMode) => {
    if (theme === configManager.getTheme()) return

    configManager.setTheme(theme)

    // should sync theme change to all windows
    const senderWindowId = event.sender.id
    const windows = BrowserWindow.getAllWindows()
    // 向其他窗口广播主题变化
    windows.forEach((win) => {
      if (win.webContents.id !== senderWindowId) {
        win.webContents.send(IpcChannel.ThemeChange, theme)
      }
    })

    mainWindow?.setTitleBarOverlay &&
      mainWindow.setTitleBarOverlay(theme === 'dark' ? titleBarOverlayDark : titleBarOverlayLight)
  })

  // clear cache
  ipcMain.handle(IpcChannel.App_ClearCache, async () => {
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
  ipcMain.handle(IpcChannel.App_CheckForUpdate, async () => {
    const update = await appUpdater.autoUpdater.checkForUpdates()
    return {
      currentVersion: appUpdater.autoUpdater.currentVersion,
      updateInfo: update?.updateInfo
    }
  })

  // zip
  ipcMain.handle(IpcChannel.Zip_Compress, (_, text: string) => compress(text))
  ipcMain.handle(IpcChannel.Zip_Decompress, (_, text: Buffer) => decompress(text))

  // backup
  ipcMain.handle(IpcChannel.Backup_Backup, backupManager.backup)
  ipcMain.handle(IpcChannel.Backup_Restore, backupManager.restore)
  ipcMain.handle(IpcChannel.Backup_BackupToWebdav, backupManager.backupToWebdav)
  ipcMain.handle(IpcChannel.Backup_RestoreFromWebdav, backupManager.restoreFromWebdav)
  ipcMain.handle(IpcChannel.Backup_ListWebdavFiles, backupManager.listWebdavFiles)
  ipcMain.handle(IpcChannel.Backup_CheckConnection, backupManager.checkConnection)
  ipcMain.handle(IpcChannel.Backup_CreateDirectory, backupManager.createDirectory)

  // file
  ipcMain.handle(IpcChannel.File_Open, fileManager.open)
  ipcMain.handle(IpcChannel.File_OpenPath, fileManager.openPath)
  ipcMain.handle(IpcChannel.File_Save, fileManager.save)
  ipcMain.handle(IpcChannel.File_Select, fileManager.selectFile)
  ipcMain.handle(IpcChannel.File_Upload, fileManager.uploadFile)
  ipcMain.handle(IpcChannel.File_Clear, fileManager.clear)
  ipcMain.handle(IpcChannel.File_Read, fileManager.readFile)
  ipcMain.handle(IpcChannel.File_Delete, fileManager.deleteFile)
  ipcMain.handle(IpcChannel.File_Get, fileManager.getFile)
  ipcMain.handle(IpcChannel.File_SelectFolder, fileManager.selectFolder)
  ipcMain.handle(IpcChannel.File_Create, fileManager.createTempFile)
  ipcMain.handle(IpcChannel.File_Write, fileManager.writeFile)
  ipcMain.handle(IpcChannel.File_SaveImage, fileManager.saveImage)
  ipcMain.handle(IpcChannel.File_Base64Image, fileManager.base64Image)
  ipcMain.handle(IpcChannel.File_Download, fileManager.downloadFile)
  ipcMain.handle(IpcChannel.File_Copy, fileManager.copyFile)
  ipcMain.handle(IpcChannel.File_BinaryFile, fileManager.binaryFile)

  // fs
  ipcMain.handle(IpcChannel.Fs_Read, FileService.readFile)

  // minapp
  ipcMain.handle(IpcChannel.Minapp, (_, args) => {
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
  ipcMain.handle(IpcChannel.Export_Word, exportService.exportToWord)

  // open path
  ipcMain.handle(IpcChannel.Open_Path, async (_, path: string) => {
    await shell.openPath(path)
  })

  // shortcuts
  ipcMain.handle(IpcChannel.Shortcuts_Update, (_, shortcuts: Shortcut[]) => {
    configManager.setShortcuts(shortcuts)
    // Refresh shortcuts registration
    if (mainWindow) {
      unregisterAllShortcuts()
      registerShortcuts(mainWindow)
    }
  })

  // knowledge base
  ipcMain.handle(IpcChannel.KnowledgeBase_Create, KnowledgeService.create)
  ipcMain.handle(IpcChannel.KnowledgeBase_Reset, KnowledgeService.reset)
  ipcMain.handle(IpcChannel.KnowledgeBase_Delete, KnowledgeService.delete)
  ipcMain.handle(IpcChannel.KnowledgeBase_Add, KnowledgeService.add)
  ipcMain.handle(IpcChannel.KnowledgeBase_Remove, KnowledgeService.remove)
  ipcMain.handle(IpcChannel.KnowledgeBase_Search, KnowledgeService.search)
  ipcMain.handle(IpcChannel.KnowledgeBase_Rerank, KnowledgeService.rerank)

  // window
  ipcMain.handle(IpcChannel.Windows_SetMinimumSize, (_, width: number, height: number) => {
    mainWindow?.setMinimumSize(width, height)
  })

  ipcMain.handle(IpcChannel.Windows_ResetMinimumSize, () => {
    mainWindow?.setMinimumSize(1080, 600)
    const [width, height] = mainWindow?.getSize() ?? [1080, 600]
    if (width < 1080) {
      mainWindow?.setSize(1080, height)
    }
  })

  // gemini
  ipcMain.handle(IpcChannel.Gemini_UploadFile, GeminiService.uploadFile)
  ipcMain.handle(IpcChannel.Gemini_Base64File, GeminiService.base64File)
  ipcMain.handle(IpcChannel.Gemini_RetrieveFile, GeminiService.retrieveFile)
  ipcMain.handle(IpcChannel.Gemini_ListFiles, GeminiService.listFiles)
  ipcMain.handle(IpcChannel.Gemini_DeleteFile, GeminiService.deleteFile)

  // mini window
  ipcMain.handle(IpcChannel.MiniWindow_Show, () => windowService.showMiniWindow())
  ipcMain.handle(IpcChannel.MiniWindow_Hide, () => windowService.hideMiniWindow())
  ipcMain.handle(IpcChannel.MiniWindow_Close, () => windowService.closeMiniWindow())
  ipcMain.handle(IpcChannel.MiniWindow_Toggle, () => windowService.toggleMiniWindow())
  ipcMain.handle(IpcChannel.MiniWindow_SetPin, (_, isPinned) => windowService.setPinMiniWindow(isPinned))

  // aes
  ipcMain.handle(IpcChannel.Aes_Encrypt, (_, text: string, secretKey: string, iv: string) =>
    encrypt(text, secretKey, iv)
  )
  ipcMain.handle(IpcChannel.Aes_Decrypt, (_, encryptedData: string, iv: string, secretKey: string) =>
    decrypt(encryptedData, iv, secretKey)
  )

  // Register MCP handlers
  ipcMain.handle(IpcChannel.Mcp_RemoveServer, mcpService.removeServer)
  ipcMain.handle(IpcChannel.Mcp_RestartServer, mcpService.restartServer)
  ipcMain.handle(IpcChannel.Mcp_StopServer, mcpService.stopServer)
  ipcMain.handle(IpcChannel.Mcp_ListTools, mcpService.listTools)
  ipcMain.handle(IpcChannel.Mcp_CallTool, mcpService.callTool)
  ipcMain.handle(IpcChannel.Mcp_GetInstallInfo, mcpService.getInstallInfo)

  ipcMain.handle(IpcChannel.App_IsBinaryExist, (_, name: string) => isBinaryExists(name))
  ipcMain.handle(IpcChannel.App_GetBinaryPath, (_, name: string) => getBinaryPath(name))
  ipcMain.handle(IpcChannel.App_InstallUvBinary, () => runInstallScript('install-uv.js'))
  ipcMain.handle(IpcChannel.App_InstallBunBinary, () => runInstallScript('install-bun.js'))

  //copilot
  ipcMain.handle(IpcChannel.Copilot_GetAuthMessage, CopilotService.getAuthMessage)
  ipcMain.handle(IpcChannel.Copilot_GetCopilotToken, CopilotService.getCopilotToken)
  ipcMain.handle(IpcChannel.Copilot_SaveCopilotToken, CopilotService.saveCopilotToken)
  ipcMain.handle(IpcChannel.Copilot_GetToken, CopilotService.getToken)
  ipcMain.handle(IpcChannel.Copilot_Logout, CopilotService.logout)
  ipcMain.handle(IpcChannel.Copilot_GetUser, CopilotService.getUser)

  // Obsidian service
  ipcMain.handle(IpcChannel.Obsidian_GetVaults, () => {
    return obsidianVaultService.getVaults()
  })

  ipcMain.handle(IpcChannel.Obsidian_GetFiles, (_event, vaultName) => {
    return obsidianVaultService.getFilesByVaultName(vaultName)
  })

  // nutstore
  ipcMain.handle(IpcChannel.Nutstore_GetSsoUrl, NutstoreService.getNutstoreSSOUrl)
  ipcMain.handle(IpcChannel.Nutstore_DecryptToken, (_, token: string) => NutstoreService.decryptToken(token))
  ipcMain.handle(IpcChannel.Nutstore_GetDirectoryContents, (_, token: string, path: string) =>
    NutstoreService.getDirectoryContents(token, path)
  )
}
