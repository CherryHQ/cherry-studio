import { createHash, randomUUID } from 'node:crypto'

import {
  connectionMethods,
  pairingMethods,
  remoteAuthorizationSchema,
  remoteLimits,
  type RemoteAuthorization,
  type RemoteCapability
} from '@cherrystudio/remote-protocol'
import { configurationMethods } from '@cherrystudio/remote-protocol/configuration'
import { RemoteRpcError, RemoteRpcServer, type SecureChannel } from '@cherrystudio/remote-transport'
import { apiGatewayPairedDeviceService } from '@data/services/ApiGatewayPairedDeviceService'
import { loggerService } from '@logger'
import { getProviderExportPayload } from '@main/features/apiGateway/providerExport'

import { registerAgentMethods } from './agentHandlers'
import type { RemoteAgentHub } from './agentJournal'
import { AgentSubscriptions } from './agentSubscriptions'
import type { RemotePairing } from './RemotePairing'
import { type RemoteTokens, sameAuthorization } from './RemoteTokens'

const logger = loggerService.withContext('RemoteConnection')
const connectionSchemas = connectionMethods(remoteAuthorizationSchema)
const pairingSchemas = pairingMethods(remoteAuthorizationSchema)

export class RemoteConnection {
  readonly rpc = new RemoteRpcServer<void>(() => logger.warn('Remote RPC handler failed'))
  private hello = false
  private authentication?: { deviceId: string; authorization: RemoteAuthorization; expiresAt: number }
  private exported?: { exportId: string; bytes: Buffer; expiresAt: number }
  private writes: Promise<void> = Promise.resolve()
  private readonly subscriptions: AgentSubscriptions

  constructor(
    readonly channel: SecureChannel,
    pairing: RemotePairing,
    tokens: RemoteTokens,
    onClaim: () => void,
    hub: RemoteAgentHub
  ) {
    this.subscriptions = new AgentSubscriptions(hub, (notification) => this.send(notification))
    // The reply is queued on the write chain in a microtask; setImmediate runs after it, keeping events behind the response.
    registerAgentMethods(
      this.rpc,
      { requireAgent: () => this.requireCapability('agent'), afterReply: (fn) => setImmediate(fn) },
      hub,
      this.subscriptions
    )
    this.rpc.addMethod('connection.hello', connectionSchemas['connection.hello'], (offer) => {
      if (
        this.hello ||
        offer.protocolVersions.length !== channel.offeredVersions.length ||
        offer.protocolVersions.some((value, index) => value !== channel.offeredVersions[index])
      )
        throw new RemoteRpcError('INVALID_CONNECTION_STATE', 'Hello must confirm the authenticated version offer')
      this.hello = true
      return {
        protocolVersion: channel.protocolVersion,
        agentFailureVersion: 1,
        limits: remoteLimits,
        heartbeatMs: remoteLimits.heartbeatMs
      }
    })
    const authenticate = (deviceId: string, accessToken?: string) => {
      this.requireHello()
      const authorization = apiGatewayPairedDeviceService.getRemoteAuthorization(deviceId, channel.remoteIdentity)
      if (!authorization) throw new RemoteRpcError('UNAUTHENTICATED', 'Device has no approved capabilities')
      if (accessToken) tokens.validate(accessToken, deviceId, channel.remoteIdentity, authorization)
      const result = tokens.issue(deviceId, channel.remoteIdentity, authorization)
      this.authentication = { deviceId, authorization, expiresAt: Date.parse(result.expiresAt) }
      return { ...result, deviceId }
    }
    this.rpc.addMethod(
      'connection.authenticate',
      connectionSchemas['connection.authenticate'],
      ({ deviceId, accessToken }) => {
        if (this.authentication)
          throw new RemoteRpcError('INVALID_CONNECTION_STATE', 'Connection is already authenticated')
        return authenticate(deviceId, accessToken)
      }
    )
    this.rpc.addMethod('connection.refresh', connectionSchemas['connection.refresh'], () => {
      const auth = this.requireAuthentication(true)
      return authenticate(auth.deviceId)
    })
    this.rpc.addMethod('connection.ping', connectionSchemas['connection.ping'], ({ nonce }) => {
      this.requireHello()
      return { nonce, serverTime: new Date().toISOString() }
    })
    this.rpc.addMethod('pairing.claim', pairingSchemas['pairing.claim'], (input) => {
      this.requireHello()
      if (this.authentication)
        throw new RemoteRpcError('INVALID_CONNECTION_STATE', 'Connection is already authenticated')
      const result = pairing.claimInvitation(channel.remoteIdentity, input)
      onClaim()
      return result
    })
    this.rpc.addMethod('pairing.get', pairingSchemas['pairing.get'], ({ claimId }) => {
      this.requireHello()
      const result = pairing.get(claimId, channel.remoteIdentity)
      if (result.status !== 'approved') return result
      return { status: 'approved' as const, ...authenticate(result.deviceId) }
    })
    this.rpc.addMethod('configuration.export.prepare', configurationMethods['configuration.export.prepare'], () => {
      this.requireCapability('configuration')
      const bytes = Buffer.from(JSON.stringify(getProviderExportPayload()))
      if (bytes.length > remoteLimits.globalCheckpointBytes)
        throw new RemoteRpcError('RESOURCE_EXHAUSTED', 'Configuration export exceeds the size limit')
      const exportId = randomUUID()
      this.exported = { exportId, bytes, expiresAt: Date.now() + remoteLimits.checkpointMs }
      return { exportId, byteLength: String(bytes.length), sha256: createHash('sha256').update(bytes).digest('hex') }
    })
    this.rpc.addMethod(
      'configuration.export.read',
      configurationMethods['configuration.export.read'],
      ({ exportId, offset, maxBytes }) => {
        this.requireCapability('configuration')
        const exported = this.exported
        if (!exported || exported.exportId !== exportId || exported.expiresAt <= Date.now())
          throw new RemoteRpcError('NOT_FOUND', 'Configuration export expired')
        if (BigInt(offset) > BigInt(exported.bytes.length))
          throw new RemoteRpcError('NOT_FOUND', 'Offset exceeds export length')
        const bytes = exported.bytes.subarray(Number(offset), Number(offset) + maxBytes)
        return {
          exportId,
          offset,
          nextOffset: String(Number(offset) + bytes.length),
          dataBase64: bytes.toString('base64'),
          eof: Number(offset) + bytes.length === exported.bytes.length
        }
      }
    )
  }

