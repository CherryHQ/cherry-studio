import { EventEmitter } from 'events'
import { AsyncLocalStorage } from 'node:async_hooks'

import {
  SdkError,
  SdkErrorCode,
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
import { defaultAppHeaders, mergeHeaders } from '@main/utils/http'
import { removeEnvProxy } from '@main/utils/processRunner'
import type { McpServer, McpServerType } from '@shared/data/types/mcpServer'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'

import { McpConfigurationError, normalizeMcpTransportError } from '../failureFacts'
import { buildStdioEnvironment } from '../mcpLaunch'
import { resolveStdioLaunch } from '../mcpStdioLaunch'
import { CallBackServer } from '../oauth/callback'
import {
  McpAuthorizationCompleted,
  McpOAuthCoordinator,
  type McpAuthorizationLease
} from '../oauth/McpOAuthCoordinator'
import { McpOAuthClientProvider } from '../oauth/provider'
import { oauthServerUrlHash } from '../oauth/storage'
import { getBuiltinAutoInstallEnv } from '../servers/factory'
import { ClientMcpConnection } from './ClientMcpConnection'
import type { McpConnection, McpConnectionEvents } from './McpConnection'

type UrlTransport = SSEClientTransport | StreamableHTTPClientTransport

export interface ExternalMcpConnectionLog {
  info(message: string, data?: unknown): void
  warn(message: string, data?: unknown): void
  stdio(message: string): void
}

function transportCandidates(server: McpServer): McpServerType[] | null {
  if (!server.baseUrl) return null
  if (server.type === 'sse') return ['sse', 'streamableHttp']
  if (server.type === 'streamableHttp') return ['streamableHttp', 'sse']
  return null
}

/**
 * QVeris prefers OAuth sign-in; its static Bearer header (from QVERIS_API_KEY) is only a
 * fallback credential, so the OAuth provider stays attached and a cached token overrides it.
 */
function prefersOAuth(server: Pick<McpServer, 'installSource' | 'name' | 'headers'>): boolean {
  if (server.installSource === 'builtin' && server.name === BuiltinMcpServerNames.qveris) return true
  // `headers` reaches here unnormalized, so match Authorization case-insensitively.
  return !Object.keys(server.headers ?? {}).some((key) => key.toLowerCase() === 'authorization')
}

function isTransportFallbackError(error: unknown): boolean {
  if (error instanceof SseError) return error.code === 405
  if (error instanceof SdkHttpError) return error.status === 404 || error.status === 405
  return false
}

// A probe failure without HTTP status also suggests a server predating server/discover.
// The retry is single-shot and rethrows the original probe error if it fails.
function isLegacyProbeRejection(error: unknown): error is SdkError {
  if (!SdkError.isInstance(error) || error.code !== SdkErrorCode.EraNegotiationFailed) return false
  return SdkHttpError.isInstance(error) ? error.status >= 500 : true
}

function createClient(
  appVersion: string,
  events: McpConnectionEvents,
  versionMode: 'auto' | 'legacy' = 'auto'
): ClientMcpConnection {
  return new ClientMcpConnection(
    { name: 'Cherry Studio', version: appVersion },
    {
      capabilities: {
        elicitation: { form: {}, url: {} },
        sampling: {},
        roots: {}
      },
      versionNegotiation:
        versionMode === 'auto' ? { mode: 'auto', probe: { timeoutMs: 10_000, maxRetries: 0 } } : { mode: 'legacy' }
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
  onAuthorizationStarted,
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
  onAuthorizationStarted?: () => void
  signal?: AbortSignal
}): Promise<McpConnection> {
  const authProvider = new McpOAuthClientProvider({
    serverUrlHash: oauthServerUrlHash(server.baseUrl || '')
  })
  const headers = mergeHeaders(defaultAppHeaders(), server.headers)
  const useOAuth = prefersOAuth(server)
  const fallbackAuthorization = useOAuth ? headers.authorization : undefined
  // Keep fallback Bearer out of `requestInit.headers` so the SDK's OAuth `/token` requests stay public-client.
  const requestHeaders = useOAuth
    ? Object.fromEntries(Object.entries(headers).filter(([key]) => key !== 'authorization'))
    : headers
  const args = [...(server.args || [])]
  const lifetime = new AbortController()
  type AuthOperation = { signal: AbortSignal; lease?: McpAuthorizationLease }
  const authOperations = new AsyncLocalStorage<AuthOperation>()
  const initialAuthorization: AuthOperation = {
    signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(connectTimeoutMs), ...(signal ? [signal] : [])])
  }
  let connecting = true
  let connected = false
  let authorizationAttempted = false
  let activeConnection: ClientMcpConnection | undefined
  authProvider.beginAuthorization = async () => {
    if (connecting) authorizationAttempted = true
    const operation = authOperations.getStore() ?? initialAuthorization
    const windowId = connecting ? authorizationWindowId : activeConnection?.getInteractionContext()?.windowId
    const window = windowId ? application.get('WindowManager').getWindow(windowId) : undefined
    if (connecting ? !allowInteractiveAuthorization || (Boolean(windowId) && !window) : !window)
      throw new UnauthorizedError(t('settings.mcp.oauth.required'))
    const windowClosed = new AbortController()
    const close = () => windowClosed.abort(new Error('MCP authorization window closed'))
    window?.once('closed', close)
    try {
      operation.lease = await oauthCoordinator.begin(
        authProvider.config.serverUrlHash,
        AbortSignal.any([operation.signal, windowClosed.signal])
      )
      operation.lease.signal.addEventListener('abort', () => window?.removeListener('closed', close), { once: true })
      if (connecting) onAuthorizationStarted?.()
    } catch (error) {
      window?.removeListener('closed', close)
      throw error
    }
  }

  const createTransport = async (typeOverride?: McpServerType): Promise<Transport> => {
    if (server.baseUrl) {
      const serverUrl = new URL(server.baseUrl)
      const fetchUrl = async (input: RequestInfo | URL, init?: RequestInit) => {
        const target = input.toString()
        let requestInit = init
        if (fallbackAuthorization && target === serverUrl.href) {
          const merged = new Headers(init?.headers)
          if (!merged.has('authorization')) {
            merged.set('authorization', fallbackAuthorization)
            requestInit = { ...init, headers: merged }
          }
        }
        try {
          return await net.fetch(target, requestInit)
        } catch (error) {
          throw normalizeMcpTransportError(error)
        }
      }
      const type = typeOverride ?? server.type ?? 'sse'
      if (type === 'streamableHttp') {
        return wrapOAuthTransport(
          new StreamableHTTPClientTransport(serverUrl, {
            fetch: fetchUrl,
            requestInit: { headers: requestHeaders },
            ...(useOAuth ? { authProvider } : {})
          })
        )
      }
      if (type === 'sse') {
        return wrapOAuthTransport(
          new SSEClientTransport(serverUrl, {
            fetch: fetchUrl,
            requestInit: { headers: requestHeaders },
            ...(useOAuth ? { authProvider } : {})
          })
        )
      }
      throw new Error(`Unsupported URL transport: ${type}`)
    }

    if (!server.command) {
      throw new McpConfigurationError('Either baseUrl or command must be provided')
    }

    const { launch, loginShellEnv, serverEnv } = await resolveStdioLaunch({
      server,
      args,
      logger: loggerService.withContext('ExternalMcpConnection', { serverId: server.id })
    })
    if (launch.unavailableReason) throw new McpConfigurationError(launch.unavailableReason)
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
    const server = (callbackServer ??= new CallBackServer({
      port: authProvider.config.callbackPort,
      path: authProvider.config.callbackPath,
      events: new EventEmitter()
    }))
    try {
      await server.getServer
    } catch (error) {
      if (callbackServer === server) callbackServer = undefined
      await server.close().catch(() => undefined)
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

  const releasePendingAuthorization = async (operation: AuthOperation, reason: unknown): Promise<void> => {
    const callback = callbackServer
    callbackServer = undefined
    await callback?.close().catch(() => undefined)
    if (operation.lease) {
      const lease = operation.lease
      operation.lease = undefined
      lease.finish(reason)
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
                await releasePendingAuthorization(operation, error)
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
      await callbackServer?.close().catch(() => undefined)
      callbackServer = undefined
    })
    return connection
  }

  const isUrlTransport = (transport: Transport): transport is UrlTransport =>
    transport instanceof SSEClientTransport || transport instanceof StreamableHTTPClientTransport

  const connectWithOAuth = async (
    candidate: McpServerType | undefined,
    versionMode: 'auto' | 'legacy'
  ): Promise<{ connection: ClientMcpConnection; authenticated: boolean }> => {
    let connection = createClient(appVersion, events, versionMode)
    activeConnection = connection
    let transport = await createTransport(candidate)
    try {
      await authProvider.withAuthorizationFlow(() =>
        connection.connect(transport, { timeout: connectTimeoutMs, signal: initialAuthorization.signal })
      )
      return { connection, authenticated: false }
    } catch (error) {
      if (
        isUrlTransport(transport) &&
        ((callbackServer && UnauthorizedError.isInstance(error)) || error instanceof McpAuthorizationCompleted)
      ) {
        try {
          if (error instanceof McpAuthorizationCompleted) authProvider.reloadCredentials()
          else await authenticate(transport, initialAuthorization)
          await connection.close().catch(() => undefined)
          connection = createClient(appVersion, events, versionMode)
          activeConnection = connection
          transport = await createTransport(candidate)
          await authProvider.withAuthorizationFlow(() =>
            connection.connect(transport, { timeout: connectTimeoutMs, signal: initialAuthorization.signal })
          )
          return { connection, authenticated: true }
        } catch (oauthError) {
          await connection.close().catch(() => undefined)
          throw oauthError
        }
      }
      await connection.close().catch(() => undefined)
      throw error
    }
  }

  try {
    const candidates = transportCandidates(server) ?? [undefined]
    let lastError: unknown

    for (const candidate of candidates) {
      try {
        const { connection, authenticated } = await connectWithOAuth(candidate, 'auto')
        if (authenticated) log.info('Server authenticated', { era: connection.era })
        else log.info('Server connected', { era: connection.era, serverVersion: connection.serverVersion })
        return finishConnection(connection)
      } catch (error) {
        lastError = error
        await releasePendingAuthorization(initialAuthorization, error)

        if (isLegacyProbeRejection(error) && !initialAuthorization.signal.aborted && Boolean(server.baseUrl)) {
          log.warn('Server rejected probe; retrying in legacy mode', {
            status: SdkHttpError.isInstance(error) ? error.status : undefined,
            message: error.message
          })
          authorizationAttempted = false
          try {
            const { connection, authenticated } = await connectWithOAuth(candidate, 'legacy')
            if (authenticated) log.info('Server authenticated', { era: connection.era })
            else log.info('Server connected', { era: connection.era, serverVersion: connection.serverVersion })
            return finishConnection(connection)
          } catch (legacyError) {
            await releasePendingAuthorization(initialAuthorization, legacyError)
            if (
              authorizationAttempted ||
              UnauthorizedError.isInstance(legacyError) ||
              legacyError instanceof McpAuthorizationCompleted
            ) {
              throw legacyError
            }
            log.warn('Legacy retry failed', legacyError)
            throw error
          }
        }
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
      await releasePendingAuthorization(initialAuthorization, new Error('MCP connection authorization failed'))
      authProvider.prepareAuthorization = undefined
      authProvider.beginAuthorization = undefined
    }
  }
}

export const externalMcpConnectionInternals = {
  isLegacyProbeRejection,
  isTransportFallbackError,
  transportCandidates,
  prefersOAuth
}
