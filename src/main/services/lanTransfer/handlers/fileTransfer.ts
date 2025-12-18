import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import type { Socket } from 'node:net'
import * as path from 'node:path'

import { loggerService } from '@logger'
import type {
  LanFileCompleteMessage,
  LanFileEndMessage,
  LanFileStartAckMessage,
  LanFileStartMessage
} from '@shared/config/types'
import {
  LAN_TRANSFER_CHUNK_SIZE,
  LAN_TRANSFER_COMPLETE_TIMEOUT_MS,
  LAN_TRANSFER_MAX_FILE_SIZE
} from '@shared/config/types'

import { sendBinaryChunk } from '../binaryProtocol'
import type { ActiveFileTransfer, FileTransferContext } from '../types'
import { getAbortError, waitForSocketDrain } from './connection'

const DEFAULT_FILE_START_ACK_TIMEOUT_MS = 30_000 // 30s for file_start_ack

const logger = loggerService.withContext('LanTransferFileHandler')

/**
 * Validate a file for transfer.
 * Checks existence, type, extension, and size limits.
 */
export async function validateFile(filePath: string): Promise<{ stats: fs.Stats; fileName: string }> {
  let stats: fs.Stats
  try {
    stats = await fs.promises.stat(filePath)
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`)
    } else if (nodeError.code === 'EACCES') {
      throw new Error(`Permission denied: ${filePath}`)
    } else if (nodeError.code === 'ENOTDIR') {
      throw new Error(`Invalid path: ${filePath}`)
    } else {
      throw new Error(`Cannot access file: ${filePath} (${nodeError.code || 'unknown error'})`)
    }
  }

  if (!stats.isFile()) {
    throw new Error('Path is not a file')
  }

  const fileName = path.basename(filePath)
  const ext = path.extname(fileName).toLowerCase()
  if (ext !== '.zip') {
    throw new Error('Only ZIP files are supported')
  }

  if (stats.size > LAN_TRANSFER_MAX_FILE_SIZE) {
    throw new Error(`File too large. Maximum size is ${formatFileSize(LAN_TRANSFER_MAX_FILE_SIZE)}`)
  }

  return { stats, fileName }
}

/**
 * Calculate SHA-256 checksum of a file.
 */
export async function calculateFileChecksum(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (data) => hash.update(data))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

/**
 * Create initial transfer state for a new file transfer.
 */
export function createTransferState(
  transferId: string,
  fileName: string,
  fileSize: number,
  checksum: string
): ActiveFileTransfer {
  const chunkSize = LAN_TRANSFER_CHUNK_SIZE
  const totalChunks = Math.ceil(fileSize / chunkSize)

  return {
    transferId,
    fileName,
    fileSize,
    checksum,
    totalChunks,
    chunkSize,
    bytesSent: 0,
    currentChunk: 0,
    startedAt: Date.now(),
    isCancelled: false,
    abortController: new AbortController()
  }
}

/**
 * Send file_start message to receiver.
 */
export function sendFileStart(ctx: FileTransferContext, transfer: ActiveFileTransfer): void {
  const startMessage: LanFileStartMessage = {
    type: 'file_start',
    transferId: transfer.transferId,
    fileName: transfer.fileName,
    fileSize: transfer.fileSize,
    mimeType: 'application/zip',
    checksum: transfer.checksum,
    totalChunks: transfer.totalChunks,
    chunkSize: transfer.chunkSize
  }
  ctx.sendControlMessage(startMessage)
  logger.info('Sent file_start message')
}

/**
 * Wait for file_start_ack from receiver.
 */
export function waitForFileStartAck(
  ctx: FileTransferContext,
  transferId: string,
  abortSignal?: AbortSignal
): Promise<LanFileStartAckMessage> {
  return new Promise((resolve, reject) => {
    ctx.waitForResponse(
      'file_start_ack',
      DEFAULT_FILE_START_ACK_TIMEOUT_MS,
      (payload) => resolve(payload as LanFileStartAckMessage),
      reject,
      transferId,
      undefined,
      abortSignal
    )
  })
}

/**
 * Wait for file_complete from receiver after all chunks sent.
 */
export function waitForFileComplete(
  ctx: FileTransferContext,
  transferId: string,
  abortSignal?: AbortSignal
): Promise<LanFileCompleteMessage> {
  return new Promise((resolve, reject) => {
    ctx.waitForResponse(
      'file_complete',
      LAN_TRANSFER_COMPLETE_TIMEOUT_MS,
      (payload) => resolve(payload as LanFileCompleteMessage),
      reject,
      transferId,
      undefined,
      abortSignal
    )
  })
}

/**
 * Send file_end message to receiver.
 */
export function sendFileEnd(ctx: FileTransferContext, transferId: string): void {
  const endMessage: LanFileEndMessage = {
    type: 'file_end',
    transferId
  }
  ctx.sendControlMessage(endMessage)
  logger.info('Sent file_end message')
}

/**
 * Stream file chunks to the receiver (v1 streaming mode - no per-chunk acknowledgment).
 */
export async function streamFileChunks(
  socket: Socket,
  filePath: string,
  transfer: ActiveFileTransfer,
  abortSignal: AbortSignal,
  onProgress: (bytesSent: number, chunkIndex: number) => void
): Promise<void> {
  const { chunkSize, transferId } = transfer

  const stream = fs.createReadStream(filePath, { highWaterMark: chunkSize })
  transfer.stream = stream

  let chunkIndex = 0
  let bytesSent = 0

  try {
    for await (const chunk of stream) {
      if (abortSignal.aborted) {
        throw getAbortError(abortSignal, 'Transfer aborted')
      }

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytesSent += buffer.length

      // Send chunk as binary frame (v1 streaming) with backpressure handling
      const canContinue = sendBinaryChunk(socket, transferId, chunkIndex, buffer)
      if (!canContinue) {
        await waitForSocketDrain(socket, abortSignal)
      }

      // Update progress
      transfer.bytesSent = bytesSent
      transfer.currentChunk = chunkIndex

      onProgress(bytesSent, chunkIndex)
      chunkIndex++
    }

    logger.info(`File streaming completed: ${chunkIndex} chunks sent`)
  } catch (error) {
    logger.error('File streaming failed', error as Error)
    throw error
  }
}

/**
 * Abort an active transfer and clean up resources.
 */
export function abortTransfer(transfer: ActiveFileTransfer | undefined, error: Error): void {
  if (!transfer) {
    return
  }

  transfer.isCancelled = true
  if (!transfer.abortController.signal.aborted) {
    transfer.abortController.abort(error)
  }
  if (transfer.stream && !transfer.stream.destroyed) {
    transfer.stream.destroy(error)
  }
}

/**
 * Clean up transfer resources without error.
 */
export function cleanupTransfer(transfer: ActiveFileTransfer | undefined): void {
  if (!transfer) {
    return
  }

  if (!transfer.abortController.signal.aborted) {
    transfer.abortController.abort()
  }
  if (transfer.stream && !transfer.stream.destroyed) {
    transfer.stream.destroy()
  }
}

/**
 * Format bytes into human-readable size string.
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}
