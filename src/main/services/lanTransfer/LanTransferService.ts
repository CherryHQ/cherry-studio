import * as crypto from 'node:crypto'
import { createConnection, type Socket } from 'node:net'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import type {
  LanClientEvent,
  LanFileCompleteMessage,
  LanHandshakeAckMessage,
  LanTransferConnectPayload,
  LanTransferPeer,
  LanTransferState
} from '@shared/config/types'
import { LAN_TRANSFER_GLOBAL_TIMEOUT_MS } from '@shared/config/types'
import { IpcChannel } from '@shared/IpcChannel'
import type { Browser, Service } from 'bonjour-service'
import Bonjour from 'bonjour-service'

import {
  abortTransfer,
  buildHandshakeMessage,
  calculateFileChecksum,
  cleanupTransfer,
  createDataHandler,
  createTransferState,
  formatFileSize,
  HANDSHAKE_PROTOCOL_VERSION,
  pickHost,
  sendFileEnd,
  sendFileStart,
  sendTestPing,
  streamFileChunks,
  validateFile,
  waitForFileComplete,
  waitForFileStartAck
} from './handlers'
import { ResponseManager } from './responseManager'
import type { ActiveFileTransfer, ConnectionContext, FileTransferContext } from './types'

const DISCOVERY_SERVICE_TYPE = 'cherrystudio'
const DISCOVERY_SERVICE_PROTOCOL = 'tcp' as const
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000

const logger = loggerService.withContext('LanTransferService')

type StartDiscoveryOptions = {
  resetList?: boolean
}

/**
 * LAN Transfer Service
 *
 * Handles LAN peer discovery via mDNS/Bonjour and outgoing file transfers via TCP.
 * Protocol v1 with streaming mode (no per-chunk acknowledgment).
 */
@Injectable('LanTransferService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowManager'])
export class LanTransferService extends BaseService {
  // =============================================================================
  // Discovery State
  // =============================================================================

  private bonjour: Bonjour | null = null
  private browser: Browser | null = null
  private discoveredServices = new Map<string, LanTransferPeer>()
  private isScanning = false
  private lastScanStartedAt?: number
  private lastUpdatedAt = Date.now()
  private lastError?: string

  // =============================================================================
  // Transfer State
  // =============================================================================

  private socket: Socket | null = null
  private currentPeer?: LanTransferPeer
  private dataHandler?: ReturnType<typeof createDataHandler>
  private responseManager = new ResponseManager()
  private isConnecting = false
  private activeTransfer?: ActiveFileTransfer
  private lastConnectOptions?: LanTransferConnectPayload
  private consecutiveJsonErrors = 0
  private static readonly MAX_CONSECUTIVE_JSON_ERRORS = 3
  private reconnectPromise: Promise<void> | null = null

  // =============================================================================
  // Lifecycle
  // =============================================================================

  protected async onInit() {
    this.responseManager.setTimeoutCallback(() => void this.disconnect())
    this.registerIpcHandlers()
  }

  protected async onStop() {
    // Clean up transfer resources first
    this.responseManager.rejectAll(new Error('LAN transfer service disposed'))
    cleanupTransfer(this.activeTransfer)
    this.activeTransfer = undefined
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }
    this.dataHandler?.resetBuffer()
    this.isConnecting = false

