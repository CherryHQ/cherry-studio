import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

import WebSocket from 'ws'

import {
  attachRelayStream,
  respondToRelayProbe,
  type RelayConnectOptions,
  type RelayStream
} from '@cherrystudio/relay-client'
import { parseServerControl, targetKeyDomain } from '@cherrystudio/relay-protocol'
import type { RelayEndpoint } from '@cherrystudio/remote-protocol'
import { loggerService } from '@logger'

const logger = loggerService.withContext('RemoteRelay')

interface RelayConnectionOptions {
  origin: string
  hostKey: string
  signal: AbortSignal
  log: RelayConnectOptions['log']
  onStatus: (status: 'connecting' | 'connected' | 'unavailable', endpoint: RelayEndpoint) => void
  onStream: (stream: RelayStream) => void
}

/** One configuration lifetime; RemoteAccessService cancels it on disable, origin change or shutdown. */
export async function maintainRelayConnection(options: RelayConnectionOptions): Promise<void> {
  const endpoint = {
    origin: options.origin,
    targetId: createHash('sha256')
      .update(targetKeyDomain + options.hostKey)
      .digest('hex')
  }
  let backoff = 1000
  while (!options.signal.aborted) {
    options.onStatus('connecting', endpoint)
    try {
      await listen(options, endpoint, () => {
        backoff = 1000
      })
    } catch {
      if (!options.signal.aborted) logger.warn('Relay listener disconnected')
    }
    if (options.signal.aborted) return
    options.onStatus('unavailable', endpoint)
    await delay(backoff, undefined, { signal: options.signal }).catch(() => {})
    backoff = Math.min(backoff * 2, 30_000)
  }
}

function listen(options: RelayConnectionOptions, endpoint: RelayEndpoint, connected: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${options.origin.replace(/^https:/, 'wss:')}/v1/relay`, {
      followRedirects: false,
      perMessageDeflate: false,
      handshakeTimeout: 5000,
      maxPayload: 4096
    })
    let admitted = false
    let finished = false
    let alive = true
    const sessions = new Map<string, { controller: AbortController; ready: boolean }>()
    const timer = setTimeout(() => finish(new Error('Relay listen timed out')), 5000)
    const heartbeat = setInterval(() => {
      if (!alive) return finish(new Error('Relay heartbeat timed out'))
      if (socket.readyState === WebSocket.OPEN) {
        alive = false
        socket.ping()
      }
    }, 30_000)
    const abort = () => finish()
    const finish = (error?: Error) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      clearInterval(heartbeat)
      options.signal.removeEventListener('abort', abort)
      for (const session of sessions.values()) if (!session.ready) session.controller.abort()
      socket.terminate()
      if (error) reject(error)
      else resolve()
    }
    const cancel = (sessionId: string) => {
      try {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ v: 1, type: 'cancel', sessionId }))
      } catch {
        finish(new Error('Relay cancel failed'))
      }
    }
    socket.on('error', () => finish(new Error('Relay socket failed')))
    socket.on('close', () => finish())
    socket.on('pong', () => {
      alive = true
    })
    socket.on('open', () => {
      if (!finished) socket.send(JSON.stringify({ v: 1, type: 'listen', hostKey: options.hostKey }))
    })
    socket.on('message', (data, binary) => {
      if (finished) return
      try {
        if (binary) throw new Error('Expected Relay control')
        const text = data.toString()
        if (respondToRelayProbe(socket, text)) return
        const message = parseServerControl(text)
        if (!admitted) {
          if (message.type !== 'listening' || message.targetId !== endpoint.targetId)
            throw new Error('Invalid Relay target')
          admitted = true
          epoch = message.ownerEpoch
          clearTimeout(timer)
          connected()
          options.onStatus('connected', endpoint)
          return
        }
        if (message.type === 'session_closed') {
          sessions.get(message.sessionId)?.controller.abort()
          return
        }
        if (message.type !== 'offer' || message.ownerEpoch !== epoch || sessions.has(message.sessionId)) {
          throw new Error('Invalid Relay offer')
        }
        if (sessions.size >= 32) {
          cancel(message.sessionId)
          return
        }
        const controller = new AbortController()
        const session = { controller, ready: false }
        const abortSession = () => controller.abort()
        options.signal.addEventListener('abort', abortSession, { once: true })
        if (options.signal.aborted) controller.abort()
        const cleanup = () => {
          options.signal.removeEventListener('abort', abortSession)
          sessions.delete(message.sessionId)
        }
        sessions.set(message.sessionId, session)
        void attachRelayStream(message, {
          origin: options.origin,
          createSocket: (url) =>
            new WebSocket(url, {
              followRedirects: false,
              perMessageDeflate: false,
              handshakeTimeout: 5000,
              maxPayload: 65_560
            }),
          signal: controller.signal,
          log: options.log
        })
          .then((stream) => {
            if (controller.signal.aborted || stream.status !== 'open') {
              stream.abort(new Error('Relay cancelled'))
              cleanup()
              return
            }
            session.ready = true
            stream.addEventListener('close', cleanup, { once: true })
            try {
              options.onStream(stream)
            } catch (error) {
              stream.abort(error instanceof Error ? error : new Error('Relay admission failed'))
              throw error
            }
          })
          .catch(() => {
            cleanup()
            cancel(message.sessionId)
          })
      } catch {
        finish(new Error('Invalid Relay listener message'))
      }
    })
    let epoch: string | undefined
    options.signal.addEventListener('abort', abort, { once: true })
    if (options.signal.aborted) abort()
  })
}
