import fs from 'node:fs'
import { arch } from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { agentSessionMessageService as sessionMessageService } from '@data/services/AgentSessionMessageService'
import { loggerService } from '@logger'
import { isMac, isWin } from '@main/constant'
import { generateSignature } from '@main/integration/cherryai'
import { anthropicService } from '@main/services/AnthropicService'
import { getIpCountry } from '@main/utils/ipService'
import {
  autoDiscoverGitBash,
  getBinaryPath,
  getGitBashPathInfo,
  isBinaryExists,
  runInstallScript,
  validateGitBashPath
} from '@main/utils/process'
import { handleZoomFactor } from '@main/utils/zoom'
import { IpcChannel } from '@shared/IpcChannel'
import { extractPdfText } from '@shared/utils/pdf'
import type { AgentPersistedMessage, FileMetadata, Notification, Provider } from '@types'
import checkDiskSpace from 'check-disk-space'
import { app, BrowserWindow, dialog, ipcMain, session, shell, systemPreferences, webContents } from 'electron'
import fontList from 'font-list'

import { skillService } from './services/agents/skills/SkillService'
import { appService } from './services/AppService'
import BackupManager from './services/BackupManager'
import { cherryINOAuthService } from './services/CherryINOAuthService'
import { ConfigKeys, configManager } from './services/ConfigManager'
import { copilotService } from './services/CopilotService'
import DxtService from './services/DxtService'
import { ExportService } from './services/ExportService'
import { externalAppsService } from './services/ExternalAppsService'
import { fileStorage as fileManager } from './services/FileStorage'
import FileService from './services/FileSystemService'
import { knowledgeService } from './services/KnowledgeService'
import NotificationService from './services/NotificationService'
import * as NutstoreService from './services/NutstoreService'
import ObsidianVaultService from './services/ObsidianVaultService'
import { fileServiceManager } from './services/remotefile/FileServiceManager'
import { isSafeExternalUrl } from './services/security'
import { vertexAIService } from './services/VertexAIService'
import { calculateDirectorySize } from './utils'
import { decrypt, encrypt } from './utils/aes'
import { hasWritePermission, isPathInside, untildify } from './utils/file'
import { getCpuName, getDeviceType, getHostname } from './utils/system'
import { compress, decompress } from './utils/zip'

const logger = loggerService.withContext('IPC')

const backupManager = new BackupManager()
const exportService = new ExportService()
const obsidianVaultService = new ObsidianVaultService()
const dxtService = new DxtService()

