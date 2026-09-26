import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

import type { AgentMcpServer } from '@main/ai/runtime/agentMcpServers'

import {
  UAR_TOOL_ADMISSION_PATH,
  UAR_TOOL_ADMISSION_VERSION,
  UarHostToolAdmission,
  type UarHostAdmissionSnapshot,
  type UarHostAdmissionState,
  type UarHostToolAdmissionOptions
} from './UarHostToolAdmission'

export interface UarRunMcpServer {
  name: string
  url: string
  headers: Record<string, string>
}

export interface UarHostMcpBridge {
  servers: readonly UarRunMcpServer[]
  toolAdmission: {
    version: number
    hostEpoch: string
    url: string
    headers: Record<string, string>
  }
  redactions: readonly string[]
  recordHumanDecision(admissionId: string, approved: boolean): boolean
  cancelAdmission(
    admissionId: string,
    invocationId?: string,
    reason?: 'cancelled' | 'invalidated'
  ): UarHostAdmissionState | undefined
  approvalSnapshot(): UarHostAdmissionSnapshot[]
  close(): Promise<void>
}

type MountedServer = {
  path: string
  server: AgentMcpServer
  transport: StreamableHTTPServerTransport
}

export async function createUarHostMcpBridge(
  servers: Record<string, AgentMcpServer>,
  admissionOptions: UarHostToolAdmissionOptions,
  onError: (error: unknown) => void = () => undefined
): Promise<UarHostMcpBridge> {
  const token = randomBytes(32).toString('base64url')
  const mounted = await connectServers(servers, token)
  const routes = new Map(mounted.map((entry) => [entry.path, entry]))
  const admissions = new UarHostToolAdmission(admissionOptions)
  let expectedHost = ''
  const httpServer = createServer((request, response) => {
    void handleRequest(request, response, expectedHost, token, routes, admissions).catch((error) => {
      onError(error)
      if (!response.headersSent) response.writeHead(500)
      response.end()
    })
  })

  try {
    const port = await listen(httpServer)
    expectedHost = `127.0.0.1:${port}`
    const admissionUrl = `http://${expectedHost}${UAR_TOOL_ADMISSION_PATH}`
    return {
      servers: mounted.map((entry) => ({
        name: entry.server.name,
        url: `http://${expectedHost}${entry.path}`,
        headers: { Authorization: `Bearer ${token}` }
      })),
      toolAdmission: {
        version: UAR_TOOL_ADMISSION_VERSION,
        hostEpoch: admissions.hostEpoch,
        url: admissionUrl,
        headers: { Authorization: `Bearer ${token}` }
      },
      redactions: [token, admissionUrl, ...mounted.map((entry) => `http://${expectedHost}${entry.path}`)],
      recordHumanDecision: (admissionId, approved) => admissions.recordHumanDecision(admissionId, approved),
      cancelAdmission: (admissionId, invocationId, reason) =>
        admissions.cancelAdmission(admissionId, invocationId, reason),
      approvalSnapshot: () => admissions.snapshots(),
      close: async () => {
        admissions.invalidateForTeardown(onError)
        await closeBridge(httpServer, mounted)
      }
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
  admissions: UarHostToolAdmission
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
  const body = request.method === 'POST' ? await readJsonBody(request) : undefined
  if (admissions.handleHttp(request.method, url.pathname, body, response)) return
  const mounted = !url.search && routes.get(url.pathname)
  if (!mounted) {
    response.writeHead(404)
    response.end()
    return
  }
  const claim = admissions.claimToolCall(body, mounted.server.name)
  if (claim.error) {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: claim.call?.id ?? null,
        error: { code: -32_003, message: claim.error }
      })
    )
    return
  }
  await mounted.transport.handleRequest(request, response, body)
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