    // Clean up discovery resources
    this.stopDiscovery()
    this.discoveredServices.clear()
    this.browser?.removeAllListeners()
    this.browser = null
    if (this.bonjour) {
      try {
        this.bonjour.destroy()
      } catch (error) {
        logger.warn('Failed to destroy Bonjour instance', error as Error)
      }
      this.bonjour = null
    }
  }

  // =============================================================================
  // IPC Handlers
  // =============================================================================

  private registerIpcHandlers(): void {
    // Discovery
    this.ipcHandle(IpcChannel.LanTransfer_ListServices, () => this.getState())
    this.ipcHandle(IpcChannel.LanTransfer_StartScan, () => this.startDiscovery({ resetList: true }))
    this.ipcHandle(IpcChannel.LanTransfer_StopScan, () => this.stopDiscovery())

    // Transfer
    this.ipcHandle(IpcChannel.LanTransfer_Connect, (_, payload: LanTransferConnectPayload) =>
      this.connectAndHandshake(payload)
    )
    this.ipcHandle(IpcChannel.LanTransfer_Disconnect, () => this.disconnect())
    this.ipcHandle(IpcChannel.LanTransfer_SendFile, (_, payload: { filePath: string }) =>
      this.sendFile(payload.filePath)
    )
    this.ipcHandle(IpcChannel.LanTransfer_CancelTransfer, () => this.cancelTransfer())
  }

  // =============================================================================
  // Discovery Methods
  // =============================================================================

  public startDiscovery(options?: StartDiscoveryOptions): LanTransferState {
    if (options?.resetList) {
      this.discoveredServices.clear()
    }

    this.isScanning = true
    this.lastScanStartedAt = Date.now()
    this.lastUpdatedAt = Date.now()
    this.lastError = undefined
    this.restartBrowser()
    this.broadcastState()
    return this.getState()
  }

  public stopDiscovery(): LanTransferState {
    if (this.browser) {
      try {
        this.browser.stop()
      } catch (error) {
        logger.warn('Failed to stop LAN transfer browser', error as Error)
      }
    }
    this.isScanning = false
    this.lastUpdatedAt = Date.now()
    this.broadcastState()
    return this.getState()
  }

  public getState(): LanTransferState {
    const services = Array.from(this.discoveredServices.values()).sort((a, b) => a.name.localeCompare(b.name))
    return {
      services,
      isScanning: this.isScanning,
      lastScanStartedAt: this.lastScanStartedAt,
      lastUpdatedAt: this.lastUpdatedAt,
      lastError: this.lastError
    }
  }

  public getPeerById(id: string): LanTransferPeer | undefined {
    return this.discoveredServices.get(id)
  }

  private getBonjour(): Bonjour {
    if (!this.bonjour) {
      this.bonjour = new Bonjour()
    }
    return this.bonjour
  }

  private restartBrowser(): void {
    // Clean up existing browser
    if (this.browser) {
      this.browser.removeAllListeners()
      try {
        this.browser.stop()
      } catch (error) {
        logger.warn('Error while stopping Bonjour browser', error as Error)
      }
      this.browser = null
    }

    // Destroy and recreate Bonjour instance to prevent socket leaks
    if (this.bonjour) {
      try {
        this.bonjour.destroy()
      } catch (error) {
        logger.warn('Error while destroying Bonjour instance', error as Error)
      }
      this.bonjour = null
    }

    const browser = this.getBonjour().find({ type: DISCOVERY_SERVICE_TYPE, protocol: DISCOVERY_SERVICE_PROTOCOL })
    this.browser = browser
    this.bindBrowserEvents(browser)

    try {
      browser.start()
      logger.info('LAN transfer discovery started')
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.lastError = err.message
      logger.error('Failed to start LAN transfer discovery', err)
    }
  }

  private bindBrowserEvents(browser: Browser) {
    browser.on('up', (service) => {
      const peer = this.normalizeService(service)
      logger.info(`LAN peer detected: ${peer.name} (${peer.addresses.join(', ')})`)
      this.discoveredServices.set(peer.id, peer)
      this.lastUpdatedAt = Date.now()
      this.broadcastState()
    })

    browser.on('down', (service) => {
      const key = this.buildServiceKey(service.fqdn || service.name, service.host, service.port)
      if (this.discoveredServices.delete(key)) {
        logger.info(`LAN peer removed: ${service.name}`)
        this.lastUpdatedAt = Date.now()
        this.broadcastState()
      }
    })

    browser.on('error', (error) => {
      const err = error instanceof Error ? error : new Error(String(error))
      logger.error('LAN transfer discovery error', err)
      this.lastError = err.message
      this.broadcastState()
    })
  }

  private normalizeService(service: Service): LanTransferPeer {
    const addressCandidates = [...(service.addresses || []), service.referer?.address].filter(
      (value): value is string => typeof value === 'string' && value.length > 0
    )
    const addresses = Array.from(new Set(addressCandidates))
    const txtEntries = Object.entries(service.txt || {})
    const txt =
      txtEntries.length > 0
        ? Object.fromEntries(
            txtEntries.map(([key, value]) => [key, value === undefined || value === null ? '' : String(value)])
          )
        : undefined

    const peer: LanTransferPeer = {
      id: this.buildServiceKey(service.fqdn || service.name, service.host, service.port),
      name: service.name,
      host: service.host,
      fqdn: service.fqdn,
      port: service.port,
      type: service.type,
      protocol: service.protocol,
      addresses,
      txt,
      updatedAt: Date.now()
    }

    return peer
  }

  private buildServiceKey(name?: string, host?: string, port?: number): string {
    const raw = [name, host, port?.toString()].filter(Boolean).join('-')
    return raw || `service-${Date.now()}`
  }

  private broadcastState() {
    application
      .get('WindowManager')
      .broadcastToType(WindowType.Main, IpcChannel.LanTransfer_ServicesUpdated, this.getState())
  }

  // =============================================================================
  // Connection & Transfer Methods
  // =============================================================================

  /**
   * Connect to a LAN peer and perform handshake.
   */
  public async connectAndHandshake(options: LanTransferConnectPayload): Promise<LanHandshakeAckMessage> {
    if (this.isConnecting) {
      throw new Error('LAN transfer client is busy')
    }

    const peer = this.getPeerById(options.peerId)
    if (!peer) {
      throw new Error('Selected LAN peer is no longer available')
    }
    if (!peer.port) {
      throw new Error('Selected peer does not expose a TCP port')
    }

    const host = pickHost(peer)
    if (!host) {
      throw new Error('Unable to resolve a reachable host for the peer')
    }

    await this.disconnect()
    this.isConnecting = true

    return new Promise<LanHandshakeAckMessage>((resolve, reject) => {
      const socket = createConnection({ host, port: peer.port as number }, () => {
        logger.info(`Connected to LAN peer ${peer.name} (${host}:${peer.port})`)
        socket.setKeepAlive(true, 30_000)
        this.socket = socket
        this.currentPeer = peer
        this.attachSocketListeners(socket)

        this.responseManager.waitForResponse(
          'handshake_ack',
          options.timeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS,
          (payload) => {
            const ack = payload as LanHandshakeAckMessage
            if (!ack.accepted) {
              const message = ack.message || 'Handshake rejected by remote device'
              logger.warn(`Handshake rejected by ${peer.name}: ${message}`)
              this.broadcastClientEvent({
                type: 'error',
                message,
                timestamp: Date.now()
              })
              reject(new Error(message))
              void this.disconnect()
              return
            }
            logger.info(`Handshake accepted by ${peer.name}`)
            socket.setTimeout(0)
            this.isConnecting = false
            this.lastConnectOptions = options
            sendTestPing(this.createConnectionContext())
            resolve(ack)
          },
          (error) => {
            this.isConnecting = false
            reject(error)
          }
        )

        const handshakeMessage = buildHandshakeMessage()
        this.sendControlMessage(handshakeMessage)
      })

      socket.setTimeout(options.timeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS, () => {
        const error = new Error('Handshake timed out')
        logger.error('LAN transfer socket timeout', error)
        this.broadcastClientEvent({
          type: 'error',
          message: error.message,
          timestamp: Date.now()
        })
        reject(error)
        socket.destroy(error)
        void this.disconnect()
      })

      socket.once('error', (error) => {
        logger.error('LAN transfer socket error', error)
        const message = error instanceof Error ? error.message : String(error)
        this.broadcastClientEvent({
          type: 'error',
          message,
          timestamp: Date.now()
        })
        this.isConnecting = false
        reject(error instanceof Error ? error : new Error(message))
        void this.disconnect()
      })

      socket.once('close', () => {
        logger.info('LAN transfer socket closed')
        if (this.socket === socket) {
          this.socket = null
          this.dataHandler?.resetBuffer()
          this.responseManager.rejectAll(new Error('LAN transfer socket closed'))
          this.currentPeer = undefined
          abortTransfer(this.activeTransfer, new Error('LAN transfer socket closed'))
        }
        this.isConnecting = false
        this.broadcastClientEvent({
          type: 'socket_closed',
          reason: 'connection_closed',
          timestamp: Date.now()
        })
      })
    })
  }

  /**
   * Disconnect from the current peer.
   */
  public async disconnect(): Promise<void> {
    const socket = this.socket
    if (!socket) {
      return
    }

    this.socket = null
    this.dataHandler?.resetBuffer()
    this.currentPeer = undefined
    this.responseManager.rejectAll(new Error('LAN transfer socket disconnected'))
    abortTransfer(this.activeTransfer, new Error('LAN transfer socket disconnected'))

    const DISCONNECT_TIMEOUT_MS = 3000
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        logger.warn('Disconnect timeout, forcing cleanup')
        socket.removeAllListeners()
        resolve()
      }, DISCONNECT_TIMEOUT_MS)

      socket.once('close', () => {
        clearTimeout(timeout)
        resolve()
      })

      socket.destroy()
    })
  }

  /**
   * Send a ZIP file to the connected peer.
   */
  public async sendFile(filePath: string): Promise<LanFileCompleteMessage> {
    await this.ensureConnection()

    if (this.activeTransfer) {
      throw new Error('A file transfer is already in progress')
    }

    // Validate file
    const { stats, fileName } = await validateFile(filePath)

    // Calculate checksum
    logger.info('Calculating file checksum...')
    const checksum = await calculateFileChecksum(filePath)
    logger.info(`File checksum: ${checksum.substring(0, 16)}...`)

    // Connection can drop while validating/checking file; ensure it is still ready before starting transfer.
    await this.ensureConnection()

    // Initialize transfer state
    const transferId = crypto.randomUUID()
    this.activeTransfer = createTransferState(transferId, fileName, stats.size, checksum)

    logger.info(
      `Starting file transfer: ${fileName} (${formatFileSize(stats.size)}, ${this.activeTransfer.totalChunks} chunks)`
    )

    // Global timeout
    const globalTimeoutError = new Error('Transfer timed out (global timeout exceeded)')
    const globalTimeoutHandle = setTimeout(() => {
      logger.warn('Global transfer timeout exceeded, aborting transfer', { transferId, fileName })
      abortTransfer(this.activeTransfer, globalTimeoutError)
    }, LAN_TRANSFER_GLOBAL_TIMEOUT_MS)

    try {
      const result = await this.performFileTransfer(filePath, transferId, fileName)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`File transfer failed: ${message}`)

      this.broadcastClientEvent({
        type: 'file_transfer_complete',
        transferId,
        fileName,
        success: false,
        error: message,
        timestamp: Date.now()
      })

      throw error
    } finally {
      clearTimeout(globalTimeoutHandle)
      cleanupTransfer(this.activeTransfer)
      this.activeTransfer = undefined
    }
  }

  /**
   * Cancel the current file transfer.
   */
  public cancelTransfer(): void {
    if (!this.activeTransfer) {
      logger.warn('No active transfer to cancel')
      return
    }

    const { transferId, fileName } = this.activeTransfer
    logger.info(`Cancelling file transfer: ${fileName}`)

    this.activeTransfer.isCancelled = true

    try {
      this.sendControlMessage({
        type: 'file_cancel',
        transferId,
        reason: 'Cancelled by user'
      })
    } catch (error) {
      // Expected when connection is already broken
      logger.warn('Failed to send cancel message', error as Error)
    }

    abortTransfer(this.activeTransfer, new Error('Transfer cancelled by user'))
  }

  // =============================================================================
  // Private Transfer Methods
  // =============================================================================

  private async ensureConnection(): Promise<void> {
    // Check socket is valid and writable (not just undestroyed)
    if (this.socket && !this.socket.destroyed && this.socket.writable && this.currentPeer) {
      return
    }

    if (!this.lastConnectOptions) {
      throw new Error('No active connection. Please connect to a peer first.')
    }

    // Prevent concurrent reconnection attempts
    if (this.reconnectPromise) {
      logger.debug('Waiting for existing reconnection attempt...')
      await this.reconnectPromise
      return
    }

    logger.info('Connection lost, attempting to reconnect...')
    this.reconnectPromise = this.connectAndHandshake(this.lastConnectOptions)
      .then(() => {
        // Handshake succeeded, connection restored
      })
      .finally(() => {
        this.reconnectPromise = null
      })

    await this.reconnectPromise
  }

  private async performFileTransfer(
    filePath: string,
    transferId: string,
    fileName: string
  ): Promise<LanFileCompleteMessage> {
    const transfer = this.activeTransfer!
    const ctx = this.createFileTransferContext()

    // Step 1: Send file_start
    sendFileStart(ctx, transfer)

    // Step 2: Wait for file_start_ack
    const startAck = await waitForFileStartAck(ctx, transferId, transfer.abortController.signal)
    if (!startAck.accepted) {
      throw new Error(startAck.message || 'Transfer rejected by receiver')
    }
    logger.info('Received file_start_ack: accepted')

    // Step 3: Stream file chunks
    await streamFileChunks(this.socket!, filePath, transfer, transfer.abortController.signal, (bytesSent, chunkIndex) =>
      this.onTransferProgress(transfer, bytesSent, chunkIndex)
    )

    // Step 4: Send file_end
    sendFileEnd(ctx, transferId)

    // Step 5: Wait for file_complete
    const result = await waitForFileComplete(ctx, transferId, transfer.abortController.signal)
    logger.info(`File transfer ${result.success ? 'completed' : 'failed'}`)

    // Broadcast completion
    this.broadcastClientEvent({
      type: 'file_transfer_complete',
      transferId,
      fileName,
      success: result.success,
      filePath: result.filePath,
      error: result.error,
      timestamp: Date.now()
    })

    return result
  }

  private onTransferProgress(transfer: ActiveFileTransfer, bytesSent: number, chunkIndex: number): void {
    const progress = (bytesSent / transfer.fileSize) * 100
    const elapsed = (Date.now() - transfer.startedAt) / 1000
    const speed = elapsed > 0 ? bytesSent / elapsed : 0

    this.broadcastClientEvent({
      type: 'file_transfer_progress',
      transferId: transfer.transferId,
      fileName: transfer.fileName,
      bytesSent,
      totalBytes: transfer.fileSize,
      chunkIndex,
      totalChunks: transfer.totalChunks,
      progress: Math.round(progress * 100) / 100,
      speed,
      timestamp: Date.now()
    })
  }

  private attachSocketListeners(socket: Socket): void {
    this.dataHandler = createDataHandler((line) => this.handleControlLine(line))
    socket.on('data', (chunk: Buffer) => {
      try {
        this.dataHandler?.handleData(chunk)
      } catch (error) {
        logger.error('Data handler error', error as Error)
        void this.disconnect()
      }
    })
  }

  private handleControlLine(line: string): void {
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(line)
      this.consecutiveJsonErrors = 0 // Reset on successful parse
    } catch {
      this.consecutiveJsonErrors++
      logger.warn('Received invalid JSON control message', { line, consecutiveErrors: this.consecutiveJsonErrors })

      if (this.consecutiveJsonErrors >= LanTransferService.MAX_CONSECUTIVE_JSON_ERRORS) {
        const message = `Protocol error: ${this.consecutiveJsonErrors} consecutive invalid messages, disconnecting`
        logger.error(message)
        this.broadcastClientEvent({
          type: 'error',
          message,
          timestamp: Date.now()
        })
        void this.disconnect()
      }
      return
    }

    const type = payload?.type as string | undefined
    if (!type) {
      logger.warn('Received control message without type', payload)
      return
    }

    // Try to resolve a pending response
    const transferId = payload?.transferId as string | undefined
    const chunkIndex = payload?.chunkIndex as number | undefined
    if (this.responseManager.tryResolve(type, payload, transferId, chunkIndex)) {
      return
    }

    logger.info('Received control message', payload)

    if (type === 'pong') {
      this.broadcastClientEvent({
        type: 'pong',
        payload: payload?.payload as string | undefined,
        received: payload?.received as boolean | undefined,
        timestamp: Date.now()
      })
      return
    }

    // Ignore late-arriving file transfer messages
    const fileTransferMessageTypes = ['file_start_ack', 'file_complete']
    if (fileTransferMessageTypes.includes(type)) {
      logger.debug('Ignoring late file transfer message', { type, payload })
      return
    }

    this.broadcastClientEvent({
      type: 'error',
      message: `Unexpected control message type: ${type}`,
      timestamp: Date.now()
    })
  }

  private sendControlMessage(message: Record<string, unknown>): void {
    if (!this.socket || this.socket.destroyed || !this.socket.writable) {
      throw new Error('Socket is not connected')
    }
    const payload = JSON.stringify(message)
    this.socket.write(`${payload}\n`)
  }

  private createConnectionContext(): ConnectionContext {
    return {
      socket: this.socket,
      currentPeer: this.currentPeer,
      sendControlMessage: (msg) => this.sendControlMessage(msg),
      broadcastClientEvent: (event) => this.broadcastClientEvent(event)
    }
  }

  private createFileTransferContext(): FileTransferContext {
    return {
      ...this.createConnectionContext(),
      activeTransfer: this.activeTransfer,
      setActiveTransfer: (transfer) => {
        this.activeTransfer = transfer
      },
      waitForResponse: (type, timeoutMs, resolve, reject, transferId, chunkIndex, abortSignal) => {
        this.responseManager.waitForResponse(type, timeoutMs, resolve, reject, transferId, chunkIndex, abortSignal)
      }
    }
  }

  private broadcastClientEvent(event: LanClientEvent): void {
    application.get('WindowManager').broadcastToType(WindowType.Main, IpcChannel.LanTransfer_ClientEvent, {
      ...event,
      peerId: event.peerId ?? this.currentPeer?.id,
      peerName: event.peerName ?? this.currentPeer?.name
    })
  }
}

export { HANDSHAKE_PROTOCOL_VERSION }
