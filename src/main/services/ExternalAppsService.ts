import { loggerService } from '@logger'
import type { ExternalAppConfig, ExternalAppId, ExternalAppInfo } from '@shared/types/externalApp'
import { spawn } from 'child_process'
import { app } from 'electron'
import { lstatSync, statSync } from 'fs'
import path from 'path'

const logger = loggerService.withContext('ExternalAppsService')

const EXTERNAL_APPS: readonly ExternalAppConfig[] = [
  { id: 'vscode', name: 'Visual Studio Code', protocol: 'vscode://', tags: ['code-editor'] },
  { id: 'cursor', name: 'Cursor', protocol: 'cursor://', tags: ['code-editor'] },
  { id: 'zed', name: 'Zed', protocol: 'zed://', tags: ['code-editor'] },
  // Windows Terminal registers no URL protocol; it is launched via the `wt.exe`
  // App Execution Alias with `wt.exe -d <directory>`.
  { id: 'wt', name: 'Windows Terminal', executable: 'wt.exe', tags: ['terminal'] }
]

class ExternalAppsService {
  private cache: { apps: ExternalAppInfo[]; timestamp: number } | null = null
  private readonly CACHE_DURATION = 1000 * 60 * 5 // 5 minutes

  async detectInstalledApps(): Promise<ExternalAppInfo[]> {
    if (this.cache && Date.now() - this.cache.timestamp < this.CACHE_DURATION) {
      return this.cache.apps
    }

    const results = (
      await Promise.all(
        EXTERNAL_APPS.map(async (appConfig) => {
          try {
            const info = appConfig.executable
              ? this.detectExecutableApp(appConfig)
              : await this.detectProtocolApp(appConfig)
            if (!info) {
              return null
            }
            logger.info(`Detected ${appConfig.name} at ${info.path}`)

            return info
          } catch (error) {
            logger.debug(`Failed to detect ${appConfig.name}:`, error as Error)
            return null
          }
        })
      )
    ).filter((result) => result !== null)

    this.cache = { apps: results, timestamp: Date.now() }
    return results
  }

  /**
   * Launch an executable-based external app (e.g. Windows Terminal) against a
   * target path. When the target is a file, the terminal opens in the file's
   * containing directory so "open in terminal" always lands on a working
   * directory.
   */
  async open(appId: ExternalAppId, targetPath: string): Promise<void> {
    const config = EXTERNAL_APPS.find((c) => c.id === appId)
    if (!config?.executable) {
      throw new Error(`External app "${appId}" cannot be launched as a process`)
    }
    const executablePath = this.resolveExecutablePath(config)
    if (!executablePath) {
      throw new Error(`Executable for external app "${appId}" was not found`)
    }
    const directory = this.resolveTerminalDirectory(targetPath)
    const launchContext = { appId, executablePath, targetPath, directory }
    logger.info('Launching external app', launchContext)

    await new Promise<void>((resolve, reject) => {
      // Windows Terminal is a GUI app; hiding the spawned process also hides its window.
      const child = spawn(executablePath, ['-d', directory], { env: process.env, shell: false, windowsHide: false })
      let settled = false

      child.on('error', (error) => {
        if (settled) return
        settled = true
        logger.error('Failed to launch external app', error, { appId, executablePath, targetPath, directory })
        reject(error)
      })
      child.on('close', (code, signal) => {
        if (settled) return
        settled = true
        if (code === 0) {
          logger.info('External app launched', launchContext)
          resolve()
          return
        }
        logger.warn('External app exited unsuccessfully', {
          appId,
          executablePath,
          targetPath,
          directory,
          exitCode: code,
          signal
        })
        reject(new Error(`"${config.name}" exited with code ${code}`))
      })
    })
  }

  private async detectProtocolApp(appConfig: ExternalAppConfig): Promise<ExternalAppInfo | null> {
    if (!appConfig.protocol) {
      return null
    }
    const info = await app.getApplicationInfoForProtocol(appConfig.protocol)
    if (!info.name) {
      return null
    }
    return { ...appConfig, path: info.path }
  }

  private detectExecutableApp(appConfig: ExternalAppConfig): ExternalAppInfo | null {
    const executablePath = this.resolveExecutablePath(appConfig)
    if (!executablePath) {
      return null
    }
    try {
      // App Execution Aliases are reparse points. `lstatSync` inspects the alias
      // itself instead of following it, which can fail with EACCES on Windows.
      lstatSync(executablePath)
      return { ...appConfig, path: executablePath }
    } catch {
      return null
    }
  }

  private resolveExecutablePath(appConfig: ExternalAppConfig): string | null {
    if (process.platform !== 'win32' || !appConfig.executable) {
      return null
    }
    const localAppData = process.env.LOCALAPPDATA
    if (!localAppData) {
      return null
    }
    // Windows Terminal (Store app) registers its `wt.exe` App Execution Alias here.
    // `path.win32` keeps the resulting path deterministic (backslash-separated) even
    // when the service is exercised on a non-Windows host (e.g. CI unit tests).
    return path.win32.join(localAppData, 'Microsoft', 'WindowsApps', appConfig.executable)
  }

  private resolveTerminalDirectory(targetPath: string): string {
    try {
      if (statSync(targetPath).isFile()) {
        // Same rationale as resolveExecutablePath: `path.win32` keeps Windows path
        // handling deterministic regardless of the host the process runs on.
        return path.win32.dirname(targetPath)
      }
      return targetPath
    } catch {
      // The target does not exist yet (e.g. an unsaved artifact draft). If it
      // looks like a file path — the final segment contains a dot — open the
      // terminal in the containing directory instead of passing the file path
      // to `wt.exe -d` (which would fail).
      if (path.win32.basename(targetPath).includes('.')) {
        return path.win32.dirname(targetPath)
      }
      return targetPath
    }
  }
}

export const externalAppsService = new ExternalAppsService()
