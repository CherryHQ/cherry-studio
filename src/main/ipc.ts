import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import {
  listDirectory as searchListDirectory,
  listDirectoryEntries as searchListDirectoryEntries
} from '@main/services/file'
import { hasWritePermission, isPathInside, untildify } from '@main/utils/legacyFile'
import { IpcChannel } from '@shared/IpcChannel'
import { BrowserWindow, dialog, ipcMain, session } from 'electron'

import { skillService } from './ai/skills/SkillService'
import { appService } from './services/AppService'
import { copilotService } from './services/CopilotService'
import { externalAppsService } from './services/ExternalAppsService'
import { fileStorage as fileManager } from './services/FileStorage'
import FileService from './services/FileSystemService'
import LegacyBackupManager from './services/LegacyBackupManager'
import * as NutstoreService from './services/nutstore/NutstoreService'
import { decrypt } from './utils/aes'
import { getDirectorySize } from './utils/fileOperations'
import { getHostname } from './utils/system'
import { decompress } from './utils/zip'

const logger = loggerService.withContext('IPC')

const backupManager = new LegacyBackupManager()

export async function registerIpc() {
  // [v2] Removed: Redux persistor flush is no longer needed after v2 data refactoring
  // const powerService = application.get('PowerService')
  // powerService.registerShutdownHandler(() => {
  //   const mw = application.get('MainWindowService').getMainWindow()
  //   if (mw && !mw.isDestroyed()) {
  //     mw.webContents.send(IpcChannel.App_SaveData)
  //   }
  // })

  // MainWindow_Reload handler moved into MainWindowService.registerIpcHandlers.
  // Application_Quit is registered by Application.registerApplicationIpc()

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

  // // theme
  // ipcMain.handle(IpcChannel.App_SetTheme, (_, theme: ThemeMode) => {
  //   themeService.setTheme(theme)
  // })

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
      const sizeInBytes = await getDirectorySize(cachePath)
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

  // Application_Relaunch migrated to IpcApi (`app.relaunch`); preventQuit/allowQuit stay on
  // Application.registerApplicationIpc().

  // zip
  ipcMain.handle(IpcChannel.Zip_Decompress, (_, text: Buffer) => decompress(text))

  // system
  ipcMain.handle(IpcChannel.System_GetHostname, getHostname)
  // Git Bash has no IPC: the Claude Code runtime resolves it in-process via
  // autoDiscoverGitBash() (ai/runtime/claudeCode/settingsBuilder.ts).

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
  ipcMain.handle(IpcChannel.Backup_CreateLanTransferBackup, backupManager.createLanTransferBackup.bind(backupManager))
  ipcMain.handle(IpcChannel.Backup_DeleteLanTransferBackup, backupManager.deleteLanTransferBackup.bind(backupManager))

  // file
  ipcMain.handle(IpcChannel.File_Open, fileManager.open.bind(fileManager))
  ipcMain.handle(IpcChannel.File_OpenPath, fileManager.openPath.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Save, fileManager.save.bind(fileManager))
  ipcMain.handle(IpcChannel.File_Select, fileManager.selectFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_ReadExternal, fileManager.readExternalFile.bind(fileManager))
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
  ipcMain.handle(IpcChannel.File_SaveImage, fileManager.saveImage.bind(fileManager))
  ipcMain.handle(IpcChannel.File_SavePastedImage, fileManager.savePastedImage.bind(fileManager))
  ipcMain.handle(IpcChannel.File_BinaryImage, fileManager.binaryImage.bind(fileManager))
  ipcMain.handle(IpcChannel.File_IsTextFile, fileManager.isTextFile.bind(fileManager))
  ipcMain.handle(IpcChannel.File_IsDirectory, fileManager.isDirectory.bind(fileManager))
  ipcMain.handle(IpcChannel.File_ListDirectory, (_e, dirPath, options) => searchListDirectory(dirPath, options))
  ipcMain.handle(IpcChannel.File_ListDirectoryEntries, (_e, dirPath, options) =>
    searchListDirectoryEntries(dirPath, options)
  )
  ipcMain.handle(IpcChannel.File_CheckFileName, fileManager.fileNameGuard.bind(fileManager))
  ipcMain.handle(IpcChannel.File_ValidateNotesDirectory, fileManager.validateNotesDirectory.bind(fileManager))
  ipcMain.handle(IpcChannel.File_BatchUploadMarkdown, fileManager.batchUploadMarkdownFiles.bind(fileManager))
  ipcMain.handle(IpcChannel.File_ShowInFolder, fileManager.showInFolder.bind(fileManager))

  // fs
  ipcMain.handle(IpcChannel.Fs_Read, FileService.readFile.bind(FileService))
  ipcMain.handle(IpcChannel.Fs_ReadText, FileService.readTextFileWithAutoEncoding.bind(FileService))

  // aes
  ipcMain.handle(IpcChannel.Aes_Decrypt, (_, encryptedData: string, iv: string, secretKey: string) =>
    decrypt(encryptedData, iv, secretKey)
  )

  //copilot
  ipcMain.handle(IpcChannel.Copilot_GetAuthMessage, copilotService.getAuthMessage.bind(copilotService))
  ipcMain.handle(IpcChannel.Copilot_GetCopilotToken, copilotService.getCopilotToken.bind(copilotService))
  ipcMain.handle(IpcChannel.Copilot_SaveCopilotToken, copilotService.saveCopilotToken.bind(copilotService))
  ipcMain.handle(IpcChannel.Copilot_GetToken, copilotService.getToken.bind(copilotService))
  ipcMain.handle(IpcChannel.Copilot_Logout, copilotService.logout.bind(copilotService))
  ipcMain.handle(IpcChannel.Copilot_GetUser, copilotService.getUser.bind(copilotService))

  // nutstore
  ipcMain.handle(IpcChannel.Nutstore_GetSsoUrl, NutstoreService.getNutstoreSSOUrl.bind(NutstoreService))
  ipcMain.handle(IpcChannel.Nutstore_DecryptToken, (_, token: string) => NutstoreService.decryptToken(token))
  ipcMain.handle(IpcChannel.Nutstore_GetDirectoryContents, (_, token: string, path: string) =>
    NutstoreService.getDirectoryContents(token, path)
  )

  // ExternalApps
  ipcMain.handle(IpcChannel.ExternalApps_DetectInstalled, () => externalAppsService.detectInstalledApps())

  // Global Skills: install / uninstall / install-from-zip / install-from-directory / list-local
  // migrated to IpcApi (skill.*). read-file / list-files stay on legacy IPC (roadmap placeholders).
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

  // MainWindow_CrashRenderProcess handler moved into MainWindowService (dev-only).
}
