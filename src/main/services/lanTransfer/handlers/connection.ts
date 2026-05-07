import { isIP, type Socket } from 'node:net'
import { platform } from 'node:os'

import { loggerService } from '@logger'
import type { LanHandshakeRequestMessage, LocalTransferPeer } from '@shared/config/types'
import { app } from 'electron'

import type { ConnectionContext } from '../types'

export const HANDSHAKE_PROTOCOL_VERSION = '1'

/** Maximum size for line buffer to prevent memory exhaustion from malicious peers */
const MAX_LINE_BUFFER_SIZE = 1024 * 1024 // 1MB limit for control messages

const logger = loggerService.withContext('LanTransferConnection')

/**
 * Build a handshake request message with device info.
 */
export function buildHandshakeMessage(): LanHandshakeRequestMessage {
  return {
    type: 'handshake',
    deviceName: app.getName(),
    version: HANDSHAKE_PROTOCOL_VERSION,
    platform: platform(),
    appVersion: app.getVersion()
  }
}

/**
 * Pick the best host address from a peer's available addresses.
 * Prefers IPv4 addresses over IPv6.
 */
export function pickHost(peer: LocalTransferPeer): string | undefined {
  const preferred = peer.addresses?.find((addr) => isIP(addr) === 4) || peer.addresses?.[0]
  return preferred || peer.host
}

/**
 * Send a test ping message after successful handshake.
 */
export function sendTestPing(ctx: ConnectionContext): void {
  const payload = 'hello world'
  try {
    ctx.sendControlMessage({ type: 'ping', payload })
    logger.info('Sent LAN ping test payload')
    ctx.broadcastClientEvent({
      type: 'ping_sent',
      payload,
      timestamp: Date.now()
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Failed to send LAN test ping', error as Error)
    ctx.broadcastClientEvent({
      type: 'error',
      message,
      timestamp: Date.now()
    })
  }
}

/**
 * Attach data listener to socket for receiving control messages.
 * Returns a function to parse the line buffer.
 */
export function createDataHandler(onControlLine: (line: string) => void): {
  lineBuffer: string
  handleData: (chunk: Buffer) => void
  resetBuffer: () => void
} {
  let lineBuffer = ''

  return {
    get lineBuffer() {
      return lineBuffer
    },
    handleData(chunk: Buffer) {
      lineBuffer += chunk.toString('utf8')

      // Prevent memory exhaustion from malicious peers sending data without newlines
      if (lineBuffer.length > MAX_LINE_BUFFER_SIZE) {
        logger.error('Line buffer exceeded maximum size, resetting')
        lineBuffer = ''
        throw new Error('Control message too large')
      }

      let newlineIndex = lineBuffer.indexOf('\n')
      while (newlineIndex !== -1) {
        const line = lineBuffer.slice(0, newlineIndex).trim()
        lineBuffer = lineBuffer.slice(newlineIndex + 1)
        if (line.length > 0) {
          onControlLine(line)
        }
        newlineIndex = lineBuffer.indexOf('\n')
      }
    },
    resetBuffer() {
      lineBuffer = ''
    }
  }
}

/**
 * Wait for socket to drain (backpressure handling).
 */
export async function waitForSocketDrain(socket: Socket, abortSignal: AbortSignal): Promise<void> {
  if (abortSignal.aborted) {
    throw getAbortError(abortSignal, 'Transfer aborted while waiting for socket drain')
  }
  if (socket.destroyed) {
    throw new Error('Socket is closed')
  }

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      socket.off('drain', onDrain)
      socket.off('close', onClose)
      socket.off('error', onError)
      abortSignal.removeEventListener('abort', onAbort)
    }

    const onDrain = () => {
      cleanup()
      resolve()
    }

    const onClose = () => {
      cleanup()
      reject(new Error('Socket closed while waiting for drain'))
    }

    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }

    const onAbort = () => {
      cleanup()
      reject(getAbortError(abortSignal, 'Transfer aborted while waiting for socket drain'))
    }

    socket.once('drain', onDrain)
    socket.once('close', onClose)
    socket.once('error', onError)
    abortSignal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Get the error from an abort signal, or create a fallback error.
 */
export function getAbortError(signal: AbortSignal, fallbackMessage: string): Error {
  const reason = (signal as AbortSignal & { reason?: unknown }).reason
  if (reason instanceof Error) {
    return reason
  }
  if (typeof reason === 'string' && reason.length > 0) {
    return new Error(reason)
  }
  return new Error(fallbackMessage)
}
