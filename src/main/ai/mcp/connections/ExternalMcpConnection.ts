import { EventEmitter } from 'events'
import { AsyncLocalStorage } from 'node:async_hooks'
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

import { application } from '@application'
import { loggerService } from '@logger'
import { t } from '@main/i18n'
import { defaultAppHeaders } from '@main/utils/http'
import { removeEnvProxy } from '@main/utils/processRunner'
import type { McpServer, McpServerType } from '@shared/data/types/mcpServer'

import { buildStdioEnvironment } from '../mcpLaunch'
import { resolveStdioLaunch } from '../mcpStdioLaunch'
import { CallBackServer } from '../oauth/callback'
import {
  McpAuthorizationCompleted,
  McpOAuthCoordinator,
  type McpAuthorizationLease
} from '../oauth/McpOAuthCoordinator'
import { McpOAuthClientProvider } from '../oauth/provider'
import { getBuiltinAutoInstallEnv } from '../servers/factory'
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
  connectTimeoutMs,
  oauthCoordinator = new McpOAuthCoordinator(),
  allowInteractiveAuthorization = true,
  authorizationWindowId,
  signal
}: {
  server: McpServer
  appVersion: string
  events: McpConnectionEvents
  log: ExternalMcpConnectionLog
  connectTimeoutMs: number
  oauthCoordinator?: McpOAuthCoordinator
  allowInteractiveAuthorization?: boolean
  authorizationWindowId?: string
  signal?: AbortSignal
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
  const lifetime = new AbortController()
  type AuthOperation = { signal: AbortSignal; lease?: McpAuthorizationLease }
  const authOperations = new AsyncLocalStorage<AuthOperation>()
  const initialAuthorization: AuthOperation = {
    signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(connectTimeoutMs), ...(signal ? [signal] : [])])
  }
  let connecting = true
  let connected = false
  let activeConnection: ClientMcpConnection | undefined
  authProvider.beginAuthorization = async () => {
    const operation = authOperations.getStore() ?? initialAuthorization
    const windowId = connecting ? authorizationWindowId : activeConnection?.getInteractionContext()?.windowId
    const window = windowId ? application.get('WindowManager').getWindow(windowId) : undefined
    if (connecting ? !allowInteractiveAuthorization || (Boolean(windowId) && !window) : !window)
      throw new UnauthorizedError('MCP authorization requires an interactive request')
    const windowClosed = new AbortController()
    const close = () => windowClosed.abort(new Error('MCP authorization window closed'))
    window?.once('closed', close)
    try {
      operation.lease = await oauthCoordinator.begin(
        authProvider.config.serverUrlHash,
        AbortSignal.any([operation.signal, windowClosed.signal])
      )
      operation.lease.signal.addEventListener('abort', () => window?.removeListener('closed', close), { once: true })
    } catch (error) {
      window?.removeListener('closed', close)
      throw error
    }
  }

  const createTransport = async (typeOverride?: McpServerType): Promise<Transport> => {
    if (server.baseUrl) {
      const type = typeOverride ?? server.type ?? 'sse'
      if (type === 'streamableHttp') {
        return wrapOAuthTransport(
          new StreamableHTTPClientTransport(new URL(server.baseUrl), {
            fetch: (input, init) => net.fetch(input.toString(), init),
            requestInit: { headers },
            ...(useOAuth ? { authProvider } : {})
          })
        )
      }
      if (type === 'sse') {
        return wrapOAuthTransport(
          new SSEClientTransport(new URL(server.baseUrl), {
            fetch: (input, init) => net.fetch(input.toString(), init),
            requestInit: { headers },
            ...(useOAuth ? { authProvider } : {})
          })
        )
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
    Object.assign(serverEnv, launch.env, getBuiltinAutoInstallEnv(server))
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

  const authenticate = async (transport: UrlTransport, operation: AuthOperation): Promise<void> => {
    const callback = callbackServer
    const lease = operation.lease
    if (!callback || !lease) throw new UnauthorizedError()
    try {
      const params = await callback.waitForAuthCallback(300_000, lease.signal)
      await authProvider.validateCallbackState(params)
      lease.signal.throwIfAborted()
      await authProvider.withAuthorizationCallback(() => transport.finishAuth(params))
      await callback.close()
      callbackServer = undefined
      lease.finish()
    } catch (error) {
      await callback.close().catch(() => undefined)
      callbackServer = undefined
      lease.finish(error)
      throw error
    } finally {
      operation.lease = undefined
    }
  }

  function wrapOAuthTransport<T extends UrlTransport>(transport: T): T {
    if (!useOAuth) return transport
    const wire: Transport = transport
    const send = wire.send.bind(wire)
    wire.send = (message, options) => {
      if (connecting) return send(message, options)
      const operation: AuthOperation = {
        signal: AbortSignal.any([lifetime.signal, ...(options?.requestSignal ? [options.requestSignal] : [])])
      }
      return authOperations.run(operation, () =>
        authProvider.withAuthorizationFlow(async () => {
          for (let attempt = 0; ; attempt++) {
            operation.signal.throwIfAborted()
            try {
              return await send(message, options)
            } catch (error) {
              // These errors arise from a rejected HTTP auth challenge, before the tool was accepted.
              if (attempt < 2 && error instanceof McpAuthorizationCompleted) {
                authProvider.reloadCredentials()
                continue
              }
              if (attempt < 2 && UnauthorizedError.isInstance(error) && operation.lease) {
                await authenticate(transport, operation)
                continue
              }
              if (operation.lease) {
                await callbackServer?.close().catch(() => undefined)
                callbackServer = undefined
                operation.lease.finish(error)
                operation.lease = undefined
              }
              throw error
            }
          }
        })
      )
    }
    return transport
  }

  const finishConnection = (connection: ClientMcpConnection): McpConnection => {
    connected = true
    connecting = false
    activeConnection = connection
    connection.addCloseHook(async () => {
      lifetime.abort()
      authProvider.prepareAuthorization = undefined
      authProvider.beginAuthorization = undefined
      await callbackServer?.close()
    })
    return connection
  }

  try {
    const candidates = transportCandidates(server) ?? [undefined]
    let lastError: unknown

    for (const candidate of candidates) {
      let connection = createClient(appVersion, events)
      activeConnection = connection
      let transport = await createTransport(candidate)
      try {
        await authProvider.withAuthorizationFlow(() =>
          connection.connect(transport, { timeout: connectTimeoutMs, signal: initialAuthorization.signal })
        )
        log.info('Server connected', { era: connection.era, serverVersion: connection.serverVersion })
        return finishConnection(connection)
      } catch (error) {
        lastError = error

        if (
          (transport instanceof SSEClientTransport || transport instanceof StreamableHTTPClientTransport) &&
          ((callbackServer && UnauthorizedError.isInstance(error)) || error instanceof McpAuthorizationCompleted)
        ) {
          try {
            if (error instanceof McpAuthorizationCompleted) authProvider.reloadCredentials()
            else await authenticate(transport, initialAuthorization)
            await connection.close().catch(() => undefined)
            connection = createClient(appVersion, events)
            activeConnection = connection
            transport = await createTransport(candidate)
            await authProvider.withAuthorizationFlow(() =>
              connection.connect(transport, { timeout: connectTimeoutMs, signal: initialAuthorization.signal })
            )
            log.info('Server authenticated', { era: connection.era })
            return finishConnection(connection)
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
    if (!connected) {
      lifetime.abort()
      initialAuthorization.lease?.finish(new Error('MCP connection authorization failed'))
      authProvider.prepareAuthorization = undefined
      authProvider.beginAuthorization = undefined
      await callbackServer?.close()
    }
  }
}

export const externalMcpConnectionInternals = {
  isTransportFallbackError,
  transportCandidates
}
