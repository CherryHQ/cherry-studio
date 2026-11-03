import { powerMonitor } from 'electron'

import { application } from '@application'
import { isUploadChunk, relayOriginSchema, type RelayEndpoint } from '@cherrystudio/remote-protocol'
import { remoteLimits, type RemoteCapability } from '@cherrystudio/remote-protocol'
import {
  acceptSecureChannel,
  type ChannelOptions,
  deviceIdentityId,
  type RemoteSocket,
  RemoteSocketStream
} from '@cherrystudio/remote-transport'
import { agentSessionService } from '@data/services/AgentSessionService'
import { remoteCommandService } from '@data/services/RemoteCommandService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { RemoteAgentHub } from './agentJournal'
import { loadDesktopIdentity } from './deviceIdentity'
import { maintainRelayConnection } from './relayConnection'
import { loadRelayHostKey } from './relayHostKey'
import { RemoteAdvertisement } from './RemoteAdvertisement'
import { RemoteConnection } from './RemoteConnection'
import { RemotePairing } from './RemotePairing'
import { RemoteTokens } from './RemoteTokens'

const logger = loggerService.withContext('RemoteAccessService')
type MessageStream = Parameters<typeof acceptSecureChannel>[0]
const transportLog: ChannelOptions['logger'] = {
  forComponent: () =>
    Object.assign(() => {}, {
      enabled: false,
      trace() {},
      error: (formatter: unknown, ...args: unknown[]) =>
        logger.warn('Encrypted remote transport error', { detail: String(formatter), args: args.map(String) }),
      newScope: () => transportLog.forComponent('remote')
    })
}

@Injectable('RemoteAccessService')
@ServicePhase(Phase.WhenReady)
@DependsOn([
  'AiStreamManager',
  'AgentSessionRuntimeService',
  'FileManager',
  'FileIntakeService',
  'AttachmentPresenceService'
])
export class RemoteAccessService extends BaseService {
  private identity?: Promise<Uint8Array>
  private relayController?: AbortController
  private relayEndpoint: RelayEndpoint | null = null
  private relayReady = false
  private readonly advertisement = new RemoteAdvertisement((status) => {
    application.get('CacheService').setShared('feature.remote_access.discovery_status', status)
  })
  private endpoint?: { port: number; ipv6?: boolean; identity?: string }
  private endpointRevision = 0
  private readonly pairing = new RemotePairing()
  private readonly tokens = new RemoteTokens()
  private readonly hub = new RemoteAgentHub()
  private readonly connections = new Map<
    MessageStream,
    {
      ingress: 'direct' | 'relay'
      address: string
      openedAt: number
      abort: AbortController
      remote?: RemoteConnection
    }
  >()

  protected async onInit(): Promise<void> {
    const preferences = application.get('PreferenceService')
    this.registerDisposable(
      preferences.subscribeChange('feature.remote_access.relay_enabled', () => this.refreshRelay())
    )
    this.registerDisposable(
      preferences.subscribeChange('feature.remote_access.relay_origin', () => this.refreshRelay())
    )
    this.refreshRelay()
    remoteCommandService.interruptPending()
    this.registerDisposable(agentSessionService.onSessionUpdated(({ sessionId }) => this.hub.publishSession(sessionId)))
    const refreshAdvertisement = () => {
      if (this.endpoint?.identity)
        this.advertisement.update(this.endpoint.identity, this.endpoint.port, this.endpoint.ipv6)
    }
    this.registerInterval(refreshAdvertisement, 5000)
    powerMonitor.on('resume', refreshAdvertisement)
    this.registerDisposable(() => powerMonitor.removeListener('resume', refreshAdvertisement))
    this.registerInterval(() => {
      this.tokens.sweep()
      this.hub.sweep()
      for (const [stream, entry] of this.connections) {
        try {
          entry.remote?.sweep()
          if (!entry.remote?.isAuthenticated() && Date.now() - entry.openedAt > remoteLimits.invitationMs)
            throw new Error('Pairing timeout')
        } catch {
          stream.abort(new Error('Remote session expired'))
        }
      }
    }, 1000)
    this.registerDisposable(() => {
      this.relayController?.abort()
      this.updateDirectEndpoint(undefined)
      this.pairing.clear()
      this.tokens.clear()
      this.hub.dispose()
      for (const stream of this.connections.keys()) stream.abort(new Error('Service stopping'))
    })
  }

