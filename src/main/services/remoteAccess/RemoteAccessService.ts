import type { Server, IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'

import { WebSocketServer, type WebSocket } from 'ws'

import { application } from '@application'
import { remoteLimits, type RemoteCapability } from '@cherrystudio/remote-protocol'
import {
  acceptSecureChannel,
  deviceIdentityId,
  RemoteSocketStream,
  type ChannelOptions
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
      error: () => logger.debug('Encrypted remote transport closed'),
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
    WebSocket,
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
          socket.terminate()
        }
      }
    }, 1000)
    this.registerDisposable(() => {
      this.pairing.clear()
      this.tokens.clear()
      this.hub.dispose()
      for (const socket of this.connections.keys()) socket.terminate()
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

  attach(server: Server): () => void {
    const wss = new WebSocketServer({ noServer: true, maxPayload: remoteLimits.recordBytes, perMessageDeflate: false })
    const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (request.url !== '/v1/remote/connect' || request.headers.origin || request.method !== 'GET') {
        socket.destroy()
        return
      }
      const address = request.socket.remoteAddress ?? ''
      if (
        this.connections.size >= 32 ||
        [...this.connections.values()].filter((value) => value.address === address).length >= 4
      ) {
        socket.destroy()
        return
      }
      wss.handleUpgrade(request, socket, head, (websocket) => {
        const entry = {
          address,
          openedAt: Date.now(),
          abort: new AbortController(),
          remote: undefined as RemoteConnection | undefined
        }
        this.connections.set(websocket, entry)
        websocket.once('close', () => {
          entry.abort.abort()
          entry.remote?.dispose()
          this.connections.delete(websocket)
        })
        void this.run(websocket, entry).catch(() => websocket.terminate())
      })
    }
    server.on('upgrade', upgrade)
    let closed = false
    const detach = () => {
      if (closed) return
      closed = true
      server.off('upgrade', upgrade)
      this.pairing.clear()
      for (const socket of wss.clients) socket.terminate()
      wss.close()
    }
    this.registerDisposable(detach)
    return detach
  }

  private getIdentity(): Promise<Uint8Array> {
    this.identity ??= loadDesktopIdentity().catch((error: unknown) => {
      this.identity = undefined
      throw error
    })
    return this.identity
  }

  private async run(socket: WebSocket, entry: { abort: AbortController; remote?: RemoteConnection }): Promise<void> {
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
        .catch(() => socket.terminate())
    }
  }
}
