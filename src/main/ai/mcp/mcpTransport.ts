import type { LoggerService } from '@logger'
import { createInMemoryMcpServer, getBuiltinHttpHeaders, getBuiltinRegistryEnv } from '@main/ai/mcp/servers/factory'
import { defaultAppHeaders } from '@main/utils/http'
import { removeEnvProxy } from '@main/utils/processRunner'
import type { SSEClientTransportOptions } from '@modelcontextprotocol/sdk/client/sse.js'
import type { StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { StreamableHTTPClientTransportOptions } from '@modelcontextprotocol/sdk/client/streamableHttp'
import type { McpServer, McpServerType } from '@shared/data/types/mcpServer'
import type { McpServerLogEntry } from '@shared/types/mcp'
import { redactDeep } from '@shared/utils/redaction'
import { net } from 'electron'

import type { McpClientSdk, McpTransport } from './mcpClientSdk'
import { buildStdioEnvironment } from './mcpLaunch'
import { resolveStdioLaunch } from './mcpStdioLaunch'
import { mcpTransportKind } from './mcpTransportKind'
import type { McpOAuthClientProvider } from './oauth/provider'

type CreateTransportInput = {
  sdk: McpClientSdk
  server: McpServer
  args: string[]
  /** Transport to use instead of `server.type`, set while retrying the other candidate. */
  typeOverride?: McpServerType
  authProvider: McpOAuthClientProvider
  logger: LoggerService
  onServerLog: (entry: McpServerLogEntry) => void
}

function fetchViaNet(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  return net.fetch(typeof url === 'string' ? url : url.toString(), init)
}

/**
 * Later sources win, matching header names case-insensitively so a user-entered
 * `authorization` replaces an earlier `Authorization` instead of being sent beside it.
 * The name each source spelled is kept — servers do read headers case-sensitively.
 */
function mergeHeaders(...sources: Array<Record<string, string> | undefined>): Record<string, string> {
  const headers: Record<string, string> = {}
  const nameByLowercase = new Map<string, string>()

  for (const source of sources) {
    for (const [name, value] of Object.entries(source ?? {})) {
      const previousName = nameByLowercase.get(name.toLowerCase())
      if (previousName !== undefined) delete headers[previousName]
      nameByLowercase.set(name.toLowerCase(), name)
      headers[name] = value
    }
  }
  return headers
}

function buildHttpHeaders(server: McpServer): Record<string, string> {
  return mergeHeaders(defaultAppHeaders(), server.headers, getBuiltinHttpHeaders(server))
}

function hasAuthorization(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((name) => name.toLowerCase() === 'authorization')
}

export function isMcpOAuthEnabled(server: McpServer): boolean {
  const type = server.type ?? 'sse'
  return (
    Boolean(server.baseUrl) &&
    (type === 'sse' || type === 'streamableHttp') &&
    !hasAuthorization(buildHttpHeaders(server))
  )
}

function buildHttpOptions(server: McpServer, authProvider: McpOAuthClientProvider) {
  const headers = buildHttpHeaders(server)
  const authenticated = hasAuthorization(headers)
  return {
    requestInit: { headers },
    // A server that already authenticates with its own credential must not be sent through
    // the OAuth provider — a cached OAuth token would be combined with the static one, and
    // without a token a 401 would start a discovery flow instead of surfacing the failure.
    ...(authenticated ? {} : { authProvider })
  }
}

function getStdioTransportErrorDetails(error: Error): Record<string, number | string> {
  const spawnError = error as NodeJS.ErrnoException
  return Object.fromEntries(
    Object.entries({
      code: spawnError.code,
      errno: spawnError.errno,
      syscall: spawnError.syscall,
      path: spawnError.path
    }).filter((entry): entry is [string, number | string] => entry[1] !== undefined)
  )
}

function formatStdioTransportError(error: Error, details: Record<string, number | string>): string {
  const diagnostic = Object.entries(details)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ')
  return diagnostic ? `${error.message} (${diagnostic})` : error.message
}

async function createInMemory({ sdk, server, args, logger }: CreateTransportInput): Promise<McpTransport> {
  logger.debug(`Using in-memory transport`)
  const [clientTransport, serverTransport] = sdk.InMemoryTransport.createLinkedPair()
  const inMemoryServer = await createInMemoryMcpServer(server.name, args, server.env || {})
  try {
    await inMemoryServer.connect(serverTransport)
    logger.debug(`In-memory server started`)
  } catch (error: any) {
    logger.error(`Error starting in-memory server`, error as Error)
    throw new Error(`Failed to start in-memory server: ${error.message}`)
  }
  return clientTransport
}

function createUrlTransport(
  { sdk, server, typeOverride, authProvider, logger }: CreateTransportInput,
  baseUrl: string
): McpTransport {
  const urlBasedType: McpServerType = typeOverride ?? server.type ?? 'sse'

  if (urlBasedType === 'streamableHttp') {
    const options: StreamableHTTPClientTransportOptions = {
      fetch: fetchViaNet,
      ...buildHttpOptions(server, authProvider)
    }
    // redact headers before logging
    logger.debug(`StreamableHTTPClientTransport options`, { options: redactDeep(options) })
    return new sdk.StreamableHTTPClientTransport(new URL(baseUrl), options)
  }

  if (urlBasedType === 'sse') {
    const options: SSEClientTransportOptions = {
      eventSourceInit: { fetch: fetchViaNet },
      ...buildHttpOptions(server, authProvider)
    }
    return new sdk.SSEClientTransport(new URL(baseUrl), options)
  }

  throw new Error('Invalid server type')
}

async function createStdio(
  { sdk, server, args, logger, onServerLog }: CreateTransportInput,
  configuredCommand: string
): Promise<McpTransport> {
  const { launch, loginShellEnv, serverEnv } = await resolveStdioLaunch({
    server: { ...server, command: configuredCommand },
    args,
    logger
  })
  if (launch.unavailableReason) throw new Error(launch.unavailableReason)
  if (launch.resolution === 'unresolved')
    logger.warn('Could not resolve the stdio command; attempting the configured command', { command: launch.command })
  Object.assign(serverEnv, launch.env, getBuiltinRegistryEnv(server))

  logger.debug(`Starting server`, { command: launch.command, args: launch.args })

  // Bun not support proxy https://github.com/oven-sh/bun/issues/16812
  if (launch.command.includes('bun')) {
    removeEnvProxy(loginShellEnv)
  }

  const transportOptions: StdioServerParameters = {
    command: launch.command,
    args: launch.args,
    // On Windows the SDK prepends process.env.PATH before this object, so use
    // one canonical key to ensure our fresh shell PATH replaces the stale value.
    env: buildStdioEnvironment(loginShellEnv, serverEnv),
    stderr: 'pipe'
  }

  if (server.dxtPath) {
    transportOptions.cwd = server.dxtPath
    logger.debug(`Setting working directory for package server`, { cwd: server.dxtPath })
  }

  const transport = new sdk.StdioClientTransport(transportOptions)
  transport.onerror = (error) => {
    const details = getStdioTransportErrorDetails(error)
    logger.error(`Stdio transport error`, error, details)
    onServerLog({
      timestamp: Date.now(),
      level: 'error',
      message: formatStdioTransportError(error, details),
      data: details,
      source: 'stdio'
    })
  }
  const stderrDecoder = new TextDecoder('utf-8', { fatal: false })
  const emitStderr = (message: string) => {
    if (!message.trim()) return
    logger.debug(`Stdio stderr`, { data: message })
    onServerLog({ timestamp: Date.now(), level: 'stderr', message: message.trim(), source: 'stdio' })
  }
  transport.stderr?.on('data', (data: Buffer) => emitStderr(stderrDecoder.decode(data, { stream: true })))
  transport.stderr?.on('end', () => emitStderr(stderrDecoder.decode()))
  // StdioClientTransport does not expose stdout as a readable stream for raw logging
  // (stdout is reserved for JSON-RPC). Avoid attaching a listener that would never fire.
  return transport
}

/** Creates the client transport a connection config asks for: in-memory, HTTP/SSE, or a child process. */
export async function createTransport(input: CreateTransportInput): Promise<McpTransport> {
  const { server } = input
  const kind = mcpTransportKind(server)

  // An `inMemory` row we cannot start in-process still describes how to reach the server —
  // legacy rows kept that type alongside a command — so fall through to what it declares.
  if (kind === 'inMemory') {
    return createInMemory(input)
  }
  if (kind === 'url') {
    return createUrlTransport(input, server.baseUrl!)
  }
  if (kind === 'stdio') {
    return createStdio(input, server.command!)
  }
  if (server.type === 'inMemory') {
    throw new Error(`Unknown in-memory MCP server: ${server.name}`)
  }
  throw new Error('Either baseUrl or command must be provided')
}
