import { application } from '@application'
import type { LoggerService } from '@logger'
import { createInMemoryMcpServer, getBuiltinHttpHeaders, getBuiltinRegistryEnv } from '@main/ai/mcp/servers/factory'
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
import { buildStdioEnvironment, resolveLaunchCommand } from './mcpLaunch'
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

function buildHttpOptions(server: McpServer, authProvider: McpOAuthClientProvider) {
  const headers: Record<string, string> = {
    ...defaultAppHeaders(),
    ...server.headers,
    ...getBuiltinHttpHeaders(server)
  }
  return {
    requestInit: { headers },
    // A server that already authenticates with its own credential must not be sent
    // through the OAuth provider — the SDK would start a discovery flow it cannot finish.
    ...(headers.Authorization ? {} : { authProvider })
  }
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
  let command = configuredCommand
  let launchArgs = args

  // Build a local env for the transport instead of mutating `server.env`. getServerKey(server)
  // serializes server.env, so mutating it here would shift the key after connect — connect-time
  // logs (emitServerLog) and list-changed cache invalidations would then land under a key that
  // getServerLogs / the caches (which see the un-mutated server) never query. Keep server.env
  // untouched so the key stays stable everywhere; see the "deep-copy don't mutate" pattern.
  const connectEnv: Record<string, string> = { ...server.env }

  // Note: getShellEnv() is memoized, so subsequent calls are fast
  const loginShellEnv = await getShellEnv()

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

  const launch = await resolveLaunchCommand({
    command,
    args: launchArgs,
    registryUrl: server.registryUrl,
    loginShellEnv,
    logger
  })
  Object.assign(connectEnv, launch.env, await getBuiltinRegistryEnv(server))

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

  if (server.type === 'inMemory') {
    return createInMemory(input)
  }
  if (server.baseUrl) {
    return createUrlTransport(input, server.baseUrl)
  }
  if (server.command) {
    return createStdio(input, server.command)
  }
  throw new Error('Either baseUrl or command must be provided')
}
