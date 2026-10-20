import { createHash, randomUUID } from 'node:crypto'

import {
  connectionMethods,
  pairingMethods,
  remoteAuthorizationSchema,
  remoteLimits,
  uploadLimits,
  uploadMethods,
  uploadTransferLimits,
  type UploadChunk,
  type UploadDomain,
  type DirectEndpoint,
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
import {
  createAssistantSubscriptions,
  registerAssistantMethods,
  type AssistantSubscriptions
} from './assistantHandlers'
import { RemoteAssistantHub } from './assistantJournal'
import type { RemotePairing } from './RemotePairing'
import type { SnapshotBudget } from './RemoteSubscriptions'
import { type RemoteTokens, sameAuthorization } from './RemoteTokens'
import { RemoteUploads, type UploadOwner } from './RemoteUploads'

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
  private readonly assistantSubscriptions: AssistantSubscriptions

  constructor(
    readonly channel: SecureChannel,
    pairing: RemotePairing,
    tokens: RemoteTokens,
    onClaim: () => void,
    hub: RemoteAgentHub,
    getEndpoints: () => Promise<{ desktopIdentity: string; endpoints: DirectEndpoint[] }>,
    assistantHub = new RemoteAssistantHub(),
    snapshots: SnapshotBudget = { bytes: 0 },
    private readonly uploads = new RemoteUploads()
  ) {
    const budget = { count: 0, snapshots }
    this.subscriptions = new AgentSubscriptions(hub, (notification) => this.send(notification), budget)
    this.assistantSubscriptions = createAssistantSubscriptions(
      assistantHub,
      (notification) => this.send(notification),
      budget
    )
    registerAssistantMethods(
      this.rpc,
      {
        requireAssistant: () => ({ ...this.requireCapability('assistant'), peerIdentity: this.channel.remoteIdentity }),
        afterReply: (fn) => setImmediate(fn)
      },
      assistantHub,
      this.assistantSubscriptions,
      uploads
    )
    // The reply is queued on the write chain in a microtask; setImmediate runs after it, keeping events behind the response.
    registerAgentMethods(
      this.rpc,
      {
        requireAgent: () => ({ ...this.requireCapability('agent'), peerIdentity: this.channel.remoteIdentity }),
        afterReply: (fn) => setImmediate(fn)
      },
      hub,
      this.subscriptions,
      uploads
    )
    this.rpc.addMethod('uploads.prepare', uploadMethods['uploads.prepare'], ({ domain, ...input }) =>
      uploads.prepare(this.uploadOwner(domain), input)
    )
    this.rpc.addMethod('uploads.get', uploadMethods['uploads.get'], ({ domain, uploadId }) =>
      uploads.get(this.uploadOwner(domain), uploadId)
    )
    this.rpc.addMethod('uploads.resume', uploadMethods['uploads.resume'], ({ domain, ...input }) =>
      uploads.resume(this.uploadOwner(domain), input)
    )
    this.rpc.addMethod('uploads.complete', uploadMethods['uploads.complete'], ({ domain, ...input }) =>
      uploads.complete(this.uploadOwner(domain), input)
    )
    this.rpc.addMethod('uploads.cancel', uploadMethods['uploads.cancel'], ({ domain, uploadId }) =>
      uploads.cancel(this.uploadOwner(domain), uploadId)
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
        ...(channel.protocolVersion >= 2 ? { assistantVersion: 1 as const, uploadsVersion: 1 as const } : {}),
        agentFailureVersion: 1,
        agentMessageSummariesVersion: 1,
        agentUploadsVersion: 1,
        agentUploadChecksum: 'sha256' as const,
        agentAttachmentSelections: true,
        connectionEndpointsVersion: 1,
        limits: {
          ...remoteLimits,
          agentUploadFileBytes: uploadLimits.fileBytes,
          agentUploadMessageBytes: uploadLimits.messageBytes,
          agentUploadFiles: uploadLimits.files,
          agentUploadChunkBytes: uploadTransferLimits.chunkBytes,
          agentUploadWindow: uploadTransferLimits.window,
          ...(channel.protocolVersion >= 2
            ? {
                uploadFileBytes: uploadLimits.fileBytes,
                uploadMessageBytes: uploadLimits.messageBytes,
                uploadFiles: uploadLimits.files,
                uploadChunkBytes: uploadTransferLimits.chunkBytes,
                uploadWindow: uploadTransferLimits.window
              }
            : {})
        },
        heartbeatMs: remoteLimits.heartbeatMs
      }
    })
    const authenticate = (deviceId: string, accessToken?: string) => {
      this.requireHello()
      const stored = apiGatewayPairedDeviceService.getRemoteAuthorization(deviceId, channel.remoteIdentity)
      if (!stored) throw new RemoteRpcError('UNAUTHENTICATED', 'Device has no approved capabilities')
      const authorization = this.visibleAuthorization(stored)
      if (!authorization.grants.length)
        throw new RemoteRpcError('UPGRADE_REQUIRED', 'Assistant access requires protocol version 2')
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
    this.rpc.addMethod('connection.endpoints', connectionSchemas['connection.endpoints'], async ({ domain }) => {
      this.requireCapability(domain)
      const snapshot = await getEndpoints()
      this.requireCapability(domain)
      return snapshot
    })
    this.rpc.addMethod('connection.ping', connectionSchemas['connection.ping'], ({ nonce }) => {
      this.requireHello()
      return { nonce, serverTime: new Date().toISOString() }
    })
    this.rpc.addMethod('pairing.claim', pairingSchemas['pairing.claim'], (input) => {
      this.requireHello()
      if (this.authentication)
        throw new RemoteRpcError('INVALID_CONNECTION_STATE', 'Connection is already authenticated')
      if (channel.protocolVersion < 2 && input.capabilities.includes('assistant'))
        throw new RemoteRpcError('UPGRADE_REQUIRED', 'Assistant pairing requires protocol version 2')
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

  private readonly incomingUploads = new Set<string>()
  private incomingUploadBytes = 0

  async receiveUpload(input: UploadChunk): Promise<void> {
    if (
      this.incomingUploads.has(input.requestId) ||
      this.incomingUploads.size >= uploadTransferLimits.window ||
      this.incomingUploadBytes + input.bytes.length > uploadTransferLimits.chunkBytes * uploadTransferLimits.window
    )
      throw new Error('Upload window exceeded')
    this.incomingUploads.add(input.requestId)
    this.incomingUploadBytes += input.bytes.length
    let params
    try {
      const domain = input.domain ?? 'agent'
      const state = await this.uploads.write(this.uploadOwner(domain), input)
      this.requireCapability(domain)
      params = {
        ok: true,
        requestId: input.requestId,
        uploadId: state.uploadId,
        writerEpoch: state.writerEpoch,
        committedOffset: state.committedOffset
      }
    } catch (error) {
      if (!(error instanceof RemoteRpcError)) logger.warn('Binary upload failed', { error })
      params = {
        ok: false,
        requestId: input.requestId,
        error: error instanceof RemoteRpcError ? error.data : { reason: 'INTERNAL', message: 'Upload write failed' }
      }
    } finally {
      this.incomingUploads.delete(input.requestId)
      this.incomingUploadBytes -= input.bytes.length
    }
    await this.send({ jsonrpc: '2.0', method: input.domain ? 'uploads.ack' : 'agent.uploads.ack', params })
  }

  private uploadOwner(domain: UploadDomain): UploadOwner {
    return { domain, ...this.requireCapability(domain), peerIdentity: this.channel.remoteIdentity }
  }

  requireCapability(domain: RemoteCapability): { deviceId: string; grantId: string } {
    if (domain === 'assistant' && this.channel.protocolVersion < 2)
      throw new RemoteRpcError('UPGRADE_REQUIRED', 'Assistant access requires protocol version 2')
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
    if (!current || !sameAuthorization(this.visibleAuthorization(current), auth.authorization))
      throw new RemoteRpcError('GRANT_REVOKED', 'Device authorization changed')
    return auth
  }

  checkAuthorization(refresh = true): void {
    if (this.authentication) this.requireAuthentication(refresh)
  }
  private visibleAuthorization(authorization: RemoteAuthorization): RemoteAuthorization {
    return this.channel.protocolVersion >= 2
      ? authorization
      : { grants: authorization.grants.filter((grant) => grant.domain !== 'assistant') }
  }
  sweep(): void {
    this.checkAuthorization()
    this.subscriptions.sweep()
    this.assistantSubscriptions.sweep()
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
    this.assistantSubscriptions.dispose()
    this.exported = undefined
    this.authentication = undefined
  }
}
