import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { handleGuarded } from '@main/core/security/guardedIpc'
import {
  listDirectory as searchListDirectory,
  listDirectoryEntries as searchListDirectoryEntries
} from '@main/services/file'
import { deleteTransferFile } from '@main/services/lanTransfer'
import { hasWritePermission, isPathInside, untildify } from '@main/utils/legacyFile'
import { IpcChannel } from '@shared/IpcChannel'
import { BrowserWindow, dialog } from 'electron'

import { skillService } from './ai/skills/SkillService'
import { appService } from './services/AppService'
import { copilotService } from './services/CopilotService'
import { externalAppsService } from './services/ExternalAppsService'
import { fileStorage as fileManager } from './services/FileStorage'
import FileService from './services/FileSystemService'
import * as NutstoreService from './services/nutstore/NutstoreService'
import { decrypt } from './utils/aes'
import { getHostname } from './utils/system'
import { decompress } from './utils/zip'

const logger = loggerService.withContext('IPC')

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
  // Application lifecycle handlers live in core/application/Application.ts (registerApplicationIpc).

  // spell check languages
  handleGuarded(IpcChannel.App_SetSpellCheckLanguages, (_, languages: string[]) => {
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
  handleGuarded(IpcChannel.App_SetLaunchOnBoot, async (_, isLaunchOnBoot: boolean) => {
    await appService.setAppLaunchOnBoot(isLaunchOnBoot)
  })

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

  handleGuarded(IpcChannel.LanTransfer_DeleteFile, (_, filePath: string) => deleteTransferFile(filePath))

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

  // ExternalApps
  handleGuarded(IpcChannel.ExternalApps_DetectInstalled, () => externalAppsService.detectInstalledApps())

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
