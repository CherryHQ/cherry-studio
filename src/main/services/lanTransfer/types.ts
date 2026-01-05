import type * as fs from 'node:fs'
import type { Socket } from 'node:net'

import type { LanClientEvent, LocalTransferPeer } from '@shared/config/types'

/**
 * Pending response handler for awaiting control messages
 */
export type PendingResponse = {
  type: string
  transferId?: string
  chunkIndex?: number
  resolve: (payload: unknown) => void
  reject: (error: Error) => void
  timeoutHandle?: NodeJS.Timeout
  abortSignal?: AbortSignal
  abortListener?: () => void
}

/**
 * Active file transfer state tracking
 */
export type ActiveFileTransfer = {
  transferId: string
  fileName: string
  fileSize: number
  checksum: string
  totalChunks: number
  chunkSize: number
  bytesSent: number
  currentChunk: number
  startedAt: number
  stream?: fs.ReadStream
  isCancelled: boolean
  abortController: AbortController
}

/**
 * Context interface for connection handlers
 * Provides access to service methods without circular dependencies
 */
export type ConnectionContext = {
  socket: Socket | null
  currentPeer?: LocalTransferPeer
  sendControlMessage: (message: Record<string, unknown>) => void
  broadcastClientEvent: (event: LanClientEvent) => void
}

/**
 * Context interface for file transfer handlers
 * Extends connection context with transfer-specific methods
 */
export type FileTransferContext = ConnectionContext & {
  activeTransfer?: ActiveFileTransfer
  setActiveTransfer: (transfer: ActiveFileTransfer | undefined) => void
  waitForResponse: (
    type: string,
    timeoutMs: number,
    resolve: (payload: unknown) => void,
    reject: (error: Error) => void,
    transferId?: string,
    chunkIndex?: number,
    abortSignal?: AbortSignal
  ) => void
}
