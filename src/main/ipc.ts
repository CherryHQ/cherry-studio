import fs from 'node:fs'
import { arch } from 'node:os'
import path from 'node:path'

import { loggerService } from '@logger'
import { isLinux, isMac, isPortable, isWin } from '@main/constant'
import { getBinaryPath, isBinaryExists, runInstallScript } from '@main/utils/process'
import { handleZoomFactor } from '@main/utils/zoom'
import { SpanEntity, TokenUsage } from '@mcp-trace/trace-core'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, UpgradeChannel } from '@shared/config/constant'
import { IpcChannel } from '@shared/IpcChannel'
import { FileMetadata, Provider, Shortcut, ThemeMode } from '@types'
import { BrowserWindow, dialog, ipcMain, ProxyConfig, session, shell, systemPreferences, webContents } from 'electron'
import { Notification } from 'src/renderer/src/types/notification'

import appService from './services/AppService'
import AppUpdater from './services/AppUpdater'
import BackupManager from './services/BackupManager'
import { configManager } from './services/ConfigManager'
import CopilotService from './services/CopilotService'
import DxtService from './services/DxtService'
import { ExportService } from './services/ExportService'
import { fileStorage as fileManager } from './services/FileStorage'
import FileService from './services/FileSystemService'
import KnowledgeService from './services/KnowledgeService'
import mcpService from './services/MCPService'
import MemoryService from './services/memory/MemoryService'
import { openTraceWindow, setTraceWindowTitle } from './services/NodeTraceService'
import NotificationService from './services/NotificationService'
import * as NutstoreService from './services/NutstoreService'
import ObsidianVaultService from './services/ObsidianVaultService'
import { proxyManager } from './services/ProxyManager'
import { pythonService } from './services/PythonService'
import { FileServiceManager } from './services/remotefile/FileServiceManager'
import { searchService } from './services/SearchService'
import { SelectionService } from './services/SelectionService'
import { registerShortcuts, unregisterAllShortcuts } from './services/ShortcutService'
import {
  addEndMessage,
  addStreamMessage,
  bindTopic,
  cleanHistoryTrace,
  cleanLocalData,
  cleanTopic,
  getEntity,
  getSpans,
  saveEntity,
  saveSpans,
  tokenUsage
} from './services/SpanCacheService'
import storeSyncService from './services/StoreSyncService'
import { themeService } from './services/ThemeService'
import VertexAIService from './services/VertexAIService'
import { setOpenLinkExternal } from './services/WebviewService'
import { windowService } from './services/WindowService'
import { calculateDirectorySize, getResourcePath } from './utils'
import { decrypt, encrypt } from './utils/aes'
import { getCacheDir, getConfigDir, getFilesDir, hasWritePermission, isPathInside, untildify } from './utils/file'
import { updateAppDataConfig } from './utils/init'
import { compress, decompress } from './utils/zip'

const logger = loggerService.withContext('IPC')

const backupManager = new BackupManager()
const exportService = new ExportService()
const obsidianVaultService = new ObsidianVaultService()
const vertexAIService = VertexAIService.getInstance()
const memoryService = MemoryService.getInstance()
const dxtService = new DxtService()

