// WebUI desktop bridge — Windows / macOS / Linux
import { platform } from 'node:os'
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
export const WEBUI_DEFAULT_HOST = '127.0.0.1'

const logger = loggerService.withContext('WebUiService')

const IPV4_PATTERN = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/

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
      readonly host: string
    }
  | {
      readonly status: 'skipped'
      readonly reason: 'disabled' | 'unsupported-system' | 'missing-auth-key'
    }

/** Desktop hosts that may run the WebUI bridge. */
export const isWebUiHostSupported = () => {
  const os = platform()
  return os === 'win32' || os === 'darwin' || os === 'linux'
}

export const normalizeWebUiPort = (port = WEBUI_DEFAULT_PORT) => {
  if (!Number.isInteger(port) || port < WEBUI_MIN_PORT || port > WEBUI_MAX_PORT) {
    return WEBUI_DEFAULT_PORT
  }

  return port
}

export const normalizeWebUiHost = (host = WEBUI_DEFAULT_HOST) => {
  const trimmed = host.trim()
  if (trimmed === '0.0.0.0' || trimmed === '127.0.0.1') return trimmed
  if (IPV4_PATTERN.test(trimmed)) return trimmed
  return WEBUI_DEFAULT_HOST
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
  private desiredHost = WEBUI_DEFAULT_HOST
  private activePort?: number
  private activeHost?: string
  private readonly reconciler: LatestReconciler = createLatestReconciler<{
    desiredEnabled: boolean
    desiredPort: number
    desiredHost: string
    activePort?: number
    activeHost?: string
  }>({
    name: 'webUi',
    getSnapshot: () => ({
      desiredEnabled: this.desiredEnabled,
      desiredPort: this.desiredPort,
      desiredHost: this.desiredHost,
      activePort: this.activePort,
      activeHost: this.activeHost
    }),
    isSettled: ({ desiredEnabled, desiredPort, desiredHost, activePort, activeHost }) =>
      desiredEnabled === this.isActivated &&
      (!desiredEnabled || (desiredPort === activePort && desiredHost === activeHost)),
    apply: async ({ desiredEnabled, desiredPort, desiredHost, activePort, activeHost }) => {
      if (desiredEnabled) {
        if (this.isActivated && (activePort !== desiredPort || activeHost !== desiredHost)) {
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
    this.registerDisposable(preferenceService.subscribeChange('feature.webui.host', reconcile))
    this.registerDisposable(preferenceService.subscribeChange('feature.webui.auth_key', reconcile))
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
      const authKey = application.get('PreferenceService').get('feature.webui.auth_key').trim()
      if (!authKey) {
        // loadPreferenceState already requires a key; this is a hard safety net.
        logger.warn('WebUI start rejected: access key is required')
        throw new Error('WEBUI_MISSING_AUTH_KEY')
      }

      await this.startStaticServer(this.desiredPort, undefined, this.desiredHost)
      this.publishRunningState(true)
      logger.info(`WebUI service listening on ${this.desiredHost}:${this.desiredPort}`)
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
    host = WEBUI_DEFAULT_HOST,
    port
  }: WebUiServiceStartOptions): Promise<WebUiServiceStartResult> {
    if (!enabled) {
      return { status: 'skipped', reason: 'disabled' }
    }

    if (!isWebUiHostSupported()) {
      return { status: 'skipped', reason: 'unsupported-system' }
    }

    const authKey = application.get('PreferenceService').get('feature.webui.auth_key').trim()
    if (!authKey) {
      return { status: 'skipped', reason: 'missing-auth-key' }
    }

    const normalizedPort = normalizeWebUiPort(port)
    const normalizedHost = normalizeWebUiHost(host)
    await this.stopStaticServer()
    await this.startStaticServer(normalizedPort, distRoot, normalizedHost)

    return {
      status: 'started',
      port: normalizedPort,
      host: normalizedHost
    }
  }

  async stop() {
    await this.stopStaticServer()
  }

  private async startStaticServer(
    port: number,
    distRoot = join(app.getAppPath(), 'webui', 'dist'),
    host = WEBUI_DEFAULT_HOST
  ) {
    this.sseRelay = createWebUiSseRelay()
    this.staticServer = createWebUiStaticServer({
      distRoot,
      getAuthKey: () => application.get('PreferenceService').get('feature.webui.auth_key'),
      getLanguage: () => application.get('PreferenceService').get('app.language'),
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
    this.activeHost = host
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
    this.activeHost = undefined

    sseRelay?.close()
    await staticServer?.stop()
  }

  private loadPreferenceState(): void {
    const preferenceService = application.get('PreferenceService')
    const enabled = preferenceService.get('feature.webui.enabled')
    const authKey = preferenceService.get('feature.webui.auth_key').trim()
    // Require access key before treating the service as desired-on.
    this.desiredEnabled = enabled && Boolean(authKey)
    this.desiredPort = normalizeWebUiPort(preferenceService.get('feature.webui.port'))
    this.desiredHost = normalizeWebUiHost(preferenceService.get('feature.webui.host'))
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
