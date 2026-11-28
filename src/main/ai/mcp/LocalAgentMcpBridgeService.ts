import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server'

import { loggerService } from '@logger'
import { type AutomationReplController, createAutomationReplController } from '@main/ai/mcp/servers/automationRepl'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

const logger = loggerService.withContext('LocalAgentMcpBridgeService')
const MCP_ROUTE_PREFIX = '/mcp/'
const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024

export interface LocalAgentBrowserLeaseInput {
  sessionId: string
  agentId: string
  isBrowserAllowed?: () => boolean
  isReadOnly?: () => boolean
}

export interface LocalAgentBrowserLease {
  readonly url: string
  readonly token: string
  readonly headers: Readonly<Record<string, string>>
  dispose(): Promise<void>
}

interface ActiveLease {
  readonly controller: AutomationReplController
  readonly handler: McpHttpHandler
  readonly tokenHash: Buffer
  disposed: boolean
  closing?: Promise<void>
}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

function matchesBearerToken(header: string | undefined, expectedHash: Buffer): boolean {
  if (!header?.startsWith('Bearer ')) return false
  const token = header.slice('Bearer '.length).trim()
  if (!token) return false
  return timingSafeEqual(hashToken(token), expectedHash)
}

function sendJsonError(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) return
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: message }))
}

function toWebHeaders(rawHeaders: IncomingMessage['headers']): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
    } else {
      headers.set(key, value)
    }
  }
  return headers
}

class RequestBodyTooLargeError extends Error {}

async function readBoundedBody(req: IncomingMessage): Promise<Buffer> {
  const contentLength = req.headers['content-length']
  if (contentLength !== undefined) {
    const parsedLength = Number(contentLength)
    if (Number.isFinite(parsedLength) && parsedLength > MAX_REQUEST_BODY_BYTES) {
      req.resume()
      throw new RequestBodyTooLargeError('Request body too large')
    }
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (total > MAX_REQUEST_BODY_BYTES) {
      throw new RequestBodyTooLargeError('Request body too large')
    }
    chunks.push(buf)
  }
  return Buffer.concat(chunks)
}

