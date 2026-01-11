import type { Socket } from 'node:net'

/**
 * Binary protocol constants (v1)
 */
export const BINARY_TYPE_FILE_CHUNK = 0x01

/**
 * Send file chunk as binary frame (protocol v1 - streaming mode)
 *
 * Frame format:
 * ```
 * ┌──────────┬──────────┬──────────┬───────────────┬──────────────┬────────────┬───────────┐
 * │ Magic    │ TotalLen │ Type     │ TransferId Len│ TransferId   │ ChunkIdx   │ Data      │
 * │ 0x43 0x53│ (4B BE)  │ 0x01     │ (2B BE)       │ (variable)   │ (4B BE)    │ (raw)     │
 * └──────────┴──────────┴──────────┴───────────────┴──────────────┴────────────┴───────────┘
 * ```
 *
 * @param socket - TCP socket to write to
 * @param transferId - UUID of the transfer
 * @param chunkIndex - Index of the chunk (0-based)
 * @param data - Raw chunk data buffer
 * @returns true if data was buffered, false if backpressure should be applied
 */
export function sendBinaryChunk(socket: Socket, transferId: string, chunkIndex: number, data: Buffer): boolean {
  if (!socket || socket.destroyed || !socket.writable) {
    throw new Error('Socket is not writable')
  }

  const tidBuffer = Buffer.from(transferId, 'utf8')
  const tidLen = tidBuffer.length

  // totalLen = type(1) + tidLen(2) + tid(n) + idx(4) + data(m)
  const totalLen = 1 + 2 + tidLen + 4 + data.length

  const header = Buffer.allocUnsafe(2 + 4 + 1 + 2 + tidLen + 4)
  let offset = 0

  // Magic (2 bytes): "CS"
  header[offset++] = 0x43
  header[offset++] = 0x53

  // TotalLen (4 bytes, Big-Endian)
  header.writeUInt32BE(totalLen, offset)
  offset += 4

  // Type (1 byte)
  header[offset++] = BINARY_TYPE_FILE_CHUNK

  // TransferId length (2 bytes, Big-Endian)
  header.writeUInt16BE(tidLen, offset)
  offset += 2

  // TransferId (variable)
  tidBuffer.copy(header, offset)
  offset += tidLen

  // ChunkIndex (4 bytes, Big-Endian)
  header.writeUInt32BE(chunkIndex, offset)

  socket.cork()
  const wroteHeader = socket.write(header)
  const wroteData = socket.write(data)
  socket.uncork()

  return wroteHeader && wroteData
}
