import { hostname, networkInterfaces } from 'node:os'

import { Mutex } from 'async-mutex'
import { v4 as uuidv4 } from 'uuid'

import { application } from '@application'
import { loggerService } from '@logger'
import type { InProcessUsageContext } from '@main/ai/types'
import { createLatestReconciler, type LatestReconciler } from '@main/core/concurrency/latestReconciler'
import { type Activatable, BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { OutputFor } from '@shared/ipc/types'
import type { ApiGatewayConfig, ApiGatewayStopOutcome } from '@shared/types/apiGateway'
import { gatewayClientOrigin } from '@shared/utils/apiGateway'
import { REDACTED } from '@shared/utils/redaction'

import { isValidToken } from './middleware/auth'
import { getInterfaceMetadata, getRemoteAddressOptions } from './remoteAddresses'
import type { ApiGateway } from './server'

const logger = loggerService.withContext('ApiGatewayService')
const AGENT_SESSION_ID_HEADER = 'x-cherry-agent-session-id'
const INTERNAL_GATEWAY_HOST = '127.0.0.1'

/** What a scoped internal credential may call: one generation path, one model address. */
export type InternalCredentialScope = { path: string; model: string }

function presentedToken(headers: Headers): string | undefined {
  return (
    headers.get('x-api-key')?.trim() ||
    headers
      .get('authorization')
      ?.match(/^Bearer\s+(.+)$/i)?.[1]
      ?.trim() ||
    headers.get('x-goog-api-key')?.trim()
  )
}

@Injectable('ApiGatewayService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['RemoteAccessService'])
export class ApiGatewayService extends BaseService implements Activatable {
  private apiGateway: ApiGateway | null = null
  private readonly lanMutex = new Mutex()
  /** Never persisted or shown to the user; unrestricted on the internal listener. */
  private readonly internalApiKey = `cs-internal-${uuidv4()}`
  /** Live scoped credentials; each authorizes only its own scope until disposed. */
  private readonly scopedCredentials = new Map<string, InternalCredentialScope>()
  /** Loopback listener for internal consumers, started on first use and independent of `enabled`. */
  private internalGateway: Promise<ApiGateway> | null = null
  private internalOrigin: string | undefined
  /** Latest persistent desired state. Its only source is the `enabled` preference. */
  private desiredEnabled = false
  /**
   * Converges the gateway's running state to `desiredEnabled`.
   * The reconciler is the SOLE caller of activate/deactivate (start/stop/restart route through it
   * too), so transitions are never concurrent and the lifecycle's
   * `_activating` short-circuit can't race two owners and leave the running state diverged from the
   * target. It is level-triggered against the ACTUAL `isActivated` state, latest-wins (an opposing
   * toggle landing mid-transition is honoured on the next pass), and a transition that throws for a
   * still-current target is recorded — see {@link LatestReconciler.getLastError} — and not retried,
   * so a persistent failure (e.g. port in use) can't spin the loop.
   */
  private readonly reconciler: LatestReconciler = createLatestReconciler({
    name: 'apiGateway',
    getSnapshot: () => ({
      desired: this.desiredEnabled,
      actual: this.isActivated,
      host: this.listeningHost(),
      actualHost: this.apiGateway?.getHost()
    }),
    isSettled: ({ desired, actual, host, actualHost }) => desired === actual && (!desired || host === actualHost),
    apply: async ({ desired, actual }) => {
      if (!desired) await this.deactivate()
      else if (!actual) await this.activate()
      else {
        await this.lanMutex.runExclusive(async () => {
          const host = this.listeningHost()
          if (host === '127.0.0.1') application.get('RemoteAccessService').closeIngress()
          try {
            await this.apiGateway!.rebind(host)
          } finally {
            this.publishRunningState(this.isRunning())
          }
        })
      }
    }
  })

  protected async onInit(): Promise<void> {
    // The reconciler holds no OS resources (only closures + flags), so it is not disposed on stop:
    // it is a construct-once field that is NOT recreated on restart (`start()` re-runs `onInit`), and
    // disposing it would permanently no-op `request()` after a stop→restart. After stop, the pref
    // subscription and IPC handlers below are cleaned up, so nothing calls `request()` anyway.
    this.registerDisposable(
      application.get('PreferenceService').subscribeChange('feature.api_gateway.enabled', (enabled) => {
        this.desiredEnabled = enabled
        this.reconciler.request()
      })
    )
  }

  protected async onReady(): Promise<void> {
    const config = this.getCurrentConfig()
    // Never log the raw API key — redact before emitting.
    logger.info('API gateway config:', { ...config, apiKey: config.apiKey ? REDACTED : null })
    this.desiredEnabled = config.enabled
    this.reconciler.request()
    await this.reconciler.flush()
  }

  async onActivate(): Promise<void> {
    try {
      await this.ensureValidApiKey()
      const { ApiGateway } = await import('./server')
      const { port } = this.getCurrentConfig()
      this.apiGateway = new ApiGateway({ host: this.listeningHost(), port })
      await this.apiGateway.start()
      this.publishRunningState(true)
      logger.info('API Gateway activated')
    } catch (error) {
      // Activatable failure contract: clean up partial state before throwing
      if (this.apiGateway) {
        await this.apiGateway.stop().catch(() => {})
        this.apiGateway = null
      }
      this.publishRunningState(false)
      throw error
    }
  }

  async onDeactivate(): Promise<void> {
    await this.lanMutex.runExclusive(() => {
      application.get('RemoteAccessService').closeIngress()
    })
    if (this.apiGateway) {
      await this.apiGateway.stop()
      this.apiGateway = null
    }
    this.publishRunningState(false)
    logger.info('API Gateway deactivated')
  }

  protected async onStop(): Promise<void> {
    const internalGateway = this.internalGateway
    this.internalGateway = null
    this.internalOrigin = undefined
    await internalGateway?.then((gateway) => gateway.stop()).catch(() => undefined)
  }

  /**
   * Publish the running state to the shared cache (Main is authoritative). The
   * renderer reads it reactively via `useSharedCache('feature.api_gateway.running')`.
   * This replaces the previous IPC ready-broadcast + EventEmitter listener.
   *
   * "Running" tracks whether the server is ACTUALLY listening (`isRunning()`), because renderer
   * consumers gate real actions on it (the settings page disables port / API-key editing while running).
   */
  private publishRunningState(running: boolean): void {
    const config = this.getCurrentConfig()
    const host = running ? this.apiGateway?.getHost() : undefined
    const endpoint =
      host && this.apiGateway ? { hosts: this.apiGateway.getHosts(), port: this.apiGateway.getPort() } : null
    const remoteReady = !!endpoint && config.enabled && config.host === '0.0.0.0' && host === '0.0.0.0'
    application
      .get('RemoteAccessService')
      .updateDirectEndpoint(remoteReady ? { port: endpoint.port, ipv6: endpoint.hosts.includes('::') } : undefined)
    try {
      const cache = application.get('CacheService')
      cache.setShared('feature.api_gateway.running', running)
      cache.setShared('feature.api_gateway.lan_running', remoteReady)
    } catch (error) {
      logger.warn('Failed to publish API gateway running state', error as Error)
    }
  }

  private listeningHost(): string {
    const config = this.getCurrentConfig()
    return config.enabled && config.host === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1'
  }

  /**
   * Converge the runtime on `enabled` through the reconciler — never transition directly, so this
   * can't race an opposing toggle; `flush()` waits for the loop to go quiescent.
   */
  private async converge(enabled: boolean): Promise<void> {
    this.desiredEnabled = enabled
    this.reconciler.request()
    await this.reconciler.flush()
  }

  /**
   * Persist the intent BEFORE converging, in the same authoritative call. A runtime transition
   * whose persisted intent never landed is exactly the divergence #18521 was about — a stop that
   * left `enabled: true` behind reopens the port on the next launch. The preference write throws
   * on failure, so the caller learns the intent did not stick.
   */
  private async applyIntent(enabled: boolean): Promise<void> {
    const preferenceService = application.get('PreferenceService')
    if (!enabled && this.getCurrentConfig().host === '0.0.0.0') {
      await preferenceService.setMultiple({
        'feature.api_gateway.host': '127.0.0.1',
        'feature.api_gateway.enabled': false
      })
    } else {
      await preferenceService.set('feature.api_gateway.enabled', enabled)
    }
    if (!enabled) await this.lanMutex.runExclusive(() => this.closeRemoteAccess())
    // `subscribeChange` fires only on an actual change, so drive the reconciler here as well.
    await this.converge(enabled)
  }

  async start(): Promise<void> {
    await this.applyIntent(true)
    if (!this.isActivated || !this.isRunning()) {
      const error = this.failureError('Failed to start API Gateway')
      logger.error('Failed to start API Gateway:', error)
      throw error
    }
    logger.info('API Gateway started successfully')
  }

  async stop(): Promise<ApiGatewayStopOutcome> {
    await this.applyIntent(false)
    if (this.isActivated) {
      const error = this.failureError('Failed to stop API Gateway')
      logger.error('Failed to stop API Gateway:', error)
      throw error
    }
    logger.info('API Gateway stopped successfully')
    return 'stopped'
  }

  async restart(): Promise<void> {
    // Re-create the server (e.g. to apply a new host/port) as a stop→start through the same single
    // reconciler. A re-bind is not an intent change, so the persisted preference is left alone.
    await this.converge(false)
    // Re-read the intent before re-activating: another window may have persisted a stop while this
    // restart was queued behind it, and a re-bind must never resurrect a gateway the user disabled.
    if (!this.getCurrentConfig().enabled) {
      const error = new Error('API Gateway was disabled while restarting')
      logger.warn('Aborting API Gateway restart: the gateway was disabled meanwhile')
      throw error
    }
    await this.converge(true)
    if (!this.isActivated || !this.isRunning()) {
      const error = this.failureError('Failed to restart API Gateway')
      logger.error('Failed to restart API Gateway:', error)
      throw error
    }
    logger.info('API Gateway restarted successfully')
  }

  /** Surface the reconciler's most recent transition error to an IPC caller, or a generic fallback. */
  private failureError(fallback: string): Error {
    const lastError = this.reconciler.getLastError()
    return lastError instanceof Error ? lastError : new Error(fallback)
  }

  isRunning(): boolean {
    return this.apiGateway?.isRunning() ?? false
  }

  async setLanEnabled(enabled: boolean): Promise<void> {
    await this.lanMutex.runExclusive(async () => {
      const preferences = application.get('PreferenceService')
      if (!enabled) {
        await preferences.set('feature.api_gateway.host', '127.0.0.1')
        await this.closeRemoteAccess()
        return
      }
      if (!this.getCurrentConfig().enabled || !this.isRunning()) {
        throw new Error('Start the API Gateway in its settings before enabling LAN access')
      }
      await preferences.set('feature.api_gateway.host', '0.0.0.0')
      if (!this.getCurrentConfig().enabled || !this.isRunning()) {
        await preferences.set('feature.api_gateway.host', '127.0.0.1')
        await this.closeRemoteAccess()
        throw new Error('API Gateway was stopped')
      }
    })
    this.reconciler.request()
    await this.reconciler.flush()
    const target = enabled ? '0.0.0.0' : '127.0.0.1'
    if (
      (enabled && !this.getCurrentConfig().enabled) ||
      (this.isActivated ? this.apiGateway?.getHost() !== target : enabled)
    ) {
      const error = this.failureError('Failed to change network access')
      if (enabled) {
        await this.lanMutex.runExclusive(async () => {
          await application.get('PreferenceService').set('feature.api_gateway.host', '127.0.0.1')
          await this.closeRemoteAccess()
        })
        this.reconciler.request()
        await this.reconciler.flush()
      }
      throw error
    }
  }

  private async closeRemoteAccess(): Promise<void> {
    application.get('RemoteAccessService').closeIngress()
    this.publishRunningState(this.isRunning())
  }

  async createRemoteInvitation(): Promise<OutputFor<'api_gateway.remote.create_invitation'>> {
    const endpoint = await this.getRemoteEndpoint()
    if (endpoint.addresses.length === 0) throw new Error('No connection address is available')
    const invitation = await application.get('RemoteAccessService').createInvitation()
    return { ...endpoint, ...invitation }
  }

  async getRemoteEndpoint() {
    const metadata = await getInterfaceMetadata()
    if (!this.isRunning()) throw new Error('API Gateway is not running')
    if (
      !this.getCurrentConfig().enabled ||
      this.getCurrentConfig().host !== '0.0.0.0' ||
      this.apiGateway?.getHost() !== '0.0.0.0'
    ) {
      throw new Error('Device connections are disabled')
    }

    const ipv6 = this.apiGateway.getHosts().includes('::')
    const addressOptions = getRemoteAddressOptions(networkInterfaces(), metadata, ipv6)

    return {
      hostname: hostname(),
      port: this.apiGateway.getPort(),
      addresses: addressOptions.slice(0, 32).map(({ address }) => address),
      addressOptions
    }
  }

  /**
   * Base URL and unrestricted credential for Cherry-launched consumers. Served by a dedicated loopback
   * listener so internal traffic never depends on, or turns on, the user-facing gateway.
   */
  async ensureInternalGateway(): Promise<{ baseUrl: string; apiKey: string }> {
    return { baseUrl: await this.ensureInternalListener(), apiKey: this.internalApiKey }
  }

  /** A credential for one consumer run that authorizes only `scope`, revoked by `dispose`. */
  async createScopedCredential(
    scope: InternalCredentialScope
  ): Promise<{ baseUrl: string; apiKey: string; dispose: () => void }> {
    const baseUrl = await this.ensureInternalListener()
    const apiKey = `cs-internal-${uuidv4()}`
    this.scopedCredentials.set(apiKey, scope)
    return { baseUrl, apiKey, dispose: () => this.scopedCredentials.delete(apiKey) }
  }

  private async ensureInternalListener(): Promise<string> {
    this.internalGateway ??= this.startInternalGateway().catch((error: unknown) => {
      this.internalGateway = null
      throw error
    })
    await this.internalGateway
    return this.internalOrigin!
  }

  /** The internal listener's origin once started; read-only, for connection signatures. */
  getInternalGatewayOrigin(): string | undefined {
    return this.internalOrigin
  }

  private async startInternalGateway(): Promise<ApiGateway> {
    const { ApiGateway } = await import('./server')
    const gateway = new ApiGateway({ host: INTERNAL_GATEWAY_HOST, port: 0 }, 'internal')
    await gateway.start()
    this.internalOrigin = gatewayClientOrigin(INTERNAL_GATEWAY_HOST, gateway.getPort())
    logger.info('Internal API gateway started', { origin: this.internalOrigin })
    return gateway
  }

  /** Whether the request presents an internal credential; external callers never hold one. */
  isInternalRequest(headers: Headers): boolean {
    const token = presentedToken(headers)
    return !!token && (isValidToken(token, this.internalApiKey) || this.scopedCredentials.has(token))
  }

  /** The scope of a live scoped credential; undefined for every other request. */
  getCredentialScope(headers: Headers): InternalCredentialScope | undefined {
    const token = presentedToken(headers)
    return token ? this.scopedCredentials.get(token) : undefined
  }

  getCurrentConfig(): ApiGatewayConfig {
    const config = application.get('PreferenceService').getMultiple({
      enabled: 'feature.api_gateway.enabled',
      host: 'feature.api_gateway.host',
      port: 'feature.api_gateway.port',
      apiKey: 'feature.api_gateway.api_key'
    })

    return config
  }

  async ensureValidApiKey(): Promise<string> {
    const preferenceService = application.get('PreferenceService')
    let apiKey = preferenceService.get('feature.api_gateway.api_key')
    if (typeof apiKey !== 'string' || apiKey.trim() === '') {
      apiKey = `cs-sk-${uuidv4()}`
      await preferenceService.set('feature.api_gateway.api_key', apiKey)
      logger.info('Generated new API key')
    }
    return apiKey
  }

  /** Headers an internal Agent consumer sends so gateway hops are attributed to its session. */
  getAgentSessionUsageHeaders(sessionId: string): Record<string, string> {
    return { [AGENT_SESSION_ID_HEADER]: sessionId }
  }

  /** Agent session id of an unrestricted internal request; undefined for every other caller. */
  getAgentSessionId(headers: Headers): string | undefined {
    const token = presentedToken(headers)
    if (!token || !isValidToken(token, this.internalApiKey)) return undefined
    return headers.get(AGENT_SESSION_ID_HEADER)?.trim() || undefined
  }

  /** Capture the reserved continuation or active turn of the requesting Agent session. */
  resolveAgentSessionUsage(headers: Headers): InProcessUsageContext | undefined {
    const sessionId = this.getAgentSessionId(headers)
    if (!sessionId) return undefined
    return application.get('AgentSessionRuntimeService').getActiveUsageContext(sessionId)
  }
}
