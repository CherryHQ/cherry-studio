import { createServer } from 'node:http'

import { WebSocket, WebSocketServer } from 'ws'

import { authSchema, type RemoteAuth } from './protocol'
import { acceptHello, MAX_FRAME_BYTES, type SecureChannel } from './secureChannel'

type ConnectionHandler = { receive(value: unknown): void; dispose(): void }
type ServerOptions = {
  host: string
  port: number
  identity: { instanceId: string; secretKey: Uint8Array }
  authenticate(auth: RemoteAuth): { deviceId: string }
  connected(deviceId: string, send: (value: unknown) => void, close: () => void): ConnectionHandler
  failed(error: Error): void
}

export class RemoteServer {
  private readonly http = createServer((_request, response) => {
    response.writeHead(404)
    response.end()
  })
  private readonly sockets = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES,
    perMessageDeflate: false
  })
  private readonly devices = new Map<string, WebSocket>()
  private readonly clients = new Set<WebSocket>()
  private readonly heartbeats = new Map<WebSocket, { lastPong: number; openedAt: number; lastActivity: number }>()
  private readonly cleanups = new Map<WebSocket, () => void>()
  private readonly admissions = new Map<string, { startsAt: number; count: number }>()
  private stopping = false

  constructor(private readonly options: ServerOptions) {
    this.http.requestTimeout = 10_000
    this.http.headersTimeout = 10_000
    this.http.maxConnections = 32
    this.http.on('upgrade', (request, socket, head) => {
      const now = Date.now()
      const address = request.socket.remoteAddress ?? ''
      const host = `${request.socket.localAddress}:${request.socket.localPort}`
      for (const [key, entry] of this.admissions) if (now - entry.startsAt >= 60_000) this.admissions.delete(key)
      const admission = this.admissions.get(address) ?? { startsAt: now, count: 0 }
      if (
        this.stopping ||
        request.url !== '/remote/v1/connect' ||
        (request.headers.origin !== undefined && request.headers.origin !== `http://${host}`) ||
        request.headers.host !== host ||
        this.clients.size >= 16 ||
        (!this.admissions.has(address) && this.admissions.size >= 128) ||
        ++admission.count > 30
      ) {
        socket.destroy()
        return
      }
      this.admissions.set(address, admission)
      this.sockets.handleUpgrade(request, socket, head, (ws) => this.accept(ws))
    })
    this.http.on('clientError', (_error, socket) => socket.destroy())
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => {
        this.http.off('listening', listening)
        reject(error)
      }
      const listening = () => {
        this.http.off('error', failed)
        this.http.on('error', this.options.failed)
        resolve()
      }
      this.http.once('error', failed)
      this.http.once('listening', listening)
      this.http.listen({ host: this.options.host, port: this.options.port })
    })
  }

  get port(): number {
    const address = this.http.address()
    if (!address || typeof address === 'string') throw new Error('REMOTE_ACCESS_DISABLED')
    return address.port
  }

  get isListening(): boolean {
    return this.http.listening && !this.stopping
  }

  disconnect(deviceId: string): void {
    const socket = this.devices.get(deviceId)
    if (socket) this.terminate(socket)
  }

  private terminate(socket: WebSocket): void {
    this.cleanups.get(socket)?.()
    socket.terminate()
  }

  sweep(): void {
    const now = Date.now()
    for (const [socket, heartbeat] of this.heartbeats) {
      if (
        now - heartbeat.lastPong >= 60_000 ||
        now - heartbeat.openedAt >= 3_600_000 ||
        now - heartbeat.lastActivity >= 600_000
      ) {
        this.terminate(socket)
      } else {
        socket.ping()
      }
    }
  }

  async stop(): Promise<void> {
    this.stopping = true
    for (const socket of this.clients) this.terminate(socket)
    this.sockets.close()
    this.http.closeAllConnections()
    if (this.http.listening) await new Promise<void>((resolve) => this.http.close(() => resolve()))
  }

  private accept(socket: WebSocket): void {
    this.clients.add(socket)
    const heartbeat = { lastPong: Date.now(), openedAt: Date.now(), lastActivity: Date.now() }
    this.heartbeats.set(socket, heartbeat)
    let channel: SecureChannel | undefined
    let transcriptHash = ''
    let deviceId: string | undefined
    let handler: ConnectionHandler | undefined
    let tokens = 30
    let replenishedAt = Date.now()
    const deadline = setTimeout(() => this.terminate(socket), 10_000)
    deadline.unref()
    const close = () => this.terminate(socket)
    const send = (value: unknown) => {
      if (socket.readyState !== WebSocket.OPEN || !channel) return
      try {
        const payload = Buffer.from(JSON.stringify(value))
        if (socket.bufferedAmount + payload.length + 81 > 4 * 1024 * 1024) {
          close()
          return
        }
        socket.send(channel.seal(payload), (error) => {
          if (error) close()
        })
        heartbeat.lastActivity = Date.now()
      } catch {
        close()
      }
    }
    socket.on('pong', () => {
      heartbeat.lastPong = Date.now()
    })
    socket.on('error', close)
    const cleanup = () => {
      if (!this.cleanups.delete(socket)) return
      clearTimeout(deadline)
      channel?.dispose()
      handler?.dispose()
      this.clients.delete(socket)
      this.heartbeats.delete(socket)
      if (deviceId && this.devices.get(deviceId) === socket) this.devices.delete(deviceId)
    }
    this.cleanups.set(socket, cleanup)
    socket.once('close', cleanup)
    socket.on('message', (raw, binary) => {
      if (socket.readyState !== WebSocket.OPEN) return
      try {
        const frame = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw as ArrayBuffer)
        const parse = (bytes: Uint8Array) =>
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
        if (!channel) {
          if (binary || frame.length > 4096) throw new Error('INVALID_HELLO')
          const accepted = acceptHello(parse(frame), this.options.identity)
          channel = accepted.channel
          transcriptHash = accepted.transcriptHash
          socket.send(JSON.stringify(accepted.ready))
          send({ type: 'confirm', transcriptHash })
          return
        }
        if (!binary) throw new Error('INVALID_FRAME')
        const value = parse(channel.open(frame))
        if (!handler) {
          const auth = authSchema.parse(value)
          if (auth.transcriptHash !== transcriptHash || this.stopping) throw new Error('AUTH_FAILED')
          const credentials = this.options.authenticate(auth)
          if (!this.devices.has(credentials.deviceId) && this.devices.size >= 8) throw new Error('DEVICE_LIMIT')
          deviceId = credentials.deviceId
          this.disconnect(deviceId)
          this.devices.set(deviceId, socket)
          handler = this.options.connected(deviceId, send, close)
          clearTimeout(deadline)
          send({ type: 'authenticated', ...credentials, expiresAt: heartbeat.openedAt + 3_600_000 })
          return
        }
        const now = Date.now()
        tokens = Math.min(30, tokens + (now - replenishedAt) / 500)
        replenishedAt = now
        if (tokens < 1) throw new Error('RATE_LIMITED')
        tokens--
        heartbeat.lastActivity = now
        handler.receive(value)
      } catch {
        close()
      }
    })
  }
}
