import path from 'node:path'

import { loggerService } from '@logger'
import { handleGuarded } from '@main/core/security/guardedIpc'
import {
  listDirectory as searchListDirectory,
  listDirectoryEntries as searchListDirectoryEntries
} from '@main/services/file'
import { hasWritePermission, isPathInside, untildify } from '@main/utils/legacyFile'
import { IpcChannel } from '@shared/IpcChannel'
import { dialog } from 'electron'

import { skillService } from './ai/skills/SkillService'
import { copilotService } from './services/CopilotService'
import { fileStorage as fileManager } from './services/FileStorage'
import FileService from './services/FileSystemService'
import { legacyBackupManager as backupManager } from './services/LegacyBackupManager'
import * as NutstoreService from './services/nutstore/NutstoreService'
import { decrypt } from './utils/aes'
import { getHostname } from './utils/system'
import { decompress } from './utils/zip'

const logger = loggerService.withContext('IPC')

export async function registerIpc() {
  void backupManager.cleanupStaleTempArtifacts()

  // [v2] Removed: Redux persistor flush is no longer needed after v2 data refactoring
  // const powerService = application.get('PowerService')
  // powerService.registerShutdownHandler(() => {
  //   const mw = application.get('MainWindowService').getMainWindow()
  //   if (mw && !mw.isDestroyed()) {
  //     mw.webContents.send(IpcChannel.App_SaveData)
  //   }
  // })

  // MainWindow_Reload handler moved into MainWindowService.registerIpcHandlers.
  // Application lifecycle handlers live in core/application/Application.ts (registerApplicationIpc).

  // // theme
  // handleGuarded(IpcChannel.App_SetTheme, (_, theme: ThemeMode) => {
  //   themeService.setTheme(theme)
  // })

  // Select app data path
  handleGuarded(IpcChannel.App_Select, async (_, options: Electron.OpenDialogOptions) => {
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

  handleGuarded(IpcChannel.App_HasWritePermission, async (_, filePath: string) => {
    const hasPermission = await hasWritePermission(filePath)
    return hasPermission
  })

  handleGuarded(IpcChannel.App_ResolvePath, async (_, filePath: string) => {
    return path.resolve(untildify(filePath))
  })

  // Check if a path is inside another path (proper parent-child relationship)
  handleGuarded(IpcChannel.App_IsPathInside, async (_, childPath: string, parentPath: string) => {
    return isPathInside(childPath, parentPath)
  })

  // Application_Relaunch is registered by Application.registerApplicationIpc()

  // zip
  handleGuarded(IpcChannel.Zip_Decompress, (_, text: Buffer) => decompress(text))

  // system
  handleGuarded(IpcChannel.System_GetHostname, getHostname)
  // Git Bash has no IPC: the Claude Code runtime resolves it in-process via
  // autoDiscoverGitBash() (ai/runtime/claudeCode/settingsBuilder.ts).

  // backup
  handleGuarded(IpcChannel.Backup_Backup, backupManager.backup.bind(backupManager))
  handleGuarded(IpcChannel.Backup_Restore, backupManager.restore.bind(backupManager))
  handleGuarded(IpcChannel.Backup_BackupToWebdav, async (event, config) => {
    const { result, cleanupError } = await backupManager.backupToWebdav(event, config)
    return { result, cleanupFailed: cleanupError !== null }
  })
  handleGuarded(IpcChannel.Backup_RestoreFromWebdav, backupManager.restoreFromWebdav.bind(backupManager))
  handleGuarded(IpcChannel.Backup_ListWebdavFiles, backupManager.listWebdavFiles.bind(backupManager))
  handleGuarded(IpcChannel.Backup_CheckConnection, backupManager.checkConnection.bind(backupManager))
  handleGuarded(IpcChannel.Backup_CreateDirectory, backupManager.createDirectory.bind(backupManager))
  handleGuarded(IpcChannel.Backup_DeleteWebdavFile, backupManager.deleteWebdavFile.bind(backupManager))
  handleGuarded(IpcChannel.Backup_BackupToLocalDir, async (event, fileName, config) => {
    const { result, cleanupError } = await backupManager.backupToLocalDir(event, fileName, config)
    return { result, cleanupFailed: cleanupError !== null }
  })
  handleGuarded(IpcChannel.Backup_RestoreFromLocalBackup, backupManager.restoreFromLocalBackup.bind(backupManager))
  handleGuarded(IpcChannel.Backup_ListLocalBackupFiles, backupManager.listLocalBackupFiles.bind(backupManager))
  handleGuarded(IpcChannel.Backup_DeleteLocalBackupFile, backupManager.deleteLocalBackupFile.bind(backupManager))
  handleGuarded(IpcChannel.Backup_BackupToS3, async (event, config) => {
    const { result, cleanupError } = await backupManager.backupToS3(event, config)
    return { result, cleanupFailed: cleanupError !== null }
  })
  handleGuarded(IpcChannel.Backup_RestoreFromS3, backupManager.restoreFromS3.bind(backupManager))
  handleGuarded(IpcChannel.Backup_ListS3Files, backupManager.listS3Files.bind(backupManager))
  handleGuarded(IpcChannel.Backup_DeleteS3File, backupManager.deleteS3File.bind(backupManager))
  handleGuarded(IpcChannel.Backup_CreateLanTransferBackup, backupManager.createLanTransferBackup.bind(backupManager))
  handleGuarded(IpcChannel.Backup_DeleteLanTransferBackup, backupManager.deleteLanTransferBackup.bind(backupManager))

  // file
  handleGuarded(IpcChannel.File_Open, fileManager.open.bind(fileManager))
  handleGuarded(IpcChannel.File_OpenPath, fileManager.openPath.bind(fileManager))
  handleGuarded(IpcChannel.File_Save, fileManager.save.bind(fileManager))
  handleGuarded(IpcChannel.File_Select, fileManager.selectFile.bind(fileManager))
  handleGuarded(IpcChannel.File_ReadExternal, fileManager.readExternalFile.bind(fileManager))
  handleGuarded(IpcChannel.File_DeleteExternalFile, fileManager.deleteExternalFile.bind(fileManager))
  handleGuarded(IpcChannel.File_DeleteExternalDir, fileManager.deleteExternalDir.bind(fileManager))
  handleGuarded(IpcChannel.File_Move, fileManager.moveFile.bind(fileManager))
  handleGuarded(IpcChannel.File_MoveDir, fileManager.moveDir.bind(fileManager))
  handleGuarded(IpcChannel.File_Rename, fileManager.renameFile.bind(fileManager))
  handleGuarded(IpcChannel.File_RenameDir, fileManager.renameDir.bind(fileManager))
  handleGuarded(IpcChannel.File_Get, fileManager.getFile.bind(fileManager))
  handleGuarded(IpcChannel.File_SelectFolder, fileManager.selectFolder.bind(fileManager))
  handleGuarded(IpcChannel.File_CreateTempFile, fileManager.createTempFile.bind(fileManager))
  handleGuarded(IpcChannel.File_Mkdir, fileManager.mkdir.bind(fileManager))
  handleGuarded(IpcChannel.File_Write, fileManager.writeFile.bind(fileManager))
  handleGuarded(IpcChannel.File_SaveImage, fileManager.saveImage.bind(fileManager))
  handleGuarded(IpcChannel.File_BinaryImage, fileManager.binaryImage.bind(fileManager))
  handleGuarded(IpcChannel.File_ListDirectory, (_e, dirPath, options) => searchListDirectory(dirPath, options))
  handleGuarded(IpcChannel.File_ListDirectoryEntries, (_e, dirPath, options) =>
    searchListDirectoryEntries(dirPath, options)
  )
  handleGuarded(IpcChannel.File_CheckFileName, fileManager.fileNameGuard.bind(fileManager))
  handleGuarded(IpcChannel.File_ValidateNotesDirectory, fileManager.validateNotesDirectory.bind(fileManager))
  handleGuarded(IpcChannel.File_BatchUploadMarkdown, fileManager.batchUploadMarkdownFiles.bind(fileManager))
  handleGuarded(IpcChannel.File_ShowInFolder, fileManager.showInFolder.bind(fileManager))

  // fs
  handleGuarded(IpcChannel.Fs_Read, FileService.readFile.bind(FileService))
  handleGuarded(IpcChannel.Fs_ReadText, FileService.readTextFileWithAutoEncoding.bind(FileService))

  // aes
  handleGuarded(IpcChannel.Aes_Decrypt, (_, encryptedData: string, iv: string, secretKey: string) =>
    decrypt(encryptedData, iv, secretKey)
  )

  //copilot
  handleGuarded(IpcChannel.Copilot_GetAuthMessage, copilotService.getAuthMessage.bind(copilotService))
  handleGuarded(IpcChannel.Copilot_GetCopilotToken, copilotService.getCopilotToken.bind(copilotService))
  handleGuarded(IpcChannel.Copilot_SaveCopilotToken, copilotService.saveCopilotToken.bind(copilotService))
  handleGuarded(IpcChannel.Copilot_GetToken, copilotService.getToken.bind(copilotService))
  handleGuarded(IpcChannel.Copilot_Logout, copilotService.logout.bind(copilotService))
  handleGuarded(IpcChannel.Copilot_GetUser, copilotService.getUser.bind(copilotService))

  // nutstore
  handleGuarded(IpcChannel.Nutstore_GetSsoUrl, NutstoreService.getNutstoreSSOUrl.bind(NutstoreService))
  handleGuarded(IpcChannel.Nutstore_DecryptToken, (_, token: string) => NutstoreService.decryptToken(token))
  handleGuarded(IpcChannel.Nutstore_GetDirectoryContents, (_, token: string, path: string) =>
    NutstoreService.getDirectoryContents(token, path)
  )

  // Global Skills: install / uninstall / install-from-zip / install-from-directory / list-local
  // migrated to IpcApi (skill.*). read-file / list-files stay on legacy IPC (roadmap placeholders).
  handleGuarded(IpcChannel.Skill_ReadFile, async (_, skillId: string, filename: string) => {
    try {
      const data = await skillService.readFile(skillId, filename)
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to read skill file', { skillId, filename, error })
      return { success: false, error }
    }
  })

  handleGuarded(IpcChannel.Skill_ListFiles, async (_, skillId: string) => {
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
