import { exec } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isLinux } from '@main/core/platform'
import { WindowType } from '@main/core/window/types'
import { openSettingsInMainWindow } from '@main/services/mainWindowNavigation'
import type { ProtocolMcpInstallRequest } from '@shared/data/types/mcpProtocolInstall'
import type { McpServer } from '@shared/data/types/mcpServer'
import { app } from 'electron'

import { parseMcpInstallProtocolUrl } from './handlers/mcpInstall'
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
  private pendingProtocolUrls: string[] = []
  private pendingMcpInstallRequests: ProtocolMcpInstallRequest[] = []
  private areServicesReady = false
  private isMainRendererReady = false

  protected async onInit() {
    // NOTE: Background phase's onInit runs on the first microtask after startPhase(),
    // which is before app.whenReady() (an OS-level event requiring the event loop).
    // This guarantees our open-url listener is attached before macOS cold-start URLs fire.

    // 1) Register OS-level protocol scheme
    this.registerProtocolScheme()

    const windowManager = application.get('WindowManager')
    const markMainRendererNotReady = () => {
      this.isMainRendererReady = false
    }
    this.registerDisposable(
      windowManager.onWindowCreatedByType(WindowType.Main, ({ window }) => {
        window.webContents.on('did-start-loading', markMainRendererNotReady)
        window.webContents.on('render-process-gone', markMainRendererNotReady)
      })
    )
    this.registerDisposable(windowManager.onWindowDestroyedByType(WindowType.Main, markMainRendererNotReady))

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
    this.areServicesReady = true
    this.flushPendingProtocolUrls()

    // Runs after all bootstrap phases — application.getPath() is safe
    await this.setupAppImageDeepLink()
  }

  public onMainRendererReady(windowId: string) {
    if (application.get('WindowManager').getWindowType(windowId) !== WindowType.Main) {
      return
    }

    this.isMainRendererReady = true
    this.flushPendingProtocolUrls()
  }

  public listPendingMcpInstallRequests(windowId: string): ProtocolMcpInstallRequest[] {
    if (application.get('WindowManager').getWindowType(windowId) !== WindowType.Main) {
      return []
    }

    return [...this.pendingMcpInstallRequests]
  }

  public installPendingMcpInstallRequest(windowId: string, requestId: string): McpServer[] {
    const requestIndex = this.findPendingMcpInstallRequest(windowId, requestId)
    if (requestIndex === -1) {
      throw new Error('MCP protocol install request not found')
    }

    const createdServers = mcpServerService.createMany(this.pendingMcpInstallRequests[requestIndex].servers)
    this.pendingMcpInstallRequests.splice(requestIndex, 1)
    return createdServers
  }

  public cancelPendingMcpInstallRequest(windowId: string, requestId: string): void {
    const requestIndex = this.findPendingMcpInstallRequest(windowId, requestId)
    if (requestIndex !== -1) {
      this.pendingMcpInstallRequests.splice(requestIndex, 1)
    }
  }

  private findPendingMcpInstallRequest(windowId: string, requestId: string): number {
    if (application.get('WindowManager').getWindowType(windowId) !== WindowType.Main) {
      return -1
    }

    return this.pendingMcpInstallRequests.findIndex((request) => request.requestId === requestId)
  }

  private registerProtocolScheme() {
    // In dev, Electron needs the app entry as an absolute path; launchers often
    // pass "." as argv[1], which becomes invalid when the OS invokes the
    // protocol handler from a different cwd.
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        const entry = process.argv[1]
        const absoluteEntry = path.isAbsolute(entry) ? entry : path.resolve(process.cwd(), entry)
        app.setAsDefaultProtocolClient(CHERRY_STUDIO_PROTOCOL, process.execPath, [absoluteEntry])
      }
    } else {
      app.setAsDefaultProtocolClient(CHERRY_STUDIO_PROTOCOL)
    }
  }

  private handleProtocolUrl(url: string) {
    if (!url) return

    if (
      !this.areServicesReady ||
      (!this.isMainRendererReady && (this.pendingProtocolUrls.length > 0 || !this.isMainWindowNavigationUrl(url)))
    ) {
      this.pendingProtocolUrls.push(url)
      return
    }

    this.dispatchProtocolUrl(url)
  }

  private flushPendingProtocolUrls() {
    if (!this.areServicesReady) return

    const pendingUrls = this.pendingProtocolUrls.splice(0)
    let blockedOnRenderer = false
    for (const url of pendingUrls) {
      // Navigate deep links can enter the unified main-window delivery queue
      // before the renderer mounts. Dispatch them here so their order relative
      // to routes requested through IPC/menu sources is decided by one queue.
      // Other protocol hosts still require a live renderer for broadcast or UI.
      if (this.isMainRendererReady || (!blockedOnRenderer && this.isMainWindowNavigationUrl(url))) {
        this.dispatchProtocolUrl(url)
      } else {
        blockedOnRenderer = true
        this.pendingProtocolUrls.push(url)
      }
    }
  }

  private isMainWindowNavigationUrl(url: string): boolean {
    try {
      return new URL(url).hostname.toLowerCase() === 'navigate'
    } catch {
      return false
    }
  }

  private dispatchProtocolUrl(url: string) {
    try {
      const urlObj = new URL(url)
      const params = new URLSearchParams(urlObj.search)

      switch (urlObj.hostname.toLowerCase()) {
        case 'mcp':
          this.handleMcpInstallProtocolUrl(urlObj)
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
          application
            .get('OAuthRuntimeService')
            .handleDeepLinkCallback(urlObj)
            .catch((error) => logger.error('Failed to handle OAuth callback', error as Error))
          return
      }

      // Default branch: deep link with no main-process handler. Fan out to every
      // managed renderer (Main / SubWindow / pooled tool surfaces);
      // consumers (oauth.ts, useNutstoreSso, ...) filter by urlObj.hostname/pathname.
      // broadcast() — not broadcastToType(Main) — because the flow-initiating
      // window is not necessarily Main. Trade-off: the payload reaches renderers that don't need it; if
      // selective routing is required (e.g. to confine OAuth `code`), promote
      // that scheme to its own switch case alongside mcp/providers/navigate.
      //
      // TODO(security): any future OAuth-style host added to this scheme MUST
      // get its own switch case above instead of falling through here — leaving
      // it on the default broadcast would fan out `code` / `token` query params
      // to renderers that have no business seeing them. Reviewer flagged in
      // PR #14631 review #4282327822 (Important #5). When adding such a host,
      // either route it through a dedicated case or add a parameter allowlist /
      // sensitive-name strip to this default broadcast.
      application.get('IpcApiService').broadcast('navigation.protocol_data', {
        url,
        params: Object.fromEntries(params.entries())
      })
    } catch (error) {
      logger.error('Failed to handle protocol URL', error as Error)
    }
  }

  private handleMcpInstallProtocolUrl(url: URL) {
    const servers = parseMcpInstallProtocolUrl(url)
    if (!servers) {
      application.get('MainWindowService').showMainWindow()
      return
    }

    const requestId = randomUUID()
    this.pendingMcpInstallRequests.push({ requestId, servers })
    logger.debug('Prepared MCP protocol install preview', { count: servers.length })
    openSettingsInMainWindow(`/settings/mcp/servers?protocolInstallRequestId=${requestId}`)
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
    if (!isLinux || !process.env.APPIMAGE) {
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
