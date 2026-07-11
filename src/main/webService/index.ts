// WebUI远程扩展，仅Win11启用，最小侵入
import { platform, release } from 'node:os'
import { join } from 'node:path'

import { application } from '@application'
import { agentSessionService } from '@data/services/AgentSessionService'
import { loggerService } from '@logger'
import { createLatestReconciler, type LatestReconciler } from '@main/core/concurrency/latestReconciler'
import { type Activatable, BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { app } from 'electron'

import { createWebUiSseRelay, type WebUiSseRelay } from './sseRelay'
import { createWebUiStaticServer, type WebUiStaticServer } from './staticServer'

export const WEBUI_DEFAULT_PORT = 5820
export const WEBUI_MIN_PORT = 1024
export const WEBUI_MAX_PORT = 65535

const logger = loggerService.withContext('WebUiService')

export type WebUiServiceStartOptions = {
  readonly distRoot: string
  readonly enabled: boolean
  readonly host?: string
  readonly port?: number
}

export type WebUiServiceStartResult =
  | {
      readonly status: 'started'
      readonly port: number
    }
  | {
      readonly status: 'skipped'
      readonly reason: 'disabled' | 'unsupported-system'
    }

export const isWindows11 = () => {
  if (platform() !== 'win32') return false
  const buildNumber = Number.parseInt(release().split('.')[2] ?? '0', 10)

  return Number.isFinite(buildNumber) && buildNumber >= 22_000
}

export const normalizeWebUiPort = (port = WEBUI_DEFAULT_PORT) => {
  if (!Number.isInteger(port) || port < WEBUI_MIN_PORT || port > WEBUI_MAX_PORT) {
    return WEBUI_DEFAULT_PORT
  }

  return port
}

@Injectable('WebUiService')
@DependsOn(['PreferenceService', 'CacheService', 'DataApiService', 'AgentSessionRuntimeService'])
@ServicePhase(Phase.WhenReady)
export class WebUiService extends BaseService implements Activatable {
  private staticServer?: WebUiStaticServer
  private sseRelay?: WebUiSseRelay
  private syncFingerprint?: string
  private syncMonitor?: ReturnType<typeof setInterval>
  private desiredEnabled = false
  private desiredPort = WEBUI_DEFAULT_PORT
  private activePort?: number
  private readonly reconciler: LatestReconciler<{ desiredEnabled: boolean; desiredPort: number; activePort?: number }> =
    createLatestReconciler({
      name: 'webUi',
      getSnapshot: () => ({
        desiredEnabled: this.desiredEnabled,
        desiredPort: this.desiredPort,
        activePort: this.activePort
      }),
      isSettled: ({ desiredEnabled, desiredPort, activePort }) =>
        desiredEnabled === this.isActivated && (!desiredEnabled || desiredPort === activePort),
      apply: async ({ desiredEnabled, desiredPort, activePort }) => {
        if (desiredEnabled) {
          if (this.isActivated && activePort !== desiredPort) {
            await this.deactivate()
          }
          await this.activate()
        } else {
          await this.deactivate()
        }
      },
      onError: (error) => {
        this.publishRunningState(false)
        logger.error('Failed to reconcile WebUI service', error as Error)
      }
    })

  get isRunning() {
    return Boolean(this.staticServer)
  }

  protected onInit(): void {
    this.publishSupportedState(true)
    const preferenceService = application.get('PreferenceService')
    const reconcile = () => {
      this.loadPreferenceState()
      this.reconciler.request()
    }

    this.registerDisposable(preferenceService.subscribeChange('feature.webui.enabled', reconcile))
    this.registerDisposable(preferenceService.subscribeChange('feature.webui.port', reconcile))
  }

  protected async onReady(): Promise<void> {
    this.loadPreferenceState()
    this.reconciler.request()
    await this.reconciler.flush()
  }

  protected async onStop(): Promise<void> {
    await this.stopStaticServer()
    this.publishRunningState(false)
    this.publishSupportedState(false)
  }

  async onActivate(): Promise<void> {
    try {
      await this.startStaticServer(this.desiredPort)
      this.publishRunningState(true)
      logger.info(`WebUI service listening on port ${this.desiredPort}`)
    } catch (error) {
      await this.stopStaticServer().catch(() => {})
      this.publishRunningState(false)
      throw error
    }
  }

  async onDeactivate(): Promise<void> {
    await this.stopStaticServer()
    this.publishRunningState(false)
  }

  async start({
    distRoot,
    enabled,
    host = '0.0.0.0',
    port
  }: WebUiServiceStartOptions): Promise<WebUiServiceStartResult> {
    if (!enabled) {
      return { status: 'skipped', reason: 'disabled' }
    }

    if (!isWindows11()) {
      return { status: 'skipped', reason: 'unsupported-system' }
    }

    const normalizedPort = normalizeWebUiPort(port)
    await this.stopStaticServer()
    await this.startStaticServer(normalizedPort, distRoot, host)

    return {
      status: 'started',
      port: normalizedPort
    }
  }

  async stop() {
    await this.stopStaticServer()
  }

  private async startStaticServer(port: number, distRoot = join(app.getAppPath(), 'webui', 'dist'), host = '0.0.0.0') {
    this.sseRelay = createWebUiSseRelay()
    this.staticServer = createWebUiStaticServer({
      distRoot,
      host,
      port,
      sseRelay: this.sseRelay
    })

    try {
      await this.staticServer.start()
    } catch (error) {
      this.sseRelay.close()
      this.sseRelay = undefined
      this.staticServer = undefined
      throw error
    }
    this.startSyncMonitor()
    this.activePort = port
  }

  private async stopStaticServer() {
    if (this.syncMonitor) clearInterval(this.syncMonitor)
    this.syncMonitor = undefined
    this.syncFingerprint = undefined

    const sseRelay = this.sseRelay
    const staticServer = this.staticServer
    this.sseRelay = undefined
    this.staticServer = undefined
    this.activePort = undefined

    sseRelay?.close()
    await staticServer?.stop()
  }

  private loadPreferenceState(): void {
    const preferenceService = application.get('PreferenceService')
    this.desiredEnabled = preferenceService.get('feature.webui.enabled')
    this.desiredPort = normalizeWebUiPort(preferenceService.get('feature.webui.port'))
  }

  private publishSupportedState(supported: boolean): void {
    application.get('CacheService').setShared('feature.webui.supported', supported)
  }

  private publishRunningState(running: boolean): void {
    application.get('CacheService').setShared('feature.webui.running', running)
  }

  private startSyncMonitor() {
    const checkForDesktopChanges = () => {
      try {
        const sessionFingerprints: string[] = []
        const seenCursors = new Set<string>()
        let cursor: string | undefined
        do {
          const page = agentSessionService.listByCursor({ cursor, limit: 200 })
          sessionFingerprints.push(...page.items.map((session) => `${session.id}:${session.updatedAt}`))
          cursor = page.nextCursor
          if (cursor && seenCursors.has(cursor)) break
          if (cursor) seenCursors.add(cursor)
        } while (cursor)
        const nextFingerprint = sessionFingerprints.join('|')

        if (this.syncFingerprint !== undefined && this.syncFingerprint !== nextFingerprint) {
          this.sseRelay?.broadcast({
            event: 'sync',
            data: { reason: 'desktop-data-changed' }
          })
        }
        this.syncFingerprint = nextFingerprint
      } catch {
        // Data services can be unavailable briefly during startup or shutdown.
      }
    }

    checkForDesktopChanges()
    this.syncMonitor = setInterval(checkForDesktopChanges, 1_000)
    this.syncMonitor.unref()
  }
}
