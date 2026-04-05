import { loggerService } from '@logger'
import { isWin } from '@main/constant'
import { autoDiscoverGitBash, getGitBashPathInfo, validateGitBashPath } from '@main/utils/process'
import { IpcChannel } from '@shared/IpcChannel'
import { BrowserWindow, ipcMain } from 'electron'

import { ConfigKeys, configManager } from '../services/ConfigManager'
import { getCpuName, getDeviceType, getHostname } from '../utils/system'

const logger = loggerService.withContext('IPC:System')

export function registerSystemIpc() {
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
}
