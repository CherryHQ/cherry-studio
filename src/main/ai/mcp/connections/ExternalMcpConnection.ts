import { EventEmitter } from 'events'
import crypto from 'node:crypto'

import {
  SdkHttpError,
  SSEClientTransport,
  SseError,
  StreamableHTTPClientTransport,
  type Transport,
  UnauthorizedError
} from '@modelcontextprotocol/client'
import { StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/client/stdio'
import { net } from 'electron'

import { loggerService } from '@logger'
import { t } from '@main/i18n'
import { defaultAppHeaders } from '@main/utils/http'
import { removeEnvProxy } from '@main/utils/processRunner'
import type { McpServer, McpServerType } from '@shared/data/types/mcpServer'

import { buildStdioEnvironment } from '../mcpLaunch'
import { resolveStdioLaunch } from '../mcpStdioLaunch'
import { CallBackServer } from '../oauth/callback'
import { McpOAuthClientProvider } from '../oauth/provider'
import { getBuiltinRegistryEnv } from '../servers/factory'
import { ClientMcpConnection } from './ClientMcpConnection'
import type { McpConnection, McpConnectionEvents } from './McpConnection'

type UrlTransport = SSEClientTransport | StreamableHTTPClientTransport

export interface ExternalMcpConnectionLog {
  debug(message: string, data?: unknown): void
  info(message: string, data?: unknown): void
  warn(message: string, data?: unknown): void
  error(message: string, error?: Error): void
  stdio(message: string): void
}

function transportCandidates(server: McpServer): McpServerType[] | null {
  if (!server.baseUrl) return null
  if (server.type === 'sse') return ['sse', 'streamableHttp']
  if (server.type === 'streamableHttp') return ['streamableHttp', 'sse']
  return null
}

function isTransportFallbackError(error: unknown): boolean {
  if (error instanceof SseError) return error.code === 405
  if (error instanceof SdkHttpError) return error.status === 404 || error.status === 405
  return false
}

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

function createClient(appVersion: string, events: McpConnectionEvents): ClientMcpConnection {
  return new ClientMcpConnection(
    { name: 'Cherry Studio', version: appVersion },
    {
      capabilities: {
        elicitation: { form: {}, url: {} },
        sampling: {},
        roots: {}
      },
      versionNegotiation: {
        mode: 'auto',
        probe: { timeoutMs: 10_000, maxRetries: 0 }
      }
    },
    events
  )
}

export async function createExternalMcpConnection({
  server,
  appVersion,
  events,
  log,
  connectTimeoutMs
}: {
  server: McpServer
  appVersion: string
  events: McpConnectionEvents
  log: ExternalMcpConnectionLog
  connectTimeoutMs: number
}): Promise<McpConnection> {
  const authProvider = new McpOAuthClientProvider({
    serverUrlHash: crypto
      .createHash('md5')
      .update(server.baseUrl || '')
      .digest('hex')
  })
  const headers = mergeHeaders(defaultAppHeaders(), server.headers)
  const useOAuth = !Object.keys(headers).some((name) => name.toLowerCase() === 'authorization')
  const args = [...(server.args || [])]

  const createTransport = async (typeOverride?: McpServerType): Promise<Transport> => {
    if (server.baseUrl) {
      const type = typeOverride ?? server.type ?? 'sse'
      if (type === 'streamableHttp') {
        return new StreamableHTTPClientTransport(new URL(server.baseUrl), {
          fetch: (input, init) => net.fetch(input.toString(), init),
          requestInit: { headers },
          ...(useOAuth ? { authProvider } : {})
        })
      }
      if (type === 'sse') {
        return new SSEClientTransport(new URL(server.baseUrl), {
          fetch: (input, init) => net.fetch(input.toString(), init),
          requestInit: { headers },
          ...(useOAuth ? { authProvider } : {})
        })
      }
      throw new Error(`Unsupported URL transport: ${type}`)
    }

    if (!server.command) {
      throw new Error('Either baseUrl or command must be provided')
    }

    const { launch, loginShellEnv, serverEnv } = await resolveStdioLaunch({
      server,
      args,
      logger: loggerService.withContext('ExternalMcpConnection', { serverId: server.id })
    })
    if (launch.unavailableReason) throw new Error(launch.unavailableReason)
    if (launch.resolution === 'unresolved') {
      log.warn('Could not resolve the stdio command; attempting the configured command', { command: launch.command })
    }
    Object.assign(serverEnv, launch.env, getBuiltinRegistryEnv(server))
    if (launch.command.includes('bun')) removeEnvProxy(loginShellEnv)

    const parameters: StdioServerParameters = {
      command: launch.command,
      args: launch.args,
      env: buildStdioEnvironment(loginShellEnv, serverEnv),
      stderr: 'pipe',
      ...(server.dxtPath ? { cwd: server.dxtPath } : {})
    }
    const transport = new StdioClientTransport(parameters)
    transport.stderr?.on('data', (data) => log.stdio(data.toString().trim()))
    return transport
  }

  let callbackServer: CallBackServer | undefined
  authProvider.prepareAuthorization = async () => {
    callbackServer ??= new CallBackServer({
      port: authProvider.config.callbackPort,
      path: authProvider.config.callbackPath,
      events: new EventEmitter()
    })
    try {
      await callbackServer.getServer
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code
      throw new Error(
        t('settings.mcp.oauth.callback.listen_error', {
          port: authProvider.config.callbackPort,
          reason: code ?? (error instanceof Error ? error.message : String(error))
        }),
        { cause: error }
      )
    }
  }

  const authenticate = async (transport: UrlTransport): Promise<void> => {
    if (!callbackServer) throw new UnauthorizedError()
    const callback = await callbackServer.waitForAuthCallback()
    await authProvider.validateCallbackState(callback)
    await transport.finishAuth(callback)
  }

  try {
    const candidates = transportCandidates(server) ?? [undefined]
    let lastError: unknown

    for (const candidate of candidates) {
      let connection = createClient(appVersion, events)
      let transport = await createTransport(candidate)
      try {
        await connection.connect(transport, { timeout: connectTimeoutMs })
        log.info('Server connected', { era: connection.era, serverVersion: connection.serverVersion })
        return connection
      } catch (error) {
        lastError = error

        if (
          (transport instanceof SSEClientTransport || transport instanceof StreamableHTTPClientTransport) &&
          callbackServer &&
          UnauthorizedError.isInstance(error)
        ) {
          try {
            await authenticate(transport)
            await connection.close().catch(() => undefined)
            connection = createClient(appVersion, events)
            transport = await createTransport(candidate)
            await connection.connect(transport, { timeout: connectTimeoutMs })
            log.info('Server authenticated', { era: connection.era })
            return connection
          } catch (oauthError) {
            await connection.close().catch(() => undefined)
            throw oauthError
          }
        }

        await connection.close().catch(() => undefined)
        if (candidate && candidate !== candidates.at(-1) && isTransportFallbackError(error)) {
          log.warn('Transport mismatch; trying fallback', { candidate })
          continue
        }
        throw error
      }
    }

    throw lastError ?? new Error('Failed to connect to MCP server')
  } finally {
    authProvider.prepareAuthorization = undefined
    await callbackServer?.close()
  }
}

export const externalMcpConnectionInternals = {
  isTransportFallbackError,
  transportCandidates
}