  protected onStop(): void {
    this.relayController?.abort()
    this.closeIngress()
    for (const stream of this.connections.keys()) stream.abort(new Error('Service stopping'))
  }

  /** Gateway pushes its actual listener; temporary local API leases never enable discovery. */
  updateDirectEndpoint(endpoint: { port: number; ipv6?: boolean } | undefined): void {
    if (this.endpoint?.port === endpoint?.port && this.endpoint?.ipv6 === endpoint?.ipv6) return
    const revision = ++this.endpointRevision
    this.endpoint = endpoint
    this.advertisement.stop()
    if (!endpoint) {
      application.get('CacheService').setShared('feature.remote_access.discovery_status', 'inactive')
      return
    }
    application.get('CacheService').setShared('feature.remote_access.discovery_status', 'starting')
    const advertised = endpoint
    void this.getIdentity()
      .then((identity) => {
        if (revision !== this.endpointRevision) return
        this.endpoint = { ...advertised, identity: deviceIdentityId(identity) }
        this.advertisement.update(this.endpoint.identity!, advertised.port, advertised.ipv6)
      })
      .catch((error: unknown) => {
        if (revision !== this.endpointRevision) return
        application.get('CacheService').setShared('feature.remote_access.discovery_status', 'unavailable')
        logger.warn('Remote identity unavailable for discovery', error as Error)
      })
  }

  async getConnectionEndpoints() {
    const desktopIdentity = deviceIdentityId(await this.getIdentity())
    const endpoints = this.endpoint ? (await application.get('ApiGatewayService').getRemoteEndpoint()).endpoints : []
    return { desktopIdentity, endpoints, relay: this.relayEndpoint }
  }

  getRelayEndpoint(): RelayEndpoint | null {
    return this.relayReady ? this.relayEndpoint : null
  }

  private refreshRelay(): void {
    this.relayController?.abort()
    this.relayEndpoint = null
    this.relayReady = false
    const controller = new AbortController()
    this.relayController = controller
    const preferences = application.get('PreferenceService')
    const publish = (status: 'disabled' | 'connecting' | 'connected' | 'unavailable') => {
      if (controller.signal.aborted) return
      this.relayReady = status === 'connected'
      application.get('CacheService').setShared('feature.remote_access.relay_status', status)
    }
    if (!preferences.get('feature.remote_access.relay_enabled')) {
      publish('disabled')
      return
    }
    const origin = relayOriginSchema.safeParse(preferences.get('feature.remote_access.relay_origin'))
    if (!origin.success) {
      publish('unavailable')
      return
    }
    publish('connecting')
    void loadRelayHostKey(origin.data)
      .then(async (hostKey) => {
        if (controller.signal.aborted) return
        await maintainRelayConnection({
          origin: origin.data,
          hostKey,
          signal: controller.signal,
          log: transportLog.forComponent('relay'),
          onStatus: (status, endpoint) => {
            if (controller.signal.aborted) return
            this.relayEndpoint = endpoint
            publish(status)
          },
          onStream: (stream) => {
            if (controller.signal.aborted) stream.abort(new Error('Relay disabled'))
            else this.acceptStream(stream, 'relay', origin.data)
          }
        })
      })
      .catch(() => {
        publish('unavailable')
        logger.warn('Relay key or connection unavailable')
      })
  }

  async createInvitation() {
    const identity = await this.getIdentity()
    if (this.endpoint && !this.endpoint.identity) {
      this.endpoint.identity = deviceIdentityId(identity)
      this.advertisement.update(this.endpoint.identity, this.endpoint.port, this.endpoint.ipv6)
    }
    return { ...this.pairing.create(), desktopIdentity: deviceIdentityId(identity), protocolVersions: [1] }
  }

  pendingClaims() {
    return this.pairing.pending()
  }
  decidePairing(claimId: string, capabilities: RemoteCapability[] | null): void {
    this.pairing.decide(claimId, capabilities)
    application.get('IpcApiService').broadcast('api_gateway.remote.pairing_changed', undefined)
  }