  requireCapability(domain: RemoteCapability): { deviceId: string; grantId: string } {
    const auth = this.requireAuthentication()
    const grant = auth.authorization.grants.find((value) => value.domain === domain)
    if (!grant) throw new RemoteRpcError('FORBIDDEN', 'Capability was not approved during pairing')
    return { deviceId: auth.deviceId, grantId: grant.grantId }
  }

  private requireHello(): void {
    if (!this.hello) throw new RemoteRpcError('INVALID_CONNECTION_STATE', 'Hello is required')
  }

  private requireAuthentication(refresh = false) {
    this.requireHello()
    const auth = this.authentication
    if (!auth) throw new RemoteRpcError('UNAUTHENTICATED', 'Device authentication is required')
    if (auth.expiresAt + (refresh ? remoteLimits.refreshGraceMs : 0) <= Date.now())
      throw new RemoteRpcError('TOKEN_EXPIRED', 'Device token expired')
    const current = apiGatewayPairedDeviceService.getRemoteAuthorization(auth.deviceId, this.channel.remoteIdentity)
    if (!current || !sameAuthorization(current, auth.authorization))
      throw new RemoteRpcError('GRANT_REVOKED', 'Device authorization changed')
    return auth
  }

  checkAuthorization(refresh = true): void {
    if (this.authentication) this.requireAuthentication(refresh)
  }
  sweep(): void {
    this.checkAuthorization()
    this.subscriptions.sweep()
  }
  isAuthenticated(): boolean {
    return this.authentication !== undefined
  }
  send(value: unknown): Promise<void> {
    const write = this.writes.then(() => {
      this.checkAuthorization(false)
      return this.channel.write(value)
    })
    this.writes = write
    void write.catch(() => {})
    return write
  }
  dispose(): void {
    this.subscriptions.dispose()
    this.exported = undefined
    this.authentication = undefined
  }
}
