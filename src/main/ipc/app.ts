import fs from 'node:fs'
import { arch } from 'node:os'
import path from 'node:path'

import { loggerService } from '@logger'
import { isMac, isWin } from '@main/constant'
import { application } from '@main/core/application'
import { getIpCountry } from '@main/utils/ipService'
import { getBinaryPath, isBinaryExists, runInstallScript } from '@main/utils/process'
import { handleZoomFactor } from '@main/utils/zoom'
import { IpcChannel } from '@shared/IpcChannel'
import checkDiskSpace from 'check-disk-space'
import { BrowserWindow, dialog, ipcMain, session, shell, systemPreferences, webContents } from 'electron'
import fontList from 'font-list'

import { appService } from '../services/AppService'
import { fileStorage as fileManager } from '../services/FileStorage'
import { isSafeExternalUrl } from '../services/security'
import { calculateDirectorySize, getResourcePath } from '../utils'
import {
  getCacheDir,
  getConfigDir,
  getFilesDir,
  getNotesDir,
  hasWritePermission,
  isPathInside,
  untildify
} from '../utils/file'
import { updateAppDataConfig } from '../utils/init'
import { backupManager } from './backup'

const logger = loggerService.withContext('IPC:App')

export function registerAppIpc(mainWindow: BrowserWindow, app: Electron.App) {
  ipcMain.handle(IpcChannel.App_Info, () => ({
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    filesPath: getFilesDir(),
    notesPath: getNotesDir(),
    configPath: getConfigDir(),
    appDataPath: app.getPath('userData'),
    resourcesPath: getResourcePath(),
    logsPath: logger.getLogsDir(),
    arch: arch(),
    isPortable: isWin && 'PORTABLE_EXECUTABLE_DIR' in process.env,
    installPath: path.dirname(app.getPath('exe'))
  }))

  ipcMain.handle(IpcChannel.App_Reload, () => mainWindow.reload())
  // Application_Quit is registered by Application.registerApplicationIpc()
  ipcMain.handle(IpcChannel.Open_Website, (_, url: string) => {
    if (!isSafeExternalUrl(url)) {
      logger.warn(`Blocked shell.openExternal for untrusted URL scheme: ${url}`)
      return
    }
    return shell.openExternal(url)
  })

  // language
  // ipcMain.handle(IpcChannel.App_SetLanguage, (_, language) => {
  //   configManager.setLanguage(language)
  // })

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

  // // launch to tray
  // ipcMain.handle(IpcChannel.App_SetLaunchToTray, (_, isActive: boolean) => {
  //   configManager.setLaunchToTray(isActive)
  // })

  // // tray
  // ipcMain.handle(IpcChannel.App_SetTray, (_, isActive: boolean) => {
  //   configManager.setTray(isActive)
  // })

  // // to tray on close
  // ipcMain.handle(IpcChannel.App_SetTrayOnClose, (_, isActive: boolean) => {
  //   configManager.setTrayOnClose(isActive)
  // })

  // // auto update
  // ipcMain.handle(IpcChannel.App_SetAutoUpdate, (_, isActive: boolean) => {
  //   appUpdater.setAutoUpdate(isActive)
  //   configManager.setAutoUpdate(isActive)
  // })

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

  ipcMain.handle(IpcChannel.App_SetFullScreen, (_, value: boolean): void => {
    mainWindow.setFullScreen(value)
  })

  ipcMain.handle(IpcChannel.App_IsFullScreen, (): boolean => {
    return mainWindow.isFullScreen()
  })

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
  // TODO: App_ResetData delegates to backupManager.resetData() — either this handler
  // should move to backup scope, or resetData should not be owned by BackupManager.
  ipcMain.handle(IpcChannel.App_ResetData, () => backupManager.resetData())

  ipcMain.handle(IpcChannel.App_IsBinaryExist, (_, name: string) => isBinaryExists(name))
  ipcMain.handle(IpcChannel.App_GetBinaryPath, (_, name: string) => getBinaryPath(name))
  ipcMain.handle(IpcChannel.App_InstallUvBinary, () => runInstallScript('install-uv.js'))
  ipcMain.handle(IpcChannel.App_InstallBunBinary, () => runInstallScript('install-bun.js'))
  ipcMain.handle(IpcChannel.App_InstallOvmsBinary, () => runInstallScript('install-ovms.js'))

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

  ipcMain.handle(IpcChannel.APP_CrashRenderProcess, () => {
    mainWindow.webContents.forcefullyCrashRenderer()
  })
}