  /** Called by the gateway's ws route once the upgrade completed; refuses beyond the connection budget. */
  accept(socket: RemoteSocket, address: string): void {
    const preferences = application.get('PreferenceService')
    if (!preferences.get('feature.api_gateway.enabled') || preferences.get('feature.api_gateway.host') !== '0.0.0.0') {
      socket.close(1008, 'Remote access is disabled')
      return
    }
    const sameAddress = [...this.connections.values()].filter(
      (value) => value.ingress === 'direct' && value.address === address
    ).length
    if (this.connections.size >= 32 || sameAddress >= 4) {
      socket.close(1013, 'Too many remote connections')
      return
    }
    socket.binaryType = 'arraybuffer'
    this.acceptStream(new RemoteSocketStream(socket, transportLog.forComponent('remote'), 'inbound'), 'direct', address)
  }

  private acceptStream(stream: MessageStream, ingress: 'direct' | 'relay', address: string): void {
    if (this.connections.size >= 32) {
      stream.abort(new Error('Too many remote connections'))
      return
    }
    const entry = {
      ingress,
      address,
      openedAt: Date.now(),
      abort: new AbortController(),
      remote: undefined as RemoteConnection | undefined
    }
    this.connections.set(stream, entry)
    const dispose = () => {
      stream.removeEventListener('close', dispose)
      entry.abort.abort()
      entry.remote?.dispose()
      this.connections.delete(stream)
    }
    stream.addEventListener('close', dispose)
    void this.run(stream, entry)
      .catch((error: unknown) => {
        if (entry.abort.signal.aborted && error === entry.abort.signal.reason) return
        logger.warn('Remote session ended with an error', { address, error: (error as Error).message })
        stream.abort(new Error('Remote session failed'))
      })
      .finally(dispose)
  }

  /** The LAN listener is going away; other ingress lifetimes remain independent. */
  closeIngress(): void {
    this.updateDirectEndpoint(undefined)
    if (!this.relayEndpoint) this.pairing.clear()
    for (const [stream, entry] of this.connections) {
      if (entry.ingress === 'direct') stream.abort(new Error('Gateway stopping'))
    }
  }

  private getIdentity(): Promise<Uint8Array> {
    this.identity ??= loadDesktopIdentity().catch((error: unknown) => {
      this.identity = undefined
      throw error
    })
    return this.identity
  }

  private async run(
    stream: MessageStream,
    entry: { abort: AbortController; remote?: RemoteConnection }
  ): Promise<void> {
    const channel = await acceptSecureChannel(stream, {
      identity: await this.getIdentity(),
      logger: transportLog,
      protocolVersions: [1],
      signal: AbortSignal.any([entry.abort.signal, AbortSignal.timeout(10_000)])
    })
    entry.abort.signal.throwIfAborted()
    const remote = new RemoteConnection(
      channel,
      this.pairing,
      this.tokens,
      () => application.get('IpcApiService').broadcast('api_gateway.remote.pairing_changed', undefined),
      this.hub,
      () => this.getConnectionEndpoints()
    )
    entry.remote = remote
    let windowStart = Date.now()
    let count = 0
    let uploadCount = 0
    while (!entry.abort.signal.aborted) {
      const input = await channel.read(entry.abort.signal)
      if (isUploadChunk(input)) {
        void remote.receiveUpload(input).catch(() => stream.abort(new Error('Remote upload failed')))
        continue
      }
      if (Date.now() - windowStart >= 1000) {
        windowStart = Date.now()
        count = 0
        uploadCount = 0
      }
      const upload =
        input !== null && typeof input === 'object' && 'method' in input && input.method === 'agent.content.read'
      if (upload ? ++uploadCount > 512 : ++count > 256) {
        // Awaiting keeps a flood of refusals from queueing ahead of the socket; excess must not end the session.
        const refusal = remote.rpc.refuse(input, {
          reason: 'RATE_LIMITED',
          message: 'Request rate exceeded',
          retryAfterMs: Math.max(1, windowStart + 1000 - Date.now())
        })
        if (refusal) await remote.send(refusal).catch(() => stream.abort(new Error('Remote request failed')))
        continue
      }
      void remote.rpc
        .receive(input, undefined)
        .then(async (response) => {
          if (response !== null) await remote.send(response)
        })
        .catch(() => stream.abort(new Error('Remote request failed')))
    }
  }
}