export function registerIpc(mainWindow: BrowserWindow, app: Electron.App) {
  const appUpdater = new AppUpdater(mainWindow)
  const notificationService = new NotificationService(mainWindow)

  // Initialize Python service with main window
  pythonService.setMainWindow(mainWindow)

  ipcMain.handle(IpcChannel.App_Info, () => ({
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    filesPath: getFilesDir(),
    configPath: getConfigDir(),
    appDataPath: app.getPath('userData'),
    resourcesPath: getResourcePath(),
    logsPath: logger.getLogsDir(),
    arch: arch(),
    isPortable: isWin && 'PORTABLE_EXECUTABLE_DIR' in process.env,
    installPath: path.dirname(app.getPath('exe'))
  }))

  ipcMain.handle(IpcChannel.App_Proxy, async (_, proxy: string, bypassRules?: string) => {
    let proxyConfig: ProxyConfig

    if (proxy === 'system') {
      // system proxy will use the system filter by themselves
      proxyConfig = { mode: 'system' }
    } else if (proxy) {
      proxyConfig = { mode: 'fixed_servers', proxyRules: proxy, proxyBypassRules: bypassRules }
    } else {
      proxyConfig = { mode: 'direct' }
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

  // spell check
  ipcMain.handle(IpcChannel.App_SetEnableSpellCheck, (_, isEnable: boolean) => {
    // disable spell check for all webviews
    const webviews = webContents.getAllWebContents()
    webviews.forEach((webview) => {
      webview.session.setSpellCheckerEnabled(isEnable)
    })
  })

  // spell check languages
  ipcMain.handle(IpcChannel.App_SetSpellCheckLanguages, (_, languages: string[]) => {
    if (languages.length === 0) {
      return
    }
    const windows = BrowserWindow.getAllWindows()
    windows.forEach((window) => {
      window.webContents.session.setSpellCheckerLanguages(languages)
    })
    configManager.set('spellCheckLanguages', languages)
  })

  // launch on boot
  ipcMain.handle(IpcChannel.App_SetLaunchOnBoot, (_, isLaunchOnBoot: boolean) => {
    appService.setAppLaunchOnBoot(isLaunchOnBoot)
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

  // auto update
  ipcMain.handle(IpcChannel.App_SetAutoUpdate, (_, isActive: boolean) => {
    appUpdater.setAutoUpdate(isActive)
    configManager.setAutoUpdate(isActive)
  })

  ipcMain.handle(IpcChannel.App_SetTestPlan, async (_, isActive: boolean) => {
    logger.info(`set test plan: ${isActive}`)
    if (isActive !== configManager.getTestPlan()) {
      appUpdater.cancelDownload()
      configManager.setTestPlan(isActive)
    }
  })

  ipcMain.handle(IpcChannel.App_SetTestChannel, async (_, channel: UpgradeChannel) => {
    logger.info(`set test channel: ${channel}`)
    if (channel !== configManager.getTestChannel()) {
      appUpdater.cancelDownload()
      configManager.setTestChannel(channel)
    }
  })

  //only for mac
  if (isMac) {
    ipcMain.handle(IpcChannel.App_MacIsProcessTrusted, (): boolean => {
      return systemPreferences.isTrustedAccessibilityClient(false)
    })

    //return is only the current state, not the new state
    ipcMain.handle(IpcChannel.App_MacRequestProcessTrust, (): boolean => {
      return systemPreferences.isTrustedAccessibilityClient(true)
    })
  }

  ipcMain.handle(IpcChannel.Config_Set, (_, key: string, value: any, isNotify: boolean = false) => {
    configManager.set(key, value, isNotify)
  })

  ipcMain.handle(IpcChannel.Config_Get, (_, key: string) => {
    return configManager.get(key)
  })

  // theme
  ipcMain.handle(IpcChannel.App_SetTheme, (_, theme: ThemeMode) => {
    themeService.setTheme(theme)
  })

  ipcMain.handle(IpcChannel.App_HandleZoomFactor, (_, delta: number, reset: boolean = false) => {
    const windows = BrowserWindow.getAllWindows()
    handleZoomFactor(windows, delta, reset)
    return configManager.getZoomFactor()
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
      // do not clear logs for now
      // TODO clear logs
      // await fs.writeFileSync(log.transports.file.getFile().path, '')
      return { success: true }
    } catch (error: any) {
      logger.error('Failed to clear cache:', error)
      return { success: false, error: error.message }
    }
  })

  // get cache size
  ipcMain.handle(IpcChannel.App_GetCacheSize, async () => {
    const cachePath = getCacheDir()
    logger.info(`Calculating cache size for path: ${cachePath}`)

    try {
      const sizeInBytes = await calculateDirectorySize(cachePath)
      const sizeInMB = (sizeInBytes / (1024 * 1024)).toFixed(2)
      return `${sizeInMB}`
    } catch (error: any) {
      logger.error(`Failed to calculate cache size for ${cachePath}: ${error.message}`)
      return '0'
    }
  })

  let preventQuitListener: ((event: Electron.Event) => void) | null = null
  ipcMain.handle(IpcChannel.App_SetStopQuitApp, (_, stop: boolean = false, reason: string = '') => {
    if (stop) {
      // Only add listener if not already added
      if (!preventQuitListener) {
        preventQuitListener = (event: Electron.Event) => {
          event.preventDefault()
          notificationService.sendNotification({
            title: reason,
            message: reason
          } as Notification)
        }
        app.on('before-quit', preventQuitListener)
      }
    } else {
      // Remove listener if it exists
      if (preventQuitListener) {
        app.removeListener('before-quit', preventQuitListener)
        preventQuitListener = null
      }
    }
  })

  // Select app data path
  ipcMain.handle(IpcChannel.App_Select, async (_, options: Electron.OpenDialogOptions) => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog(options)
      if (canceled || filePaths.length === 0) {
        return null
      }
      return filePaths[0]
    } catch (error: any) {
      logger.error('Failed to select app data path:', error)
      return null
    }
  })

  ipcMain.handle(IpcChannel.App_HasWritePermission, async (_, filePath: string) => {
    const hasPermission = await hasWritePermission(filePath)
    return hasPermission
  })

  ipcMain.handle(IpcChannel.App_ResolvePath, async (_, filePath: string) => {
    return path.resolve(untildify(filePath))
  })

  // Check if a path is inside another path (proper parent-child relationship)
  ipcMain.handle(IpcChannel.App_IsPathInside, async (_, childPath: string, parentPath: string) => {
    return isPathInside(childPath, parentPath)
  })

  // Set app data path
  ipcMain.handle(IpcChannel.App_SetAppDataPath, async (_, filePath: string) => {
    updateAppDataConfig(filePath)
    app.setPath('userData', filePath)
  })

  ipcMain.handle(IpcChannel.App_GetDataPathFromArgs, () => {
    return process.argv
      .slice(1)
      .find((arg) => arg.startsWith('--new-data-path='))
      ?.split('--new-data-path=')[1]
  })

  ipcMain.handle(IpcChannel.App_FlushAppData, () => {
    BrowserWindow.getAllWindows().forEach((w) => {
      w.webContents.session.flushStorageData()
      w.webContents.session.cookies.flushStore()

      w.webContents.session.closeAllConnections()
    })

    session.defaultSession.flushStorageData()
    session.defaultSession.cookies.flushStore()
    session.defaultSession.closeAllConnections()
  })

  ipcMain.handle(IpcChannel.App_IsNotEmptyDir, async (_, path: string) => {
    return fs.readdirSync(path).length > 0
  })

  // Copy user data to new location
  ipcMain.handle(IpcChannel.App_Copy, async (_, oldPath: string, newPath: string, occupiedDirs: string[] = []) => {
    try {
      await fs.promises.cp(oldPath, newPath, {
        recursive: true,
        filter: (src) => {
          if (occupiedDirs.some((dir) => src.startsWith(path.resolve(dir)))) {
            return false
          }
          return true
        }
      })
      return { success: true }
    } catch (error: any) {
      logger.error('Failed to copy user data:', error)
      return { success: false, error: error.message }
    }
  })

  // Relaunch app
  ipcMain.handle(IpcChannel.App_RelaunchApp, (_, options?: Electron.RelaunchOptions) => {
    // Fix for .AppImage
    if (isLinux && process.env.APPIMAGE) {
      logger.info(`Relaunching app with options: ${process.env.APPIMAGE}`, options)
      // On Linux, we need to use the APPIMAGE environment variable to relaunch
      // https://github.com/electron-userland/electron-builder/issues/1727#issuecomment-769896927
      options = options || {}
      options.execPath = process.env.APPIMAGE
      options.args = options.args || []
      options.args.unshift('--appimage-extract-and-run')
    }

    if (isWin && isPortable) {
      options = options || {}
      options.execPath = process.env.PORTABLE_EXECUTABLE_FILE
      options.args = options.args || []
    }

    app.relaunch(options)
    app.exit(0)
  })

  // check for update
  ipcMain.handle(IpcChannel.App_CheckForUpdate, async () => {
    return await appUpdater.checkForUpdates()
  })

  // notification
  ipcMain.handle(IpcChannel.Notification_Send, async (_, notification: Notification) => {
    await notificationService.sendNotification(notification)
  })
  ipcMain.handle(IpcChannel.Notification_OnClick, (_, notification: Notification) => {
    mainWindow.webContents.send('notification-click', notification)
  })

  // zip
  ipcMain.handle(IpcChannel.Zip_Compress, (_, text: string) => compress(text))
  ipcMain.handle(IpcChannel.Zip_Decompress, (_, text: Buffer) => decompress(text))

  // system
  ipcMain.handle(IpcChannel.System_GetDeviceType, () => (isMac ? 'mac' : isWin ? 'windows' : 'linux'))
  ipcMain.handle(IpcChannel.System_GetHostname, () => require('os').hostname())
  ipcMain.handle(IpcChannel.System_ToggleDevTools, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    win && win.webContents.toggleDevTools()
  })

  // backup
  ipcMain.handle(IpcChannel.Backup_Backup, backupManager.backup.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_Restore, backupManager.restore.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_BackupToWebdav, backupManager.backupToWebdav.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_RestoreFromWebdav, backupManager.restoreFromWebdav.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_ListWebdavFiles, backupManager.listWebdavFiles.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_CheckConnection, backupManager.checkConnection.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_CreateDirectory, backupManager.createDirectory.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_DeleteWebdavFile, backupManager.deleteWebdavFile.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_BackupToLocalDir, backupManager.backupToLocalDir.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_RestoreFromLocalBackup, backupManager.restoreFromLocalBackup.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_ListLocalBackupFiles, backupManager.listLocalBackupFiles.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_DeleteLocalBackupFile, backupManager.deleteLocalBackupFile.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_BackupToS3, backupManager.backupToS3.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_RestoreFromS3, backupManager.restoreFromS3.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_ListS3Files, backupManager.listS3Files.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_DeleteS3File, backupManager.deleteS3File.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_CheckS3Connection, backupManager.checkS3Connection.bind(backupManager))

  // file
  ipcMain.handle(IpcChannel.File_Open, fileManager.open.bind(fileManager))
  ipcMain.handle(IpcChannel.File_OpenPath, fileManager.openPath.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Save, fileManager.save.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Select, fileManager.selectFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Upload, fileManager.uploadFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Clear, fileManager.clear.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Read, fileManager.readFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Delete, fileManager.deleteFile.bind(fileManager))
  ipcMain.handle('file:deleteDir', fileManager.deleteDir.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Get, fileManager.getFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_SelectFolder, fileManager.selectFolder.bind(fileManager))
  ipcMain.handle(IpcChannel.File_CreateTempFile, fileManager.createTempFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Write, fileManager.writeFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_WriteWithId, fileManager.writeFileWithId.bind(fileManager))
  ipcMain.handle(IpcChannel.File_SaveImage, fileManager.saveImage.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Base64Image, fileManager.base64Image.bind(fileManager))
  ipcMain.handle(IpcChannel.File_SaveBase64Image, fileManager.saveBase64Image.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Base64File, fileManager.base64File.bind(fileManager))
  ipcMain.handle(IpcChannel.File_GetPdfInfo, fileManager.pdfPageCount.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Download, fileManager.downloadFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Copy, fileManager.copyFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_BinaryImage, fileManager.binaryImage.bind(fileManager))
  ipcMain.handle(IpcChannel.File_OpenWithRelativePath, fileManager.openFileWithRelativePath.bind(fileManager))

  // file service
  ipcMain.handle(IpcChannel.FileService_Upload, async (_, provider: Provider, file: FileMetadata) => {
    const service = FileServiceManager.getInstance().getService(provider)
    return await service.uploadFile(file)
  })

  ipcMain.handle(IpcChannel.FileService_List, async (_, provider: Provider) => {
    const service = FileServiceManager.getInstance().getService(provider)
    return await service.listFiles()
  })

  ipcMain.handle(IpcChannel.FileService_Delete, async (_, provider: Provider, fileId: string) => {
    const service = FileServiceManager.getInstance().getService(provider)
    return await service.deleteFile(fileId)
  })

  ipcMain.handle(IpcChannel.FileService_Retrieve, async (_, provider: Provider, fileId: string) => {
    const service = FileServiceManager.getInstance().getService(provider)
    return await service.retrieveFile(fileId)
  })

  // fs
  ipcMain.handle(IpcChannel.Fs_Read, FileService.readFile.bind(FileService))

  // export
  ipcMain.handle(IpcChannel.Export_Word, exportService.exportToWord.bind(exportService))

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
  ipcMain.handle(IpcChannel.KnowledgeBase_Create, KnowledgeService.create.bind(KnowledgeService))
  ipcMain.handle(IpcChannel.KnowledgeBase_Reset, KnowledgeService.reset.bind(KnowledgeService))
  ipcMain.handle(IpcChannel.KnowledgeBase_Delete, KnowledgeService.delete.bind(KnowledgeService))
  ipcMain.handle(IpcChannel.KnowledgeBase_Add, KnowledgeService.add.bind(KnowledgeService))
  ipcMain.handle(IpcChannel.KnowledgeBase_Remove, KnowledgeService.remove.bind(KnowledgeService))
  ipcMain.handle(IpcChannel.KnowledgeBase_Search, KnowledgeService.search.bind(KnowledgeService))
  ipcMain.handle(IpcChannel.KnowledgeBase_Rerank, KnowledgeService.rerank.bind(KnowledgeService))
  ipcMain.handle(IpcChannel.KnowledgeBase_Check_Quota, KnowledgeService.checkQuota.bind(KnowledgeService))

  // memory
  ipcMain.handle(IpcChannel.Memory_Add, async (_, messages, config) => {
    return await memoryService.add(messages, config)
  })
  ipcMain.handle(IpcChannel.Memory_Search, async (_, query, config) => {
    return await memoryService.search(query, config)
  })
  ipcMain.handle(IpcChannel.Memory_List, async (_, config) => {
    return await memoryService.list(config)
  })
  ipcMain.handle(IpcChannel.Memory_Delete, async (_, id) => {
    return await memoryService.delete(id)
  })
  ipcMain.handle(IpcChannel.Memory_Update, async (_, id, memory, metadata) => {
    return await memoryService.update(id, memory, metadata)
  })
  ipcMain.handle(IpcChannel.Memory_Get, async (_, memoryId) => {
    return await memoryService.get(memoryId)
  })
  ipcMain.handle(IpcChannel.Memory_SetConfig, async (_, config) => {
    memoryService.setConfig(config)
  })
  ipcMain.handle(IpcChannel.Memory_DeleteUser, async (_, userId) => {
    return await memoryService.deleteUser(userId)
  })
  ipcMain.handle(IpcChannel.Memory_DeleteAllMemoriesForUser, async (_, userId) => {
    return await memoryService.deleteAllMemoriesForUser(userId)
  })
  ipcMain.handle(IpcChannel.Memory_GetUsersList, async () => {
    return await memoryService.getUsersList()
  })

  // window
  ipcMain.handle(IpcChannel.Windows_SetMinimumSize, (_, width: number, height: number) => {
    mainWindow?.setMinimumSize(width, height)
  })

  ipcMain.handle(IpcChannel.Windows_ResetMinimumSize, () => {
    mainWindow?.setMinimumSize(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
    const [width, height] = mainWindow?.getSize() ?? [MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT]
    if (width < MIN_WINDOW_WIDTH) {
      mainWindow?.setSize(MIN_WINDOW_WIDTH, height)
    }
  })

  ipcMain.handle(IpcChannel.Windows_GetSize, () => {
    const [width, height] = mainWindow?.getSize() ?? [MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT]
    return [width, height]
  })

  // VertexAI
  ipcMain.handle(IpcChannel.VertexAI_GetAuthHeaders, async (_, params) => {
    return vertexAIService.getAuthHeaders(params)
  })

  ipcMain.handle(IpcChannel.VertexAI_GetAccessToken, async (_, params) => {
    return vertexAIService.getAccessToken(params)
  })

  ipcMain.handle(IpcChannel.VertexAI_ClearAuthCache, async (_, projectId: string, clientEmail?: string) => {
    vertexAIService.clearAuthCache(projectId, clientEmail)
  })

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
  ipcMain.handle(IpcChannel.Mcp_ListPrompts, mcpService.listPrompts)
  ipcMain.handle(IpcChannel.Mcp_GetPrompt, mcpService.getPrompt)
  ipcMain.handle(IpcChannel.Mcp_ListResources, mcpService.listResources)
  ipcMain.handle(IpcChannel.Mcp_GetResource, mcpService.getResource)
  ipcMain.handle(IpcChannel.Mcp_GetInstallInfo, mcpService.getInstallInfo)
  ipcMain.handle(IpcChannel.Mcp_CheckConnectivity, mcpService.checkMcpConnectivity)
  ipcMain.handle(IpcChannel.Mcp_AbortTool, mcpService.abortTool)
  ipcMain.handle(IpcChannel.Mcp_GetServerVersion, mcpService.getServerVersion)

  // DXT upload handler
  ipcMain.handle(IpcChannel.Mcp_UploadDxt, async (event, fileBuffer: ArrayBuffer, fileName: string) => {
    try {
      // Create a temporary file with the uploaded content
      const tempPath = await fileManager.createTempFile(event, fileName)
      await fileManager.writeFile(event, tempPath, Buffer.from(fileBuffer))

      // Process DXT file using the temporary path
      return await dxtService.uploadDxt(event, tempPath)
    } catch (error) {
      logger.error('DXT upload error:', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to upload DXT file'
      }
    }
  })

  // Register Python execution handler
  ipcMain.handle(
    IpcChannel.Python_Execute,
    async (_, script: string, context?: Record<string, any>, timeout?: number) => {
      return await pythonService.executeScript(script, context, timeout)
    }
  )

  ipcMain.handle(IpcChannel.App_IsBinaryExist, (_, name: string) => isBinaryExists(name))
  ipcMain.handle(IpcChannel.App_GetBinaryPath, (_, name: string) => getBinaryPath(name))
  ipcMain.handle(IpcChannel.App_InstallUvBinary, () => runInstallScript('install-uv.js'))
  ipcMain.handle(IpcChannel.App_InstallBunBinary, () => runInstallScript('install-bun.js'))

  //copilot
  ipcMain.handle(IpcChannel.Copilot_GetAuthMessage, CopilotService.getAuthMessage.bind(CopilotService))
  ipcMain.handle(IpcChannel.Copilot_GetCopilotToken, CopilotService.getCopilotToken.bind(CopilotService))
  ipcMain.handle(IpcChannel.Copilot_SaveCopilotToken, CopilotService.saveCopilotToken.bind(CopilotService))
  ipcMain.handle(IpcChannel.Copilot_GetToken, CopilotService.getToken.bind(CopilotService))
  ipcMain.handle(IpcChannel.Copilot_Logout, CopilotService.logout.bind(CopilotService))
  ipcMain.handle(IpcChannel.Copilot_GetUser, CopilotService.getUser.bind(CopilotService))

  // Obsidian service
  ipcMain.handle(IpcChannel.Obsidian_GetVaults, () => {
    return obsidianVaultService.getVaults()
  })

  ipcMain.handle(IpcChannel.Obsidian_GetFiles, (_event, vaultName) => {
    return obsidianVaultService.getFilesByVaultName(vaultName)
  })

  // nutstore
  ipcMain.handle(IpcChannel.Nutstore_GetSsoUrl, NutstoreService.getNutstoreSSOUrl.bind(NutstoreService))
  ipcMain.handle(IpcChannel.Nutstore_DecryptToken, (_, token: string) => NutstoreService.decryptToken(token))
  ipcMain.handle(IpcChannel.Nutstore_GetDirectoryContents, (_, token: string, path: string) =>
    NutstoreService.getDirectoryContents(token, path)
  )

  // search window
  ipcMain.handle(IpcChannel.SearchWindow_Open, async (_, uid: string) => {
    await searchService.openSearchWindow(uid)
  })
  ipcMain.handle(IpcChannel.SearchWindow_Close, async (_, uid: string) => {
    await searchService.closeSearchWindow(uid)
  })
  ipcMain.handle(IpcChannel.SearchWindow_OpenUrl, async (_, uid: string, url: string) => {
    return await searchService.openUrlInSearchWindow(uid, url)
  })

  // webview
  ipcMain.handle(IpcChannel.Webview_SetOpenLinkExternal, (_, webviewId: number, isExternal: boolean) =>
    setOpenLinkExternal(webviewId, isExternal)
  )

  ipcMain.handle(IpcChannel.Webview_SetSpellCheckEnabled, (_, webviewId: number, isEnable: boolean) => {
    const webview = webContents.fromId(webviewId)
    if (!webview) return
    webview.session.setSpellCheckerEnabled(isEnable)
  })

  // store sync
  storeSyncService.registerIpcHandler()

  // selection assistant
  SelectionService.registerIpcHandler()

  ipcMain.handle(IpcChannel.App_QuoteToMain, (_, text: string) => windowService.quoteToMainWindow(text))

  ipcMain.handle(IpcChannel.App_SetDisableHardwareAcceleration, (_, isDisable: boolean) => {
    configManager.setDisableHardwareAcceleration(isDisable)
  })
  ipcMain.handle(IpcChannel.TRACE_SAVE_DATA, (_, topicId: string) => saveSpans(topicId))
  ipcMain.handle(IpcChannel.TRACE_GET_DATA, (_, topicId: string, traceId: string, modelName?: string) =>
    getSpans(topicId, traceId, modelName)
  )
  ipcMain.handle(IpcChannel.TRACE_SAVE_ENTITY, (_, entity: SpanEntity) => saveEntity(entity))
  ipcMain.handle(IpcChannel.TRACE_GET_ENTITY, (_, spanId: string) => getEntity(spanId))
  ipcMain.handle(IpcChannel.TRACE_BIND_TOPIC, (_, topicId: string, traceId: string) => bindTopic(traceId, topicId))
  ipcMain.handle(IpcChannel.TRACE_CLEAN_TOPIC, (_, topicId: string, traceId?: string) => cleanTopic(topicId, traceId))
  ipcMain.handle(IpcChannel.TRACE_TOKEN_USAGE, (_, spanId: string, usage: TokenUsage) => tokenUsage(spanId, usage))
  ipcMain.handle(IpcChannel.TRACE_CLEAN_HISTORY, (_, topicId: string, traceId: string, modelName?: string) =>
    cleanHistoryTrace(topicId, traceId, modelName)
  )
  ipcMain.handle(
    IpcChannel.TRACE_OPEN_WINDOW,
    (_, topicId: string, traceId: string, autoOpen?: boolean, modelName?: string) =>
      openTraceWindow(topicId, traceId, autoOpen, modelName)
  )
  ipcMain.handle(IpcChannel.TRACE_SET_TITLE, (_, title: string) => setTraceWindowTitle(title))
  ipcMain.handle(IpcChannel.TRACE_ADD_END_MESSAGE, (_, spanId: string, modelName: string, message: string) =>
    addEndMessage(spanId, modelName, message)
  )
  ipcMain.handle(IpcChannel.TRACE_CLEAN_LOCAL_DATA, () => cleanLocalData())
  ipcMain.handle(
    IpcChannel.TRACE_ADD_STREAM_MESSAGE,
    (_, spanId: string, modelName: string, context: string, msg: any) =>
      addStreamMessage(spanId, modelName, context, msg)
  )
}
