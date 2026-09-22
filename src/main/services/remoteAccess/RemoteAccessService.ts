import { application } from '@application'
import { remoteLimits, type RemoteCapability } from '@cherrystudio/remote-protocol'
import {
  acceptSecureChannel,
  type ChannelOptions,
  deviceIdentityId,
  type RemoteSocket,
  RemoteSocketStream
} from '@cherrystudio/remote-transport'
import { remoteCommandService } from '@data/services/RemoteCommandService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { RemoteAgentHub } from './agentJournal'
import { loadDesktopIdentity } from './deviceIdentity'
import { RemoteConnection } from './RemoteConnection'
import { RemotePairing } from './RemotePairing'
import { RemoteTokens } from './RemoteTokens'

const logger = loggerService.withContext('RemoteAccessService')
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
@DependsOn(['AiStreamManager', 'AgentSessionRuntimeService'])
export class RemoteAccessService extends BaseService {
  private identity?: Promise<Uint8Array>
  private readonly pairing = new RemotePairing()
  private readonly tokens = new RemoteTokens()
  private readonly hub = new RemoteAgentHub()
  private readonly connections = new Map<
    RemoteSocket,
    { address: string; openedAt: number; abort: AbortController; remote?: RemoteConnection }
  >()

  protected async onInit(): Promise<void> {
    remoteCommandService.interruptPending()
    this.registerInterval(() => {
      this.tokens.sweep()
      this.hub.sweep()
      for (const [socket, entry] of this.connections) {
        try {
          entry.remote?.sweep()
          if (!entry.remote?.isAuthenticated() && Date.now() - entry.openedAt > remoteLimits.invitationMs)
            throw new Error('Pairing timeout')
        } catch {
          socket.close(1008, 'Remote session expired')
        }
      }
    }, 1000)
    this.registerDisposable(() => {
      this.pairing.clear()
      this.tokens.clear()
      this.hub.dispose()
      for (const socket of this.connections.keys()) socket.close(1001, 'Service stopping')
    })
  }

  async createInvitation() {
    const identity = await this.getIdentity()
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
    const sameAddress = [...this.connections.values()].filter((value) => value.address === address).length
    if (this.connections.size >= 32 || sameAddress >= 4) {
      socket.close(1013, 'Too many remote connections')
      return
    }
    socket.binaryType = 'arraybuffer'
    const entry = {
      address,
      openedAt: Date.now(),
      abort: new AbortController(),
      remote: undefined as RemoteConnection | undefined
    }
    this.connections.set(socket, entry)
    socket.addEventListener('close', () => {
      entry.abort.abort()
      entry.remote?.dispose()
      this.connections.delete(socket)
    })
    void this.run(socket, entry).catch((error: unknown) => {
      logger.warn('Remote session ended with an error', { address, error: (error as Error).message })
      socket.close(1011, 'Remote session failed')
    })
  }

  /** The LAN listener is going away: pending invitations and live sessions go with it. */
  closeIngress(): void {
    this.pairing.clear()
    for (const socket of this.connections.keys()) socket.close(1001, 'Gateway stopping')
  }

  private getIdentity(): Promise<Uint8Array> {
    this.identity ??= loadDesktopIdentity().catch((error: unknown) => {
      this.identity = undefined
      throw error
    })
    return this.identity
  }

  private async run(socket: RemoteSocket, entry: { abort: AbortController; remote?: RemoteConnection }): Promise<void> {
    const stream = new RemoteSocketStream(socket, transportLog.forComponent('remote'), 'inbound')
    const channel = await acceptSecureChannel(stream, {
      identity: await this.getIdentity(),
      logger: transportLog,
      protocolVersions: [1],
      signal: AbortSignal.any([entry.abort.signal, AbortSignal.timeout(10_000)])
    })
    const remote = new RemoteConnection(
      channel,
      this.pairing,
      this.tokens,
      () => application.get('IpcApiService').broadcast('api_gateway.remote.pairing_changed', undefined),
      this.hub
    )
    entry.remote = remote
    let windowStart = Date.now()
    let count = 0
    while (!entry.abort.signal.aborted) {
      const input = await channel.read(entry.abort.signal)
      if (Date.now() - windowStart >= 1000) {
        windowStart = Date.now()
        count = 0
      }
      if (++count > 64) throw new Error('Remote request rate exceeded')
      void remote.rpc
        .receive(input, undefined)
        .then(async (response) => {
          if (response !== null) await remote.send(response)
        })
        .catch(() => socket.close(1011, 'Remote request failed'))
    }
  }
}
