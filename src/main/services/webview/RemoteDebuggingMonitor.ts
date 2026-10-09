import type { Protocol } from 'devtools-protocol'
import WebSocket from 'ws'

import { loggerService } from '@logger'

const logger = loggerService.withContext('RemoteDebuggingMonitor')

export class RemoteDebuggingMonitor {
  private readonly targets = new Map<string, boolean>()
  private socket?: WebSocket
  private retry?: NodeJS.Timeout
  private request?: AbortController
  private stopped = true
  private generation = 0

  constructor(
    private readonly getPort: () => Promise<number>,
    private readonly onChange: (targetId: string, attached: boolean) => void
  ) {}

  start() {
    if (!this.stopped) return
    this.stopped = false
    void this.connect(++this.generation)
  }

  stop() {
    this.stopped = true
    this.generation++
    clearTimeout(this.retry)
    this.retry = undefined
    this.request?.abort()
    const socket = this.socket
    this.socket = undefined
    socket?.terminate()
    this.clearTargets()
  }

  isAttached(targetId: string): boolean {
    return this.targets.get(targetId) ?? false
  }

  getAttachedTargetIds(): string[] {
    return [...this.targets].filter(([, attached]) => attached).map(([targetId]) => targetId)
  }

  private updateTarget(targetId: string, attached: boolean) {
    const previous = this.isAttached(targetId)
    this.targets.set(targetId, attached)
    if (previous !== attached) this.onChange(targetId, attached)
  }

  private clearTargets() {
    const attachedTargets = [...this.targets].filter(([, attached]) => attached)
    this.targets.clear()
    for (const [targetId] of attachedTargets) this.onChange(targetId, false)
  }

  private reconnect(generation: number) {
    if (this.stopped || generation !== this.generation || this.retry) return
    this.retry = setTimeout(() => {
      this.retry = undefined
      void this.connect(generation)
    }, 1000)
    this.retry.unref()
  }

  private async connect(generation: number) {
    const request = new AbortController()
    this.request = request
    try {
      const port = await this.getPort()
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(1000)])
      })
      const version = (await response.json()) as { webSocketDebuggerUrl: string }
      if (this.stopped || generation !== this.generation) return
      const address = new URL(version.webSocketDebuggerUrl)
      if (
        address.protocol !== 'ws:' ||
        address.hostname !== '127.0.0.1' ||
        address.port !== String(port) ||
        !address.pathname.startsWith('/devtools/browser/')
      ) {
        throw new Error('Unexpected remote debugging endpoint')
      }
      const socket = new WebSocket(address, { handshakeTimeout: 1000 })
      this.socket = socket
      socket.on('open', () => {
        // Observe the browser target without attaching our own debugger to a page.
        socket.send(JSON.stringify({ id: 1, method: 'Target.setDiscoverTargets', params: { discover: true } }))
      })
      socket.on('message', (data) => {
        if (this.socket !== socket) return
        try {
          const message = JSON.parse(data.toString()) as {
            id?: number
            error?: unknown
            method?: string
            params?: { targetInfo?: Protocol.Target.TargetInfo; targetId?: string }
          }
          if (message.id === 1 && message.error) {
            socket.close()
            return
          }
          if (message.method === 'Target.targetCreated' || message.method === 'Target.targetInfoChanged') {
            const info = message.params?.targetInfo
            if (info && typeof info.targetId === 'string' && typeof info.attached === 'boolean') {
              this.updateTarget(info.targetId, info.attached)
            }
          } else if (message.method === 'Target.targetDestroyed' && message.params?.targetId) {
            this.updateTarget(message.params.targetId, false)
            this.targets.delete(message.params.targetId)
          }
        } catch {
          logger.debug('Ignoring an invalid remote debugging notification')
        }
      })
      socket.on('error', () => {})
      socket.on('close', () => {
        if (this.socket !== socket) return
        this.socket = undefined
        this.clearTargets()
        this.reconnect(generation)
      })
    } catch {
      this.reconnect(generation)
    } finally {
      if (this.request === request) this.request = undefined
    }
  }
}
