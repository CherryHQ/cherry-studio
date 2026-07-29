import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { getBinaryPath, isBinaryExists } from '@main/utils/binaryResolver'
import { findCommandInShellEnv } from '@main/utils/commandResolver'
import { defaultAppHeaders } from '@main/utils/http'
import { removeEnvProxy } from '@main/utils/processRunner'
import { getShellEnv } from '@main/utils/shellEnv'
import {
  SdkHttpError,
  SSEClientTransport,
  SseError,
  StreamableHTTPClientTransport,
  type Transport,
  UnauthorizedError
} from '@modelcontextprotocol/client'
import { StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/client/stdio'
import type { McpServer, McpServerType } from '@shared/data/types/mcpServer'
import { net } from 'electron'
import { EventEmitter } from 'events'

import type { McpPackageService } from '../McpPackageService'
import { CallBackServer } from '../oauth/callback'
import { McpOAuthClientProvider } from '../oauth/provider'
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
  packageService,
  events,
  log,
  connectTimeoutMs
}: {
  server: McpServer
  appVersion: string
  packageService: McpPackageService
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
  const headers = () => ({ ...defaultAppHeaders(), ...server.headers })
  let args = [...(server.args || [])]

  const createTransport = async (typeOverride?: McpServerType): Promise<Transport> => {
    if (server.baseUrl) {
      const type = typeOverride ?? server.type ?? 'sse'
      if (type === 'streamableHttp') {
        return new StreamableHTTPClientTransport(new URL(server.baseUrl), {
          fetch: (input, init) => net.fetch(input.toString(), init),
          requestInit: { headers: headers() },
          authProvider
        })
      }
      if (type === 'sse') {
        return new SSEClientTransport(new URL(server.baseUrl), {
          fetch: (input, init) => net.fetch(input.toString(), init),
          requestInit: { headers: headers() },
          authProvider
        })
      }
      throw new Error(`Unsupported URL transport: ${type}`)
    }

    if (!server.command) {
      throw new Error('Either baseUrl or command must be provided')
    }

    let command = server.command
    let effectiveCommand = server.command
    const connectEnv: Record<string, string> = { ...server.env }
    const loginShellEnv = await getShellEnv()

    if (server.dxtPath) {
      const resolvedConfig = packageService.getResolvedMcpConfig(server.dxtPath)
      if (resolvedConfig) {
        command = resolvedConfig.command
        effectiveCommand = resolvedConfig.command
        args = [...resolvedConfig.args]
        Object.assign(connectEnv, resolvedConfig.env)
      } else {
        log.warn('Failed to resolve package config; using manifest values')
      }
    }

    if (effectiveCommand === 'npx') {
      command = (await findCommandInShellEnv('npx', loginShellEnv)) ?? ''
      if (!command) {
        if (!(await isBinaryExists('bun'))) {
          throw new Error('npx is not available and the bundled bun fallback is missing')
        }
        command = await getBinaryPath('bun')
        if (!args.includes('-y')) args.unshift('-y')
        if (!args.includes('x')) args.unshift('x')
      }
      if (server.registryUrl) {
        connectEnv.NPM_CONFIG_REGISTRY = server.registryUrl
        if (server.name.includes('mcp-auto-install')) {
          const binaryPath = await getBinaryPath()
          await fs.mkdir(binaryPath, { recursive: true })
          connectEnv.MCP_REGISTRY_PATH = path.join(binaryPath, '..', 'config', 'mcp-registry.json')
        }
      }
    } else if (effectiveCommand === 'uvx' || effectiveCommand === 'uv') {
      command = (await findCommandInShellEnv(effectiveCommand, loginShellEnv)) ?? ''
      if (!command) {
        if (!(await isBinaryExists(effectiveCommand))) {
          throw new Error(`${effectiveCommand} is not available and the bundled fallback is missing`)
        }
        command = await getBinaryPath(effectiveCommand)
      }
      if (server.registryUrl) {
        connectEnv.UV_DEFAULT_INDEX = server.registryUrl
        connectEnv.PIP_INDEX_URL = server.registryUrl
      }
    }

    if (command.includes('bun')) removeEnvProxy(loginShellEnv)

    const parameters: StdioServerParameters = {
      command,
      args,
      env: { ...loginShellEnv, ...connectEnv },
      stderr: 'pipe',
      ...(server.dxtPath ? { cwd: server.dxtPath } : {})
    }
    const transport = new StdioClientTransport(parameters)
    transport.stderr?.on('data', (data) => log.stdio(data.toString().trim()))
    return transport
  }

  const authenticate = async (transport: UrlTransport): Promise<void> => {
    const callbackEvents = new EventEmitter()
    const callbackServer = new CallBackServer({
      port: authProvider.config.callbackPort,
      path: authProvider.config.callbackPath,
      events: callbackEvents
    })
    try {
      const callback = await callbackServer.waitForAuthCallback()
      await authProvider.validateCallbackState(callback)
      await transport.finishAuth(callback)
    } finally {
      await callbackServer.close()
    }
  }

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
}

export const externalMcpConnectionInternals = {
  isTransportFallbackError,
  transportCandidates
}