export async function registerIpc() {
  const notificationService = new NotificationService()

  // [v2] Removed: Redux persistor flush is no longer needed after v2 data refactoring
  // const powerMonitorService = application.get('PowerMonitorService')
  // powerMonitorService.registerShutdownHandler(() => {
  //   const mw = application.get('MainWindowService').getMainWindow()
  //   if (mw && !mw.isDestroyed()) {
  //     mw.webContents.send(IpcChannel.App_SaveData)
  //   }
  // })

  ipcMain.handle(IpcChannel.App_Info, () => ({
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    appPath: application.getPath('app.root'),
    filesPath: application.getPath('feature.files.data'),
    notesPath: application.getPath('feature.notes.data'),
    configPath: application.getPath('cherry.config'),
    appDataPath: application.getPath('app.userdata'),
    resourcesPath: application.getPath('app.root.resources'),
    logsPath: logger.getLogsDir(),
    arch: arch(),
    isPortable: isWin && 'PORTABLE_EXECUTABLE_DIR' in process.env,
    installPath: application.getPath('app.install')
  }))

  // MainWindow_Reload handler moved into MainWindowService.registerIpcHandlers.
  // Application_Quit is registered by Application.registerApplicationIpc()
  ipcMain.handle(IpcChannel.Open_Website, (_, url: string) => {
    if (!isSafeExternalUrl(url)) {
      logger.warn(`Blocked shell.openExternal for untrusted URL scheme: ${url}`)
      return
    }
    return shell.openExternal(url)
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
    void application.get('PreferenceService').set('app.spell_check.languages', languages)
  })

  // launch on boot
  ipcMain.handle(IpcChannel.App_SetLaunchOnBoot, async (_, isLaunchOnBoot: boolean) => {
    await appService.setAppLaunchOnBoot(isLaunchOnBoot)
  })

  ipcMain.handle(IpcChannel.AgentMessage_PersistExchange, async (_event, payload) => {
    try {
      return await sessionMessageService.persistExchange(payload)
    } catch (error) {
      logger.error('Failed to persist agent session messages', error as Error)
      throw error
    }
  })

  ipcMain.handle(
    IpcChannel.AgentMessage_GetHistory,
    async (_event, { sessionId }: { sessionId: string }): Promise<AgentPersistedMessage[]> => {
      try {
        return await sessionMessageService.getSessionHistory(sessionId)
      } catch (error) {
        logger.error('Failed to get agent session history', error as Error)
        throw error
      }
    }
  )

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

  // Get System Fonts
  ipcMain.handle(IpcChannel.App_GetSystemFonts, async () => {
    try {
      const fonts = await fontList.getFonts()
      return fonts.map((font: string) => font.replace(/^"(.*)"$/, '$1')).filter((font: string) => font.length > 0)
    } catch (error) {
      logger.error('Failed to get system fonts:', error as Error)
      return []
    }
  })

  // Get IP Country
  ipcMain.handle(IpcChannel.App_GetIpCountry, async () => {
    return getIpCountry()
  })

  ipcMain.handle(IpcChannel.Config_Set, (_, key: string) => {
    // Legacy config handler - will be deprecated
    logger.warn(`Legacy Config_Set called for key: ${key}`)
  })

  // // theme
  // ipcMain.handle(IpcChannel.App_SetTheme, (_, theme: ThemeMode) => {
  //   themeService.setTheme(theme)
  // })

  ipcMain.handle(IpcChannel.App_HandleZoomFactor, (_, delta: number, reset: boolean = false) => {
    const windows = BrowserWindow.getAllWindows()
    handleZoomFactor(windows, delta, reset)
    return application.get('PreferenceService').get('app.zoom_factor')
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
    const cachePath = application.getPath('app.session.cache')
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
  //
  // TODO(v2): This handler is incompatible with the frozen path registry
  // established by Application.bootstrap(). Calling app.setPath('userData')
  // here mutates Electron's path while application.getPath('app.userdata')
  // keeps returning the boot-time value until the renderer triggers a
  // relaunch (which it currently always does — see BasicDataSettings.tsx
  // L186/203/322). When the v1 path-change flow is migrated to
  // BootConfigService, redesign this handler so the app data path can only
  // be changed via boot-config + restart, eliminating the divergence window.
  ipcMain.handle(IpcChannel.App_SetAppDataPath, async (_, filePath: string) => {
    // updateAppDataConfig(filePath)
    // app.setPath('userData', filePath)
    // TODO: will refactor in v2
    return filePath
  })

  ipcMain.handle(IpcChannel.App_GetDataPathFromArgs, () => {
    return process.argv
      .slice(1)
      .find((arg) => arg.startsWith('--new-data-path='))
      ?.split('--new-data-path=')[1]
  })

  ipcMain.handle(IpcChannel.App_FlushAppData, async () => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.session.flushStorageData()
      await w.webContents.session.cookies.flushStore()
      await w.webContents.session.closeAllConnections()
    }

    session.defaultSession.flushStorageData()
    await session.defaultSession.cookies.flushStore()
    await session.defaultSession.closeAllConnections()
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

  // Application_Relaunch is registered by Application.registerApplicationIpc()

  // Reset all data (factory reset)
  ipcMain.handle(IpcChannel.App_ResetData, () => backupManager.resetData())

  // notification
  ipcMain.handle(IpcChannel.Notification_Send, async (_, notification: Notification) => {
    await notificationService.sendNotification(notification)
  })
  // Notification_OnClick handler moved into MainWindowService (uses wm.broadcastToType).

  // zip
  ipcMain.handle(IpcChannel.Zip_Compress, (_, text: string) => compress(text))
  ipcMain.handle(IpcChannel.Zip_Decompress, (_, text: Buffer) => decompress(text))

  // system
  ipcMain.handle(IpcChannel.System_GetDeviceType, getDeviceType)
  ipcMain.handle(IpcChannel.System_GetHostname, getHostname)
  ipcMain.handle(IpcChannel.System_GetCpuName, getCpuName)
  ipcMain.handle(IpcChannel.System_CheckGitBash, () => {
    if (!isWin) {
      return true // Non-Windows systems don't need Git Bash
    }

    try {
      // Use autoDiscoverGitBash to handle auto-discovery and persistence
      const bashPath = autoDiscoverGitBash()
      if (bashPath) {
        logger.info('Git Bash is available', { path: bashPath })
        return true
      }

      logger.warn('Git Bash not found. Please install Git for Windows from https://git-scm.com/downloads/win')
      return false
    } catch (error) {
      logger.error('Unexpected error checking Git Bash', error as Error)
      return false
    }
  })

  ipcMain.handle(IpcChannel.System_GetGitBashPath, () => {
    if (!isWin) {
      return null
    }

    const customPath = configManager.get(ConfigKeys.GitBashPath)
    return customPath ?? null
  })

  // Returns { path, source } where source is 'manual' | 'auto' | null
  ipcMain.handle(IpcChannel.System_GetGitBashPathInfo, () => {
    return getGitBashPathInfo()
  })

  ipcMain.handle(IpcChannel.System_SetGitBashPath, (_, newPath: string | null) => {
    if (!isWin) {
      return false
    }

    if (!newPath) {
      // Clear manual setting and re-run auto-discovery
      configManager.set(ConfigKeys.GitBashPath, null)
      configManager.set(ConfigKeys.GitBashPathSource, null)
      // Re-run auto-discovery to restore auto-discovered path if available
      autoDiscoverGitBash()
      return true
    }

    const validated = validateGitBashPath(newPath)
    if (!validated) {
      return false
    }

    // Set path with 'manual' source
    configManager.set(ConfigKeys.GitBashPath, validated)
    configManager.set(ConfigKeys.GitBashPathSource, 'manual')
    return true
  })

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
  ipcMain.handle(IpcChannel.Backup_CreateLanTransferBackup, backupManager.createLanTransferBackup.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_DeleteLanTransferBackup, backupManager.deleteLanTransferBackup.bind(backupManager))

  // file
  ipcMain.handle(IpcChannel.File_Open, fileManager.open.bind(fileManager))
  ipcMain.handle(IpcChannel.File_OpenPath, fileManager.openPath.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Save, fileManager.save.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Select, fileManager.selectFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Upload, fileManager.uploadFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Clear, fileManager.clear.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Read, fileManager.readFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_ReadExternal, fileManager.readExternalFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Delete, fileManager.deleteFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_DeleteDir, fileManager.deleteDir.bind(fileManager))
  ipcMain.handle(IpcChannel.File_DeleteExternalFile, fileManager.deleteExternalFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_DeleteExternalDir, fileManager.deleteExternalDir.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Move, fileManager.moveFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_MoveDir, fileManager.moveDir.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Rename, fileManager.renameFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_RenameDir, fileManager.renameDir.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Get, fileManager.getFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_SelectFolder, fileManager.selectFolder.bind(fileManager))
  ipcMain.handle(IpcChannel.File_CreateTempFile, fileManager.createTempFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Mkdir, fileManager.mkdir.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Write, fileManager.writeFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_WriteWithId, fileManager.writeFileWithId.bind(fileManager))
  ipcMain.handle(IpcChannel.File_SaveImage, fileManager.saveImage.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Base64Image, fileManager.base64Image.bind(fileManager))
  ipcMain.handle(IpcChannel.File_SaveBase64Image, fileManager.saveBase64Image.bind(fileManager))
  ipcMain.handle(IpcChannel.File_SavePastedImage, fileManager.savePastedImage.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Base64File, fileManager.base64File.bind(fileManager))
  ipcMain.handle(IpcChannel.File_GetPdfInfo, fileManager.pdfPageCount.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Download, fileManager.downloadFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Copy, fileManager.copyFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_BinaryImage, fileManager.binaryImage.bind(fileManager))
  ipcMain.handle(IpcChannel.File_OpenWithRelativePath, fileManager.openFileWithRelativePath.bind(fileManager))
  ipcMain.handle(IpcChannel.File_IsTextFile, fileManager.isTextFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_IsDirectory, fileManager.isDirectory.bind(fileManager))
  ipcMain.handle(IpcChannel.File_ListDirectory, fileManager.listDirectory.bind(fileManager))
  ipcMain.handle(IpcChannel.File_GetDirectoryStructure, fileManager.getDirectoryStructure.bind(fileManager))
  ipcMain.handle(IpcChannel.File_CheckFileName, fileManager.fileNameGuard.bind(fileManager))
  ipcMain.handle(IpcChannel.File_ValidateNotesDirectory, fileManager.validateNotesDirectory.bind(fileManager))
  ipcMain.handle(IpcChannel.File_StartWatcher, fileManager.startFileWatcher.bind(fileManager))
  ipcMain.handle(IpcChannel.File_StopWatcher, fileManager.stopFileWatcher.bind(fileManager))
  ipcMain.handle(IpcChannel.File_PauseWatcher, fileManager.pauseFileWatcher.bind(fileManager))
  ipcMain.handle(IpcChannel.File_ResumeWatcher, fileManager.resumeFileWatcher.bind(fileManager))
  ipcMain.handle(IpcChannel.File_BatchUploadMarkdown, fileManager.batchUploadMarkdownFiles.bind(fileManager))
  ipcMain.handle(IpcChannel.File_ShowInFolder, fileManager.showInFolder.bind(fileManager))

  // pdf
  ipcMain.handle(IpcChannel.Pdf_ExtractText, (_, data: Uint8Array | ArrayBuffer | string) => extractPdfText(data))

  // file service
  ipcMain.handle(IpcChannel.FileService_Upload, async (_, provider: Provider, file: FileMetadata) => {
    const service = fileServiceManager.getService(provider)
    return await service.uploadFile(file)
  })

  ipcMain.handle(IpcChannel.FileService_List, async (_, provider: Provider) => {
    const service = fileServiceManager.getService(provider)
    return await service.listFiles()
  })

  ipcMain.handle(IpcChannel.FileService_Delete, async (_, provider: Provider, fileId: string) => {
    const service = fileServiceManager.getService(provider)
    return await service.deleteFile(fileId)
  })

  ipcMain.handle(IpcChannel.FileService_Retrieve, async (_, provider: Provider, fileId: string) => {
    const service = fileServiceManager.getService(provider)
    return await service.retrieveFile(fileId)
  })

  // fs
  ipcMain.handle(IpcChannel.Fs_Read, FileService.readFile.bind(FileService))
  ipcMain.handle(IpcChannel.Fs_ReadText, FileService.readTextFileWithAutoEncoding.bind(FileService))

  // export
  ipcMain.handle(IpcChannel.Export_Word, exportService.exportToWord.bind(exportService))

  // open path
  ipcMain.handle(IpcChannel.Open_Path, async (_, path: string) => {
    await shell.openPath(path)
  })

  ipcMain.handle(IpcChannel.KnowledgeBase_Create, knowledgeService.create.bind(knowledgeService))
  ipcMain.handle(IpcChannel.KnowledgeBase_Reset, knowledgeService.reset.bind(knowledgeService))
  ipcMain.handle(IpcChannel.KnowledgeBase_Delete, knowledgeService.delete.bind(knowledgeService))
  ipcMain.handle(IpcChannel.KnowledgeBase_Add, knowledgeService.add.bind(knowledgeService))
  ipcMain.handle(IpcChannel.KnowledgeBase_Remove, knowledgeService.remove.bind(knowledgeService))
  ipcMain.handle(IpcChannel.KnowledgeBase_Search, knowledgeService.search.bind(knowledgeService))
  ipcMain.handle(IpcChannel.KnowledgeBase_Rerank, knowledgeService.rerank.bind(knowledgeService))

  // memory
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

  // aes
  ipcMain.handle(IpcChannel.Aes_Encrypt, (_, text: string, secretKey: string, iv: string) =>
    encrypt(text, secretKey, iv)
  )
  ipcMain.handle(IpcChannel.Aes_Decrypt, (_, encryptedData: string, iv: string, secretKey: string) =>
    decrypt(encryptedData, iv, secretKey)
  )

  // Channel logs & status
  ipcMain.handle(IpcChannel.Channel_GetLogs, async (_event, channelId: string) => {
    const { channelManager } = await import('@main/services/agents/services/channels/ChannelManager')
    return channelManager.getChannelLogs(channelId)
  })

  ipcMain.handle(IpcChannel.Channel_GetStatuses, async () => {
    const { channelManager } = await import('@main/services/agents/services/channels/ChannelManager')
    return channelManager.getAllStatuses()
  })

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

  ipcMain.handle(IpcChannel.App_IsBinaryExist, (_, name: string) => isBinaryExists(name))
  ipcMain.handle(IpcChannel.App_GetBinaryPath, (_, name: string) => getBinaryPath(name))
  ipcMain.handle(IpcChannel.App_InstallUvBinary, () => runInstallScript('install-uv.js'))
  ipcMain.handle(IpcChannel.App_InstallBunBinary, () => runInstallScript('install-bun.js'))
  ipcMain.handle(IpcChannel.App_InstallOvmsBinary, () => runInstallScript('install-ovms.js'))

  //copilot
  ipcMain.handle(IpcChannel.Copilot_GetAuthMessage, copilotService.getAuthMessage.bind(copilotService))
  ipcMain.handle(IpcChannel.Copilot_GetCopilotToken, copilotService.getCopilotToken.bind(copilotService))
  ipcMain.handle(IpcChannel.Copilot_SaveCopilotToken, copilotService.saveCopilotToken.bind(copilotService))
  ipcMain.handle(IpcChannel.Copilot_GetToken, copilotService.getToken.bind(copilotService))
  ipcMain.handle(IpcChannel.Copilot_Logout, copilotService.logout.bind(copilotService))
  ipcMain.handle(IpcChannel.Copilot_GetUser, copilotService.getUser.bind(copilotService))

  // CherryIN OAuth
  ipcMain.handle(IpcChannel.CherryIN_SaveToken, cherryINOAuthService.saveToken.bind(cherryINOAuthService))
  ipcMain.handle(IpcChannel.CherryIN_HasToken, cherryINOAuthService.hasToken.bind(cherryINOAuthService))
  ipcMain.handle(IpcChannel.CherryIN_GetBalance, cherryINOAuthService.getBalance.bind(cherryINOAuthService))
  ipcMain.handle(IpcChannel.CherryIN_Logout, cherryINOAuthService.logout.bind(cherryINOAuthService))
  ipcMain.handle(IpcChannel.CherryIN_StartOAuthFlow, cherryINOAuthService.startOAuthFlow.bind(cherryINOAuthService))
  ipcMain.handle(IpcChannel.CherryIN_ExchangeToken, cherryINOAuthService.exchangeToken.bind(cherryINOAuthService))

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

  // ipcMain.handle(IpcChannel.App_SetDisableHardwareAcceleration, (_, isDisable: boolean) => {
  //   configManager.setDisableHardwareAcceleration(isDisable)
  // })
  // ipcMain.handle(IpcChannel.App_SetUseSystemTitleBar, (_, isActive: boolean) => {
  //   configManager.setUseSystemTitleBar(isActive)
  // })
  ipcMain.handle(IpcChannel.App_GetDiskInfo, async (_, directoryPath: string) => {
    try {
      const diskSpace = await checkDiskSpace(directoryPath) // { free, size } in bytes
      logger.debug('disk space', diskSpace)
      const { free, size } = diskSpace
      return {
        free,
        size
      }
    } catch (error) {
      logger.error('check disk space error', error as Error)
      return null
    }
  })
  // Anthropic OAuth
  ipcMain.handle(IpcChannel.Anthropic_StartOAuthFlow, () => anthropicService.startOAuthFlow())
  ipcMain.handle(IpcChannel.Anthropic_CompleteOAuthWithCode, (_, code: string) =>
    anthropicService.completeOAuthWithCode(code)
  )
  ipcMain.handle(IpcChannel.Anthropic_CancelOAuthFlow, () => anthropicService.cancelOAuthFlow())
  ipcMain.handle(IpcChannel.Anthropic_GetAccessToken, () => anthropicService.getValidAccessToken())
  ipcMain.handle(IpcChannel.Anthropic_HasCredentials, () => anthropicService.hasCredentials())
  ipcMain.handle(IpcChannel.Anthropic_ClearCredentials, () => anthropicService.clearCredentials())

  // ExternalApps
  ipcMain.handle(IpcChannel.ExternalApps_DetectInstalled, () => externalAppsService.detectInstalledApps())

  // OVMS — operation handlers registered by OvmsManager.onInit() (activated only on Win+Intel)
  // Condition logic must stay in sync with OvmsManager's @Conditional(onPlatform('win32'), onCpuVendor('intel'))
  ipcMain.handle(IpcChannel.Ovms_IsSupported, () => isWin && getCpuName().toLowerCase().includes('intel'))

  // CherryAI
  ipcMain.handle(IpcChannel.Cherryai_GetSignature, (_, params) => generateSignature(params))

  // Global Skills
  ipcMain.handle(IpcChannel.Skill_List, async (_, agentId?: string) => {
    try {
      const data = await skillService.list(agentId)
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to list skills', { error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_Install, async (_, options) => {
    try {
      const data = await skillService.install(options)
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to install skill', { options, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_Uninstall, async (_, skillId: string) => {
    try {
      await skillService.uninstall(skillId)
      return { success: true, data: undefined }
    } catch (error) {
      logger.error('Failed to uninstall skill', { skillId, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_Toggle, async (_, options) => {
    try {
      if (
        !options ||
        typeof options.skillId !== 'string' ||
        !options.skillId ||
        typeof options.agentId !== 'string' ||
        !options.agentId ||
        typeof options.isEnabled !== 'boolean'
      ) {
        return { success: false, error: 'Invalid toggle options' }
      }
      const data = await skillService.toggle(options)
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to toggle skill', { options, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_InstallFromZip, async (_, options) => {
    try {
      const data = await skillService.installFromZip(options)
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to install skill from ZIP', { options, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_InstallFromDirectory, async (_, options) => {
    try {
      const data = await skillService.installFromDirectory(options)
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to install skill from directory', { options, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_ReadFile, async (_, skillId: string, filename: string) => {
    try {
      const data = await skillService.readFile(skillId, filename)
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to read skill file', { skillId, filename, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_ListFiles, async (_, skillId: string) => {
    try {
      const data = await skillService.listFiles(skillId)
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to list skill files', { skillId, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_ListLocal, async (_, workdir: string) => {
    try {
      if (!workdir || typeof workdir !== 'string') {
        return { success: false, error: 'Invalid workdir' }
      }
      const data = await skillService.listLocal(workdir)
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to list local plugins', { workdir, error })
      return { success: false, error }
    }
  })

  // MainWindow_CrashRenderProcess handler moved into MainWindowService (dev-only).

  // WeChat
  ipcMain.handle(IpcChannel.WeChat_HasCredentials, async (_, channelId: string) => {
    const tokenPath = application.getPath('feature.agents.channels', `weixin_bot_${channelId}.json`)
    try {
      const raw = await fs.promises.readFile(tokenPath, 'utf8')
      const parsed = JSON.parse(raw)
      return { exists: true, userId: parsed.userId as string | undefined }
    } catch {
      return { exists: false }
    }
  })
}
