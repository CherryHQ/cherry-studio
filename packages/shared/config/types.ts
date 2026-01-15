import type { ProcessingStatus } from '@types'

export type LoaderReturn = {
  entriesAdded: number
  uniqueId: string
  uniqueIds: string[]
  loaderType: string
  status?: ProcessingStatus
  message?: string
  messageSource?: 'preprocess' | 'embedding' | 'validation'
}

export type FileChangeEventType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir' | 'refresh'

export type FileChangeEvent = {
  eventType: FileChangeEventType
  filePath: string
  watchPath: string
}

export type MCPProgressEvent = {
  callId: string
  progress: number // 0-1 range
}

export type MCPServerLogEntry = {
  timestamp: number
  level: 'debug' | 'info' | 'warn' | 'error' | 'stderr' | 'stdout'
  message: string
  data?: any
  source?: string
}

export type WebviewKeyEvent = {
  webviewId: number
  key: string
  control: boolean
  meta: boolean
  shift: boolean
  alt: boolean
}

export interface WebSocketStatusResponse {
  isRunning: boolean
  port?: number
  ip?: string
  clientConnected: boolean
}

export interface WebSocketCandidatesResponse {
  host: string
  interface: string
  priority: number
}

export type LocalTransferPeer = {
  id: string
  name: string
  host?: string
  fqdn?: string
  port?: number
  type?: string
  protocol?: 'tcp' | 'udp'
  addresses: string[]
  txt?: Record<string, string>
  updatedAt: number
}

export type LocalTransferState = {
  services: LocalTransferPeer[]
  isScanning: boolean
  lastScanStartedAt?: number
  lastUpdatedAt: number
  lastError?: string
}

export type LanHandshakeRequestMessage = {
  type: 'handshake'
  deviceName: string
  version: string
  platform?: string
  appVersion?: string
}

export type LanHandshakeAckMessage = {
  type: 'handshake_ack'
  accepted: boolean
  message?: string
}

export type LocalTransferConnectPayload = {
  peerId: string
  metadata?: Record<string, string>
  timeoutMs?: number
}

export type LanClientEvent =
  | {
      type: 'ping_sent'
      payload: string
      timestamp: number
      peerId?: string
      peerName?: string
    }
  | {
      type: 'pong'
      payload?: string
      received?: boolean
      timestamp: number
      peerId?: string
      peerName?: string
    }
  | {
      type: 'socket_closed'
      reason?: string
      timestamp: number
      peerId?: string
      peerName?: string
    }
  | {
      type: 'error'
      message: string
      timestamp: number
      peerId?: string
      peerName?: string
    }
  | {
      type: 'file_transfer_progress'
      transferId: string
      fileName: string
      bytesSent: number
      totalBytes: number
      chunkIndex: number
      totalChunks: number
      progress: number // 0-100
      speed: number // bytes/sec
      timestamp: number
      peerId?: string
      peerName?: string
    }
  | {
      type: 'file_transfer_complete'
      transferId: string
      fileName: string
      success: boolean
      filePath?: string
      error?: string
      timestamp: number
      peerId?: string
      peerName?: string
    }

// =============================================================================
// LAN File Transfer Protocol Types
// =============================================================================

// Constants for file transfer
export const LAN_TRANSFER_TCP_PORT = 53317
export const LAN_TRANSFER_CHUNK_SIZE = 512 * 1024 // 512KB
export const LAN_TRANSFER_MAX_FILE_SIZE = 500 * 1024 * 1024 // 500MB
export const LAN_TRANSFER_COMPLETE_TIMEOUT_MS = 60_000 // 60s - wait for file_complete after file_end
export const LAN_TRANSFER_GLOBAL_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes - global transfer timeout

// Binary protocol constants (v1)
export const LAN_TRANSFER_PROTOCOL_VERSION = '1'
export const LAN_BINARY_FRAME_MAGIC = 0x4353 // "CS" as uint16
export const LAN_BINARY_TYPE_FILE_CHUNK = 0x01

// Messages from Electron (Client/Sender) to Mobile (Server/Receiver)

/** Request to start file transfer */
export type LanFileStartMessage = {
  type: 'file_start'
  transferId: string
  fileName: string
  fileSize: number
  mimeType: string // 'application/zip'
  checksum: string // SHA-256 of entire file
  totalChunks: number
  chunkSize: number
}

/**
 * File chunk data (JSON format)
 * @deprecated Use binary frame format in protocol v1. This type is kept for reference only.
 */
export type LanFileChunkMessage = {
  type: 'file_chunk'
  transferId: string
  chunkIndex: number
  data: string // Base64 encoded
  chunkChecksum: string // SHA-256 of this chunk
}

/** Notification that all chunks have been sent */
export type LanFileEndMessage = {
  type: 'file_end'
  transferId: string
}

/** Request to cancel file transfer */
export type LanFileCancelMessage = {
  type: 'file_cancel'
  transferId: string
  reason?: string
}

// Messages from Mobile (Server/Receiver) to Electron (Client/Sender)

/** Acknowledgment of file transfer request */
export type LanFileStartAckMessage = {
  type: 'file_start_ack'
  transferId: string
  accepted: boolean
  message?: string // Rejection reason
}

/**
 * Acknowledgment of file chunk received
 * @deprecated Protocol v1 uses streaming mode without per-chunk acknowledgment.
 * This type is kept for backward compatibility reference only.
 */
export type LanFileChunkAckMessage = {
  type: 'file_chunk_ack'
  transferId: string
  chunkIndex: number
  received: boolean
  message?: string
}

/** Final result of file transfer */
export type LanFileCompleteMessage = {
  type: 'file_complete'
  transferId: string
  success: boolean
  filePath?: string // Path where file was saved on mobile
  error?: string
  // Enhanced error diagnostics
  errorCode?: 'CHECKSUM_MISMATCH' | 'INCOMPLETE_TRANSFER' | 'DISK_ERROR' | 'CANCELLED'
  receivedChunks?: number
  receivedBytes?: number
}

/** Payload for sending a file via IPC */
export type LanFileSendPayload = {
  filePath: string
}
