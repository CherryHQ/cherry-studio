import { application } from '@application'
import type { LoggerService } from '@logger'
import {
  createInMemoryMcpServer,
  getBuiltinHttpHeaders,
  getBuiltinRegistryEnv,
  hasInMemoryImplementation
} from '@main/ai/mcp/servers/factory'
import { defaultAppHeaders } from '@main/utils/http'
import { removeEnvProxy } from '@main/utils/processRunner'
import { getShellEnv } from '@main/utils/shellEnv'
import type { SSEClientTransportOptions } from '@modelcontextprotocol/sdk/client/sse.js'
import type { StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { StreamableHTTPClientTransportOptions } from '@modelcontextprotocol/sdk/client/streamableHttp'
import type { McpServer, McpServerType } from '@shared/data/types/mcpServer'
import type { McpServerLogEntry } from '@shared/types/mcp'
import { redactDeep } from '@shared/utils/redaction'
import { net } from 'electron'

import type { McpClientSdk, McpTransport } from './mcpClientSdk'
import { buildStdioEnvironment, resolveLaunchCommand, validateLaunchCommand } from './mcpLaunch'
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
  onTransportError?: (error: Error, details: Record<string, number | string>) => void
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
    throw Object.assign(new Error(`Failed to start in-memory server: ${error.message}`), {
      code: error.code,
      path: error.path
    })
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
  { sdk, server, args, logger, onServerLog, onTransportError }: CreateTransportInput,
  configuredCommand: string
): Promise<McpTransport> {
  let command = configuredCommand
  let launchArgs = args

  // Build a local env for the transport instead of mutating `server.env`. getServerKey(server)
  // serializes server.env, so mutating it here would shift the key after connect — connect-time
  // logs (emitServerLog) and list-changed cache invalidations would then land under a key that
  // getServerLogs / the caches (which see the un-mutated server) never query. Keep server.env
  // untouched so the key stays stable everywhere; see the "deep-copy don't mutate" pattern.
  const connectEnv: Record<string, string> = { ...server.env }

  // For package servers, use resolved configuration with platform overrides and variable substitution
  if (server.dxtPath) {
    const resolvedConfig = application.get('McpPackageService').getResolvedMcpConfig(server.dxtPath)
    if (resolvedConfig) {
      command = resolvedConfig.command
      launchArgs = resolvedConfig.args
      Object.assign(connectEnv, resolvedConfig.env)
      logger.debug(`Using resolved package config`, { command, args: launchArgs })
    } else {
      logger.warn(`Failed to resolve package config, falling back to manifest values`)
    }
  }

  command = validateLaunchCommand(command)

  // Note: getShellEnv() is memoized, so subsequent calls are fast
  const loginShellEnv = await getShellEnv()

  const launch = await resolveLaunchCommand({
    command,
    args: launchArgs,
    registryUrl: server.registryUrl,
    loginShellEnv,
    logger
  })
  Object.assign(connectEnv, launch.env, getBuiltinRegistryEnv(server))

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
    env: buildStdioEnvironment(loginShellEnv, connectEnv),
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
    onTransportError?.(error, details)
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

  // An `inMemory` row we cannot start in-process still describes how to reach the server —
  // legacy rows kept that type alongside a command — so fall through to what it declares.
  if (server.type === 'inMemory' && hasInMemoryImplementation(server.name)) {
    return createInMemory(input)
  }
  if (server.baseUrl) {
    return createUrlTransport(input, server.baseUrl)
  }
  if (server.command) {
    return createStdio(input, server.command)
  }
  if (server.type === 'inMemory') {
    throw new Error(`Unknown in-memory MCP server: ${server.name}`)
  }
  throw new Error('Either baseUrl or command must be provided')
}
