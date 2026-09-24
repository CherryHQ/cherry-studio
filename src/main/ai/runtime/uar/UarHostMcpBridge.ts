import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

import { loggerService } from '@logger'
import type { AgentMcpServer } from '@main/ai/runtime/agentMcpServers'

const logger = loggerService.withContext('UarHostMcpBridge')

export interface UarRunMcpServer {
  name: string
  url: string
  headers: Record<string, string>
}

export interface UarHostMcpBridge {
  servers: readonly UarRunMcpServer[]
  redactions: readonly string[]
  approveToolCall(identity: UarToolCallIdentity): void
  revokeToolCall(identity: UarToolCallIdentity): void
  close(): Promise<void>
}

export interface UarToolCallIdentity {
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
}

type MountedServer = {
  path: string
  server: AgentMcpServer
  transport: StreamableHTTPServerTransport
}

export async function createUarHostMcpBridge(servers: Record<string, AgentMcpServer>): Promise<UarHostMcpBridge> {
  const token = randomBytes(32).toString('base64url')
  const mounted = await connectServers(servers, token)
  const routes = new Map(mounted.map((entry) => [entry.path, entry]))
  const approvals = new ToolApprovalLedger()
  let expectedHost = ''
  const httpServer = createServer((request, response) => {
    void handleRequest(request, response, expectedHost, token, routes, approvals).catch((error) => {
      logger.warn('UAR host MCP request failed', { error })
      if (!response.headersSent) response.writeHead(500)
      response.end()
    })
  })

  try {
    const port = await listen(httpServer)
    expectedHost = `127.0.0.1:${port}`
    return {
      servers: mounted.map((entry) => ({
        name: entry.server.name,
        url: `http://${expectedHost}${entry.path}`,
        headers: { Authorization: `Bearer ${token}` }
      })),
      redactions: [token, ...mounted.map((entry) => `http://${expectedHost}${entry.path}`)],
      approveToolCall: (identity) => approvals.approve(identity),
      revokeToolCall: (identity) => approvals.revoke(identity),
      close: () => closeBridge(httpServer, mounted)
    }
  } catch (error) {
    await closeBridge(httpServer, mounted)
    throw error
  }
}

async function connectServers(servers: Record<string, AgentMcpServer>, token: string): Promise<MountedServer[]> {
  const mounted: MountedServer[] = []
  try {
    for (const [serverId, server] of Object.entries(servers)) {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID })
      await server.instance.connect(transport)
      mounted.push({
        path: `/mcp/${createHash('sha256').update(`${token}\0${serverId}`).digest('hex')}`,
        server,
        transport
      })
    }
    return mounted
  } catch (error) {
    await closeMountedServers(mounted)
    throw error
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  expectedHost: string,
  token: string,
  routes: ReadonlyMap<string, MountedServer>,
  approvals: ToolApprovalLedger
): Promise<void> {
  const remoteAddress = request.socket.remoteAddress
  if (
    remoteAddress !== '127.0.0.1' ||
    request.headers.host !== expectedHost ||
    request.headers.origin !== undefined ||
    !matchesBearerToken(request.headers.authorization, token)
  ) {
    response.writeHead(403)
    response.end()
    return
  }

  const url = new URL(request.url ?? '/', `http://${expectedHost}`)
  const mounted = !url.search && routes.get(url.pathname)
  if (!mounted) {
    response.writeHead(404)
    response.end()
    return
  }
  const body = request.method === 'POST' ? await readJsonBody(request) : undefined
  const deniedCall = findDeniedToolCall(body, mounted.server.name, approvals)
  if (deniedCall) {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: deniedCall.id,
        error: { code: -32_003, message: 'Tool call is not approved by the host' }
      })
    )
    return
  }
  await mounted.transport.handleRequest(request, response, body)
}

class ToolApprovalLedger {
  private readonly approved = new Map<string, string[]>()

  approve(identity: UarToolCallIdentity): void {
    const key = toolCallFingerprint(identity.toolName, identity.input)
    const calls = this.approved.get(key) ?? []
    calls.push(identity.toolCallId)
    this.approved.set(key, calls)
  }

  revoke(identity: UarToolCallIdentity): void {
    const key = toolCallFingerprint(identity.toolName, identity.input)
    const calls = this.approved.get(key)
    if (!calls) return
    const index = calls.indexOf(identity.toolCallId)
    if (index >= 0) calls.splice(index, 1)
    if (calls.length === 0) this.approved.delete(key)
  }

  consume(toolName: string, input: Record<string, unknown>): boolean {
    const key = toolCallFingerprint(toolName, input)
    const calls = this.approved.get(key)
    if (!calls?.length) return false
    calls.shift()
    if (calls.length === 0) this.approved.delete(key)
    return true
  }
}

type JsonRpcCall = { id: unknown }

function findDeniedToolCall(body: unknown, serverName: string, approvals: ToolApprovalLedger): JsonRpcCall | undefined {
  const messages = Array.isArray(body) ? body : [body]
  for (const message of messages) {
    if (!isRecord(message) || message.method !== 'tools/call' || !isRecord(message.params)) continue
    const name = message.params.name
    const args = message.params.arguments
    if (typeof name !== 'string') return { id: message.id ?? null }
    const input = isRecord(args) ? args : {}
    const toolName = sanitizeToolName(`${serverName}__${name}`)
    if (!approvals.consume(toolName, input)) return { id: message.id ?? null }
  }
  return undefined
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 8 * 1024 * 1024) throw new Error('UAR host MCP request body exceeds 8 MiB')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return undefined
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function toolCallFingerprint(toolName: string, input: Record<string, unknown>): string {
  return createHash('sha256')
    .update(`${toolName}\0${JSON.stringify(canonicalize(input))}`)
    .digest('hex')
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)])
  )
}

function sanitizeToolName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function matchesBearerToken(authorization: string | undefined, token: string): boolean {
  if (!authorization?.startsWith('Bearer ')) return false
  const actual = Buffer.from(authorization.slice(7))
  const expected = Buffer.from(token)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError)
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('UAR host MCP bridge did not receive a TCP address'))
        return
      }
      resolve(address.port)
    })
  })
}

async function closeBridge(server: Server, mounted: readonly MountedServer[]): Promise<void> {
  server.closeAllConnections()
  await Promise.allSettled([closeHttpServer(server), closeMountedServers(mounted)])
}

function closeHttpServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolve) => server.close(() => resolve()))
}

async function closeMountedServers(mounted: readonly MountedServer[]): Promise<void> {
  await Promise.allSettled(mounted.map((entry) => entry.server.instance.close()))
}