@Injectable('LocalAgentMcpBridgeService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['AutomationReplService'])
export class LocalAgentMcpBridgeService extends BaseService {
  private server?: http.Server
  private port?: number
  private serverStart?: Promise<number>
  private accepting = false
  private readonly leases = new Map<string, ActiveLease>()
  private readonly closingLeases = new Set<Promise<void>>()

  protected onInit(): void {
    this.accepting = true
  }

  async issueBrowserLease(input: LocalAgentBrowserLeaseInput): Promise<LocalAgentBrowserLease> {
    if (!this.accepting) throw new Error('LocalAgentMcpBridgeService is stopped')
    if (!input.agentId) throw new Error('Browser lease requires an agentId')

    const port = await this.ensureServer()
    if (!this.accepting) throw new Error('LocalAgentMcpBridgeService is stopped')

    const leaseId = randomUUID()
    const token = randomBytes(32).toString('hex')
    const controller = createAutomationReplController(input.sessionId, input.agentId, {
      browserOnly: true,
      isBrowserAllowed: input.isBrowserAllowed,
      isReadOnly: input.isReadOnly
    })
    const handler = createMcpHandler(() => controller.createServer(), {
      legacy: 'stateless',
      maxRequestBodySize: MAX_REQUEST_BODY_BYTES
    })
    const entry: ActiveLease = {
      controller,
      handler,
      tokenHash: hashToken(token),
      disposed: false
    }
    this.leases.set(leaseId, entry)

    const dispose = (): Promise<void> => {
      if (entry.closing) return entry.closing
      entry.disposed = true
      this.leases.delete(leaseId)
      const task = Promise.allSettled([handler.close(), controller.dispose()]).then(() => undefined)
      entry.closing = task
      this.closingLeases.add(task)
      void task.finally(() => this.closingLeases.delete(task))
      return task
    }

    return {
      url: `http://127.0.0.1:${port}${MCP_ROUTE_PREFIX}${leaseId}`,
      token,
      headers: { Authorization: `Bearer ${token}` },
      dispose
    }
  }

  private async ensureServer(): Promise<number> {
    if (this.port !== undefined) return this.port
    if (this.serverStart) return this.serverStart

    this.serverStart = new Promise<number>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        void this.handleHttpRequest(req, res).catch((error) => {
          logger.warn('Unhandled local agent MCP bridge error', { error })
          sendJsonError(res, 500, 'Internal server error')
        })
      })
      server.once('error', (error) => {
        if (this.server === server) this.server = undefined
        this.serverStart = undefined
        reject(error)
      })
      this.server = server
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') {
          this.serverStart = undefined
          reject(new Error('Failed to resolve bridge port'))
          return
        }
        this.port = address.port
        this.serverStart = undefined
        resolve(address.port)
      })
    })
    return this.serverStart
  }

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.accepting || this.port === undefined) {
      sendJsonError(res, 503, 'Service unavailable')
      return
    }
    const expectedHost = `127.0.0.1:${this.port}`
    if (req.headers.host !== expectedHost) {
      sendJsonError(res, 403, 'Forbidden host')
      return
    }
    const origin = req.headers.origin
    if (origin !== undefined && origin !== `http://${expectedHost}`) {
      sendJsonError(res, 403, 'Forbidden origin')
      return
    }

    let url: URL
    try {
      url = new URL(req.url ?? '/', `http://${expectedHost}`)
    } catch {
      sendJsonError(res, 400, 'Invalid request URL')
      return
    }
    if (!url.pathname.startsWith(MCP_ROUTE_PREFIX)) {
      sendJsonError(res, 404, 'Not found')
      return
    }
    const leaseId = url.pathname.slice(MCP_ROUTE_PREFIX.length)
    if (!leaseId || leaseId.includes('/')) {
      sendJsonError(res, 404, 'Not found')
      return
    }

    const lease = this.leases.get(leaseId)
    if (!lease || lease.disposed || !matchesBearerToken(req.headers.authorization, lease.tokenHash)) {
      sendJsonError(res, 401, 'Unauthorized')
      return
    }

    const method = req.method ?? 'GET'
    let body: string | undefined
    if (method !== 'GET' && method !== 'HEAD') {
      try {
        const raw = await readBoundedBody(req)
        if (raw.length > 0) body = raw.toString('utf8')
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          sendJsonError(res, 413, 'Payload too large')
          return
        }
        throw error
      }
    }

    const webRequest = new Request(url, {
      method,
      headers: toWebHeaders(req.headers),
      ...(body !== undefined ? { body } : {})
    })
    const response = await lease.handler.fetch(webRequest)
    const responseHeaders: Record<string, string | string[]> = {}
    response.headers.forEach((value, key) => {
      const existing = responseHeaders[key]
      responseHeaders[key] =
        existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value]
    })
    res.writeHead(response.status, responseHeaders)

    if (!response.body) {
      res.end()
      return
    }
    const stream = Readable.fromWeb(response.body as never)
    res.once('close', () => {
      stream.destroy()
    })
    stream.on('error', (error) => {
      logger.warn('Bridge response stream failed', { error })
      res.destroy(error)
    })
    stream.pipe(res)
  }

  protected async onStop(): Promise<void> {
    this.accepting = false
    const disposals: Promise<void>[] = [...this.closingLeases]
    for (const [leaseId, entry] of this.leases) {
      this.leases.delete(leaseId)
      entry.disposed = true
      const task = (entry.closing ??= Promise.allSettled([entry.handler.close(), entry.controller.dispose()]).then(
        () => undefined
      ))
      disposals.push(task)
    }
    await Promise.allSettled(disposals)

    const pendingServerStart = this.serverStart
    if (pendingServerStart) await pendingServerStart.catch(() => undefined)

    const server = this.server
    this.server = undefined
    this.port = undefined
    this.serverStart = undefined
    if (server?.listening) {
      server.closeAllConnections?.()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}
