import { exec } from 'node:child_process'
import fs from 'node:fs/promises'
import { promisify } from 'node:util'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { cherryINOAuthService } from '@main/services/CherryINOAuthService'
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

    // 3) Windows/Linux second-instance: sole owner.
    //    - argv carries `cherrystudio://...` → dispatch to URL handler; each handler
    //      self-routes focus (mcp / navigate raise Main, providers / oauth do not),
    //      so we never raise Main behind their backs.
    //    - argv carries no URL → plain re-launch (user double-clicked the icon while
    //      the app is running); surface the main window. MainWindowService is
    //      WhenReady, fully alive by the time any 'second-instance' can fire.
    const secondInstanceHandler = (_event: Electron.Event, argv: string[]) => {
      const url = argv.find((arg) => arg.startsWith(`${CHERRY_STUDIO_PROTOCOL}://`))
      if (url) {
        this.handleProtocolUrl(url)
      } else {
        application.get('MainWindowService').showMainWindow()
      }
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

    try {
      const urlObj = new URL(url)
      const params = new URLSearchParams(urlObj.search)

      switch (urlObj.hostname.toLowerCase()) {
        case 'mcp':
          handleMcpProtocolUrl(urlObj)
          return
        case 'providers':
          handleProvidersProtocolUrl(urlObj).catch((error) =>
            logger.error('Failed to handle providers protocol URL', error as Error)
          )
          return
        case 'navigate':
          handleNavigateProtocolUrl(urlObj)
          return
        case 'oauth':
          // CherryIN OAuth callback. CherryINOAuthService delivers the result
          // point-to-point to the renderer that started the flow, so the `code`
          // never reaches unrelated windows. PPIO/Nutstore deep links use
          // different hosts and still go through the broadcast fallback below.
          cherryINOAuthService
            .handleOAuthCallback(urlObj)
            .catch((error) => logger.error('Failed to handle CherryIN OAuth callback', error as Error))
          return
      }

      // Default branch: deep link with no main-process handler. Fan out to every
      // managed renderer (Main / Settings / SubWindow / pooled tool surfaces);
      // consumers (oauth.ts, useNutstoreSSO, ...) filter by urlObj.hostname/pathname.
      // broadcast() — not broadcastToType(Main) — because the flow-initiating
      // window is not necessarily Main: the Settings window owns CherryIN OAuth
      // in v2. Trade-off: the payload reaches renderers that don't need it; if
      // selective routing is required (e.g. to confine OAuth `code`), promote
      // that scheme to its own switch case alongside mcp/providers/navigate.
      application.get('WindowManager').broadcast('protocol-data', {
        url,
        params: Object.fromEntries(params.entries())
      })
    } catch (error) {
      logger.error('Failed to handle protocol URL', error as Error)
    }
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
