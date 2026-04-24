import { exec } from 'node:child_process'
import fs from 'node:fs/promises'
import { promisify } from 'node:util'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { app } from 'electron'

import { handleMcpProtocolUrl } from './handlers/mcpInstall'
import { handleNavigateProtocolUrl } from './handlers/navigate'
import { handleProvidersProtocolUrl } from './handlers/providersImport'

export const CHERRY_STUDIO_PROTOCOL = 'cherrystudio'

const DESKTOP_FILE_NAME = 'cherrystudio-url-handler.desktop'
const execAsync = promisify(exec)
const logger = loggerService.withContext('ProtocolService')

@Injectable('ProtocolService')
@ServicePhase(Phase.Background)
// IMPORTANT: do NOT add @DependsOn(['MainWindowService']). MainWindowService is WhenReady,
// and auto-adjust would bump this service to WhenReady, causing macOS cold-start
// open-url events to fire before our listener attaches. MainWindowService is resolved
// at call time inside listener callbacks — safe because OS events fire post-bootstrap.
export class ProtocolService extends BaseService {
  protected async onInit() {
    // NOTE: Background phase's onInit runs on the first microtask after startPhase(),
    // which is before app.whenReady() (an OS-level event requiring the event loop).
    // This guarantees our open-url listener is attached before macOS cold-start URLs fire.

    // 1) Register OS-level protocol scheme
    this.registerProtocolScheme()

    // 2) macOS open-url listener (cold + hot start)
    const openUrlHandler = (event: Electron.Event, url: string) => {
      event.preventDefault()
      this.handleProtocolUrl(url)
    }
    app.on('open-url', openUrlHandler)
    this.registerDisposable(() => app.removeListener('open-url', openUrlHandler))

    // 3) Windows/Linux second-instance: URL-dispatch only.
    //    MainWindowService attaches a SEPARATE listener on the same event for showMainWindow().
    //    Both fire; EventEmitter supports multiple listeners. See MainWindowService.onInit.
    const secondInstanceHandler = (_event: Electron.Event, argv: string[]) => {
      this.handleArgvForUrl(argv)
    }
    app.on('second-instance', secondInstanceHandler)
    this.registerDisposable(() => app.removeListener('second-instance', secondInstanceHandler))

    // 4) Windows/Linux cold-start: initial argv may contain the URL
    this.handleArgvForUrl(process.argv)
  }

  protected async onAllReady() {
    // Runs after all bootstrap phases — application.getPath() is safe
    await this.setupAppImageDeepLink()
  }

  private registerProtocolScheme() {
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient(CHERRY_STUDIO_PROTOCOL, process.execPath, [process.argv[1]])
      }
    }

    app.setAsDefaultProtocolClient(CHERRY_STUDIO_PROTOCOL)
  }

  private handleProtocolUrl(url: string) {
    if (!url) return

    const urlObj = new URL(url)
    const params = new URLSearchParams(urlObj.search)

    switch (urlObj.hostname.toLowerCase()) {
      case 'mcp':
        handleMcpProtocolUrl(urlObj)
        return
      case 'providers':
        void handleProvidersProtocolUrl(urlObj)
        return
      case 'navigate':
        handleNavigateProtocolUrl(urlObj)
        return
    }

    application.get('WindowManager').broadcastToType(WindowType.Main, 'protocol-data', {
      url,
      params: Object.fromEntries(params.entries())
    })
  }

  private handleArgvForUrl(args: string[]) {
    const url = args.find((arg) => arg.startsWith(CHERRY_STUDIO_PROTOCOL + '://'))
    if (url) this.handleProtocolUrl(url)
  }

  /**
   * Sets up deep linking for the AppImage build on Linux by creating a .desktop file.
   * This allows the OS to open cherrystudio:// URLs with this App.
   */
  private async setupAppImageDeepLink(): Promise<void> {
    // Only run on Linux and when packaged as an AppImage
    if (process.platform !== 'linux' || !process.env.APPIMAGE) {
      return
    }

    logger.debug('AppImage environment detected on Linux, setting up deep link.')

    try {
      const appPath = application.getPath('app.exe_file')
      if (!appPath) {
        logger.error('Could not determine App path.')
        return
      }

      const desktopFileContent = `[Desktop Entry]
Name=Cherry Studio
Exec=${escapePathForExec(appPath)} %U
Terminal=false
Type=Application
MimeType=x-scheme-handler/${CHERRY_STUDIO_PROTOCOL};
NoDisplay=true
`

      // auto-ensure creates ~/.local/share/applications/ on first getPath() call
      const desktopFilePath = application.getPath('feature.protocol.desktop_entries', DESKTOP_FILE_NAME)
      await fs.writeFile(desktopFilePath, desktopFileContent, 'utf-8')
      logger.debug(`Created/Updated desktop file: ${desktopFilePath}`)

      try {
        const { stdout, stderr } = await execAsync(
          `update-desktop-database ${escapePathForExec(application.getPath('feature.protocol.desktop_entries'))}`
        )
        if (stderr) {
          logger.warn(`update-desktop-database stderr: ${stderr}`)
        }
        logger.debug(`update-desktop-database stdout: ${stdout}`)
        logger.debug('Desktop database updated successfully.')
      } catch (updateError) {
        logger.error('Failed to update desktop database:', updateError as Error)
      }
    } catch (error) {
      logger.error('Failed to setup AppImage deep link:', error as Error)
    }
  }
}

/**
 * Escapes a path for safe use within the Exec field of a .desktop file
 * and for shell commands.
 */
function escapePathForExec(filePath: string): string {
  return `'${filePath.replace(/'/g, "'\\''")}'`
}
