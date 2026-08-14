import type { AddressInfo } from 'node:net'

import { loggerService } from '@logger'
import { installBundledDevtools } from '@main/core/devtools'
import { BaseService, Conditional, Injectable, Phase, Priority, ServicePhase, when } from '@main/core/lifecycle'
import { collectProcessMetrics, type MemorySample, perf, type PerfRecorder, sampleMemory } from '@main/core/perf'
import { isDev } from '@main/core/platform'
import type WebSocket from 'ws'
import type { WebSocketServer } from 'ws'

const logger = loggerService.withContext('PerfDevtoolsService')

/**
 * 面板连接的固定 localhost 端口。
 * 与 resources/devtools/main-perf/panel.js 的 PERF_DEVTOOLS_PORT 保持一致。
 */
export const PERF_DEVTOOLS_DEFAULT_PORT = 38998

const MEMORY_SAMPLE_INTERVAL_MS = 2000
const MAX_MEMORY_SAMPLES = 900

/** WebSocket 中本服务用到的那一小部分，便于测试替身。 */
interface PanelSocket {
  readyState: number
  send(payload: string): void
  close(code?: number, reason?: string): void
  on(event: string, listener: (...args: never[]) => void): void
}

/**
 * 开发期性能面板的后端：把 core/perf 的 span 与内存采样推给打包的
 * Main Perf DevTools 扩展。仅在开发模式启用。
 */
@Injectable('PerfDevtoolsService')
@ServicePhase(Phase.Background)
@Priority(0)
@Conditional(when(() => isDev, 'development mode'))
export class PerfDevtoolsService extends BaseService {
  private readonly clients = new Set<PanelSocket>()
  private readonly allowedOrigins = new Set<string>()
  private readonly memory: MemorySample[] = []

  /** recorder 可注入，测试才能用可控时钟而不碰全局单例。 */
  constructor(private readonly recorder: PerfRecorder = perf) {
    super()
  }

  protected async onInit(): Promise<void> {
    this.registerDisposable(this.recorder.onSpan((span) => this.broadcast({ type: 'span', span })))
    this.registerInterval(() => this.pushMemorySample(), MEMORY_SAMPLE_INTERVAL_MS)

    try {
      await this.startWebSocketServer()
    } catch (error) {
      logger.error('Failed to start Main Perf DevTools websocket server', error as Error)
    }
  }

  /**
   * 与 MainNetworkDevtoolsService 同因：Background 阶段在 app.whenReady() 之前跑，
   * onInit 里取 session.defaultSession 会抛。onAllReady 时 app 已就绪。
   */
  protected async onAllReady(): Promise<void> {
    await installBundledDevtools('main-perf', 'Main Perf', (extension) => {
      this.registerOrigin(`chrome-extension://${extension.id}`)
    })
  }

  private registerOrigin(origin: string): void {
    this.allowedOrigins.add(normalizeOrigin(origin))
  }

  private pushMemorySample(): void {
    const sample = sampleMemory()
    this.memory.push(sample)
    if (this.memory.length > MAX_MEMORY_SAMPLES) this.memory.shift()
    this.broadcast({ type: 'memory', sample })
  }

  private handleConnection(socket: PanelSocket, origin: string | undefined): void {
    if (!origin || !this.allowedOrigins.has(normalizeOrigin(origin))) {
      socket.close(1008, 'Unauthorized origin')
      return
    }

    this.clients.add(socket)
    socket.send(
      JSON.stringify({
        type: 'snapshot',
        spans: this.recorder.snapshot(),
        memory: this.memory,
        processes: collectProcessMetrics()
      })
    )
    socket.on('message', ((raw: unknown) => this.handleClientMessage(socket, String(raw))) as never)
    socket.on('close', (() => this.clients.delete(socket)) as never)
    socket.on('error', (() => this.clients.delete(socket)) as never)
  }

  private handleClientMessage(socket: PanelSocket, raw: string): void {
    let message: unknown
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }
    if (!message || typeof message !== 'object') return

    const type = (message as { type?: unknown }).type
    if (type === 'clear') {
      this.recorder.clear()
      this.broadcast({ type: 'cleared' })
      return
    }
    if (type === 'metrics') {
      socket.send(JSON.stringify({ type: 'metrics', processes: collectProcessMetrics() }))
    }
  }

  private async startWebSocketServer(port = PERF_DEVTOOLS_DEFAULT_PORT): Promise<number> {
    const { WebSocketServer } = await import('ws')
    const server = new WebSocketServer({ host: '127.0.0.1', port })

    server.on('error', (error) => logger.error('Main Perf DevTools websocket server error', error))
    server.on('connection', (socket: WebSocket, request) => {
      this.handleConnection(socket as unknown as PanelSocket, request.headers.origin)
    })

    try {
      await waitForServerListening(server)
    } catch (error) {
      server.close()
      throw error
    }

    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Main Perf DevTools websocket server did not expose a TCP port')
    }
    const listeningPort = (address as AddressInfo).port
    logger.info(`Main Perf DevTools websocket server listening on 127.0.0.1:${listeningPort}`)

    this.registerDisposable(() => {
      for (const client of this.clients) client.close()
      this.clients.clear()
      server.close()
    })

    return listeningPort
  }

  private broadcast(message: unknown): void {
    if (this.clients.size === 0) return
    const payload = JSON.stringify(message)
    for (const client of this.clients) {
      if (client.readyState === 1) client.send(payload)
    }
  }
}

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/$/, '')
}

function waitForServerListening(server: WebSocketServer): Promise<void> {
  if (server.address()) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.off('listening', handleListening)
      server.off('error', handleError)
    }
    const handleListening = () => {
      cleanup()
      resolve()
    }
    const handleError = (error: Error) => {
      cleanup()
      reject(error)
    }
    server.once('listening', handleListening)
    server.once('error', handleError)
  })
}
