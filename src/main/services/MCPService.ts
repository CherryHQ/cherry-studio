import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

import { createInMemoryMCPServer } from '@main/mcpServers/factory'
import { makeSureDirExists } from '@main/utils'
import { buildFunctionCallToolName } from '@main/utils/mcp'
import { getBinaryName, getBinaryPath } from '@main/utils/process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport, SSEClientTransportOptions } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions
} from '@modelcontextprotocol/sdk/client/streamableHttp'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory'
import { nanoid } from '@reduxjs/toolkit'
import {
  GetMCPPromptResponse,
  GetResourceResponse,
  MCPCallToolResponse,
  MCPPrompt,
  MCPResource,
  MCPServer,
  MCPTool
} from '@types'
import { app } from 'electron'
import Logger from 'electron-log'
import { EventEmitter } from 'events'
import { memoize } from 'lodash'
import { v4 as uuidv4 } from 'uuid'

import { CacheService } from './CacheService'
import DxtService from './DxtService'
import { CallBackServer } from './mcp/oauth/callback'
import { McpOAuthClientProvider } from './mcp/oauth/provider'
import getLoginShellEnvironment from './mcp/shell-env'

// Generic type for caching wrapped functions
type CachedFunction<T extends unknown[], R> = (...args: T) => Promise<R>

/**
 * Higher-order function to add caching capability to any async function
 * @param fn The original function to be wrapped with caching
 * @param getCacheKey Function to generate a cache key from the function arguments
 * @param ttl Time to live for the cache entry in milliseconds
 * @param logPrefix Prefix for log messages
 * @returns The wrapped function with caching capability
 */
function withCache<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  getCacheKey: (...args: T) => string,
  ttl: number,
  logPrefix: string
): CachedFunction<T, R> {
  return async (...args: T): Promise<R> => {
    const cacheKey = getCacheKey(...args)

    if (CacheService.has(cacheKey)) {
      Logger.info(`${logPrefix} loaded from cache`)
      const cachedData = CacheService.get<R>(cacheKey)
      if (cachedData) {
        return cachedData
      }
    }

    const result = await fn(...args)
    CacheService.set(cacheKey, result, ttl)
    return result
  }
}

class McpService {
  private clients: Map<string, Client> = new Map()
  private pendingClients: Map<string, Promise<Client>> = new Map()
  private dxtService = new DxtService()
  private activeToolCalls: Map<string, AbortController> = new Map()

  constructor() {
    this.initClient = this.initClient.bind(this)
    this.listTools = this.listTools.bind(this)
    this.callTool = this.callTool.bind(this)
    this.listPrompts = this.listPrompts.bind(this)
    this.getPrompt = this.getPrompt.bind(this)
    this.listResources = this.listResources.bind(this)
    this.getResource = this.getResource.bind(this)
    this.closeClient = this.closeClient.bind(this)
    this.removeServer = this.removeServer.bind(this)
    this.restartServer = this.restartServer.bind(this)
    this.stopServer = this.stopServer.bind(this)
    this.abortTool = this.abortTool.bind(this)
    this.cleanup = this.cleanup.bind(this)
    this.checkMcpConnectivity = this.checkMcpConnectivity.bind(this)
    this.getServerVersion = this.getServerVersion.bind(this)
  }

  private getServerKey(server: MCPServer): string {
    return JSON.stringify({
      baseUrl: server.baseUrl,
      command: server.command,
      args: Array.isArray(server.args) ? server.args : [],
      registryUrl: server.registryUrl,
      env: server.env,
      id: server.id
    })
  }

  async initClient(server: MCPServer): Promise<Client> {
    const serverKey = this.getServerKey(server)

    // If there's a pending initialization, wait for it
    const pendingClient = this.pendingClients.get(serverKey)
    if (pendingClient) {
      return pendingClient
    }

    // Check if we already have a client for this server configuration
    const existingClient = this.clients.get(serverKey)
    if (existingClient) {
      try {
        // Check if the existing client is still connected
        const pingResult = await existingClient.ping()
        Logger.info(`[MCP] Ping result for ${server.name}:`, pingResult)
        // If the ping fails, remove the client from the cache
        // and create a new one
        if (!pingResult) {
          this.clients.delete(serverKey)
        } else {
          return existingClient
        }
      } catch (error: any) {
        Logger.error(`[MCP] Error pinging server ${server.name}:`, error?.message)
        this.clients.delete(serverKey)
      }
    }

    // Create a promise for the initialization process
    const initPromise = (async () => {
      try {
        // Create new client instance for each connection
        const client = new Client({ name: 'Cherry Studio', version: app.getVersion() }, { capabilities: {} })

        let args = [...(server.args || [])]

        // let transport: StdioClientTransport | SSEClientTransport | InMemoryTransport | StreamableHTTPClientTransport
        const authProvider = new McpOAuthClientProvider({
          serverUrlHash: crypto
            .createHash('md5')
            .update(server.baseUrl || '')
            .digest('hex')
        })

        const initTransport = async (): Promise<
          StdioClientTransport | SSEClientTransport | InMemoryTransport | StreamableHTTPClientTransport
        > => {
          // Create appropriate transport based on configuration
          if (server.type === 'inMemory') {
            Logger.info(`[MCP] Using in-memory transport for server: ${server.name}`)
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
            // start the in-memory server with the given name and environment variables
            const inMemoryServer = createInMemoryMCPServer(server.name, args, server.env || {})
            try {
              await inMemoryServer.connect(serverTransport)
              Logger.info(`[MCP] In-memory server started: ${server.name}`)
            } catch (error: Error | any) {
              Logger.error(`[MCP] Error starting in-memory server: ${error}`)
              throw new Error(`Failed to start in-memory server: ${error.message}`)
            }
            // set the client transport to the client
            return clientTransport
          } else if (server.baseUrl) {
            if (server.type === 'streamableHttp') {
              const options: StreamableHTTPClientTransportOptions = {
                requestInit: {
                  headers: server.headers || {}
                },
                authProvider
              }
              return new StreamableHTTPClientTransport(new URL(server.baseUrl!), options)
            } else if (server.type === 'sse') {
              const options: SSEClientTransportOptions = {
                eventSourceInit: {
                  fetch: async (url, init) => {
                    const headers = { ...(server.headers || {}), ...(init?.headers || {}) }

                    // Get tokens from authProvider to make sure using the latest tokens
                    if (authProvider && typeof authProvider.tokens === 'function') {
                      try {
                        const tokens = await authProvider.tokens()
                        if (tokens && tokens.access_token) {
                          headers['Authorization'] = `Bearer ${tokens.access_token}`
                        }
                      } catch (error) {
                        Logger.error('Failed to fetch tokens:', error)
                      }
                    }

                    return fetch(url, { ...init, headers })
                  }
                },
                requestInit: {
                  headers: server.headers || {}
                },
                authProvider
              }
              return new SSEClientTransport(new URL(server.baseUrl!), options)
            } else {
              throw new Error('Invalid server type')
            }
          } else if (server.command) {
            let cmd = server.command

            // For DXT servers, use resolved configuration with platform overrides and variable substitution
            if (server.dxtPath) {
              const resolvedConfig = this.dxtService.getResolvedMcpConfig(server.dxtPath)
              if (resolvedConfig) {
                cmd = resolvedConfig.command
                args = resolvedConfig.args
                // Merge resolved environment variables with existing ones
                server.env = {
                  ...server.env,
                  ...resolvedConfig.env
                }
                Logger.info(`[MCP] Using resolved DXT config - command: ${cmd}, args: ${args?.join(' ')}`)
              } else {
                Logger.warn(`[MCP] Failed to resolve DXT config for ${server.name}, falling back to manifest values`)
              }
            }

            if (server.command === 'npx') {
              cmd = await getBinaryPath('bun')
              Logger.info(`[MCP] Using command: ${cmd}`)

              // add -x to args if args exist
              if (args && args.length > 0) {
                if (!args.includes('-y')) {
                  args.unshift('-y')
                }
                if (!args.includes('x')) {
                  args.unshift('x')
                }
              }
              if (server.registryUrl) {
                server.env = {
                  ...server.env,
                  NPM_CONFIG_REGISTRY: server.registryUrl
                }

                // if the server name is mcp-auto-install, use the mcp-registry.json file in the bin directory
                if (server.name.includes('mcp-auto-install')) {
                  const binPath = await getBinaryPath()
                  makeSureDirExists(binPath)
                  server.env.MCP_REGISTRY_PATH = path.join(binPath, '..', 'config', 'mcp-registry.json')
                }
              }
            } else if (server.command === 'uvx' || server.command === 'uv') {
              cmd = await getBinaryPath(server.command)
              if (server.registryUrl) {
                server.env = {
                  ...server.env,
                  UV_DEFAULT_INDEX: server.registryUrl,
                  PIP_INDEX_URL: server.registryUrl
                }
              }
            }

            Logger.info(`[MCP] Starting server with command: ${cmd} ${args ? args.join(' ') : ''}`)
            // Logger.info(`[MCP] Environment variables for server:`, server.env)
            const loginShellEnv = await this.getLoginShellEnv()

            // Bun not support proxy https://github.com/oven-sh/bun/issues/16812
            if (cmd.includes('bun')) {
              this.removeProxyEnv(loginShellEnv)
            }

            const transportOptions: any = {
              command: cmd,
              args,
              env: {
                ...loginShellEnv,
                ...server.env
              },
              stderr: 'pipe'
            }

            // For DXT servers, set the working directory to the extracted path
            if (server.dxtPath) {
              transportOptions.cwd = server.dxtPath
              Logger.info(`[MCP] Setting working directory for DXT server: ${server.dxtPath}`)
            }

            const stdioTransport = new StdioClientTransport(transportOptions)
            stdioTransport.stderr?.on('data', (data) =>
              Logger.info(`[MCP] Stdio stderr for server: ${server.name} `, data.toString())
            )
            return stdioTransport
          } else {
            throw new Error('Either baseUrl or command must be provided')
          }
        }

        const handleAuth = async (client: Client, transport: SSEClientTransport | StreamableHTTPClientTransport) => {
          Logger.info(`[MCP] Starting OAuth flow for server: ${server.name}`)
          // Create an event emitter for the OAuth callback
          const events = new EventEmitter()

          // Create a callback server
          const callbackServer = new CallBackServer({
            port: authProvider.config.callbackPort,
            path: authProvider.config.callbackPath || '/oauth/callback',
            events
          })

          // Set a timeout to close the callback server
          const timeoutId = setTimeout(() => {
            Logger.warn(`[MCP] OAuth flow timed out for server: ${server.name}`)
            callbackServer.close()
          }, 300000) // 5 minutes timeout

          try {
            // Wait for the authorization code
            const authCode = await callbackServer.waitForAuthCode()
            Logger.info(`[MCP] Received auth code: ${authCode}`)

            // Complete the OAuth flow
            await transport.finishAuth(authCode)

            Logger.info(`[MCP] OAuth flow completed for server: ${server.name}`)

            const newTransport = await initTransport()
            // Try to connect again
            await client.connect(newTransport)

            Logger.info(`[MCP] Successfully authenticated with server: ${server.name}`)
          } catch (oauthError) {
            Logger.error(`[MCP] OAuth authentication failed for server ${server.name}:`, oauthError)
            throw new Error(
              `OAuth authentication failed: ${oauthError instanceof Error ? oauthError.message : String(oauthError)}`
            )
          } finally {
            // Clear the timeout and close the callback server
            clearTimeout(timeoutId)
            callbackServer.close()
          }
        }

        try {
          const transport = await initTransport()
          try {
            await client.connect(transport)
          } catch (error: Error | any) {
            if (
              error instanceof Error &&
              (error.name === 'UnauthorizedError' || error.message.includes('Unauthorized'))
            ) {
              Logger.info(`[MCP] Authentication required for server: ${server.name}`)
              await handleAuth(client, transport as SSEClientTransport | StreamableHTTPClientTransport)
            } else {
              throw error
            }
          }

          // Store the new client in the cache
          this.clients.set(serverKey, client)

          Logger.info(`[MCP] Activated server: ${server.name}`)
          return client
        } catch (error: any) {
          Logger.error(`[MCP] Error activating server ${server.name}:`, error?.message)
          throw new Error(`[MCP] Error activating server ${server.name}: ${error.message}`)
        }
      } finally {
        // Clean up the pending promise when done
        this.pendingClients.delete(serverKey)
      }
    })()

    // Store the pending promise
    this.pendingClients.set(serverKey, initPromise)

    return initPromise
  }

  async closeClient(serverKey: string) {
    const client = this.clients.get(serverKey)
    if (client) {
      // Remove the client from the cache
      await client.close()
      Logger.info(`[MCP] Closed server: ${serverKey}`)
      this.clients.delete(serverKey)
      CacheService.remove(`mcp:list_tool:${serverKey}`)
      Logger.info(`[MCP] Cleared cache for server: ${serverKey}`)
    } else {
      Logger.warn(`[MCP] No client found for server: ${serverKey}`)
    }
  }

  async stopServer(_: Electron.IpcMainInvokeEvent, server: MCPServer) {
    const serverKey = this.getServerKey(server)
    Logger.info(`[MCP] Stopping server: ${server.name}`)
    await this.closeClient(serverKey)
  }

  async removeServer(_: Electron.IpcMainInvokeEvent, server: MCPServer) {
    const serverKey = this.getServerKey(server)
    const existingClient = this.clients.get(serverKey)
    if (existingClient) {
      await this.closeClient(serverKey)
    }

    // If this is a DXT server, cleanup its directory
    if (server.dxtPath) {
      try {
        const cleaned = this.dxtService.cleanupDxtServer(server.name)
        if (cleaned) {
          Logger.info(`[MCP] Cleaned up DXT server directory for: ${server.name}`)
        }
      } catch (error) {
        Logger.error(`[MCP] Failed to cleanup DXT server: ${server.name}`, error)
      }
    }
  }

  async restartServer(_: Electron.IpcMainInvokeEvent, server: MCPServer) {
    Logger.info(`[MCP] Restarting server: ${server.name}`)
    const serverKey = this.getServerKey(server)
    await this.closeClient(serverKey)
    await this.initClient(server)
  }

  async cleanup() {
    for (const [key] of this.clients) {
      try {
        await this.closeClient(key)
      } catch (error: any) {
        Logger.error(`[MCP] Failed to close client: ${error?.message}`)
      }
    }
  }

  /**
   * Check connectivity for an MCP server
   */
  public async checkMcpConnectivity(_: Electron.IpcMainInvokeEvent, server: MCPServer): Promise<boolean> {
    Logger.info(`[MCP] Checking connectivity for server: ${server.name}`)
    try {
      Logger.info(`[MCP] About to call initClient for server: ${server.name}`, { hasInitClient: !!this.initClient })

      if (!this.initClient) {
        throw new Error('initClient method is not available')
      }

      const client = await this.initClient(server)
      // Attempt to list tools as a way to check connectivity
      await client.listTools()
      Logger.info(`[MCP] Connectivity check successful for server: ${server.name}`)
      return true
    } catch (error) {
      Logger.error(`[MCP] Connectivity check failed for server: ${server.name}`, error)
      // Close the client if connectivity check fails to ensure a clean state for the next attempt
      const serverKey = this.getServerKey(server)
      await this.closeClient(serverKey)
      return false
    }
  }

  private async listToolsImpl(server: MCPServer): Promise<MCPTool[]> {
    Logger.info(`[MCP] Listing tools for server: ${server.name}`)
    const client = await this.initClient(server)
    try {
      const { tools } = await client.listTools()
      const serverTools: MCPTool[] = []
      tools.map((tool: any) => {
        const serverTool: MCPTool = {
          ...tool,
          id: buildFunctionCallToolName(server.name, tool.name),
          serverId: server.id,
          serverName: server.name
        }
        serverTools.push(serverTool)
      })
      return serverTools
    } catch (error: any) {
      Logger.error(`[MCP] Failed to list tools for server: ${server.name}`, error?.message)
      return []
    }
  }

  async listTools(_: Electron.IpcMainInvokeEvent, server: MCPServer) {
    const cachedListTools = withCache<[MCPServer], MCPTool[]>(
      this.listToolsImpl.bind(this),
      (server) => {
        const serverKey = this.getServerKey(server)
        return `mcp:list_tool:${serverKey}`
      },
      5 * 60 * 1000, // 5 minutes TTL
      `[MCP] Tools from ${server.name}`
    )

    return cachedListTools(server)
  }

  /**
   * Call a tool on an MCP server
   */
  public async callTool(
    _: Electron.IpcMainInvokeEvent,
    { server, name, args, callId }: { server: MCPServer; name: string; args: any; callId?: string }
  ): Promise<MCPCallToolResponse> {
    const toolCallId = callId || uuidv4()
    const abortController = new AbortController()
    this.activeToolCalls.set(toolCallId, abortController)

    try {
      Logger.info('[MCP] Calling:', server.name, name, args, 'callId:', toolCallId)
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args)
        } catch (e) {
          Logger.error('[MCP] args parse error', args)
        }
      }
      const client = await this.initClient(server)
      const result = await client.callTool({ name, arguments: args }, undefined, {
        onprogress: (process) => {
          console.log('[MCP] Progress:', process.progress / (process.total || 1))
          window.api.mcp.setProgress(process.progress / (process.total || 1))
        },
        timeout: server.timeout ? server.timeout * 1000 : 60000, // Default timeout of 1 minute
        signal: this.activeToolCalls.get(toolCallId)?.signal
      })
      return result as MCPCallToolResponse
    } catch (error) {
      Logger.error(`[MCP] Error calling tool ${name} on ${server.name}:`, error)
      throw error
    } finally {
      this.activeToolCalls.delete(toolCallId)
    }
  }

  public async getInstallInfo() {
    const dir = path.join(os.homedir(), '.cherrystudio', 'bin')
    const uvName = await getBinaryName('uv')
    const bunName = await getBinaryName('bun')
    const uvPath = path.join(dir, uvName)
    const bunPath = path.join(dir, bunName)
    return { dir, uvPath, bunPath }
  }

  /**
   * List prompts available on an MCP server
   */
  private async listPromptsImpl(server: MCPServer): Promise<MCPPrompt[]> {
    const client = await this.initClient(server)
    Logger.info(`[MCP] Listing prompts for server: ${server.name}`)
    try {
      const { prompts } = await client.listPrompts()
      return prompts.map((prompt: any) => ({
        ...prompt,
        id: `p${nanoid()}`,
        serverId: server.id,
        serverName: server.name
      }))
    } catch (error: any) {
      // -32601 is the code for the method not found
      if (error?.code !== -32601) {
        Logger.error(`[MCP] Failed to list prompts for server: ${server.name}`, error?.message)
      }
      return []
    }
  }

  /**
   * List prompts available on an MCP server with caching
   */
  public async listPrompts(_: Electron.IpcMainInvokeEvent, server: MCPServer): Promise<MCPPrompt[]> {
    const cachedListPrompts = withCache<[MCPServer], MCPPrompt[]>(
      this.listPromptsImpl.bind(this),
      (server) => {
        const serverKey = this.getServerKey(server)
        return `mcp:list_prompts:${serverKey}`
      },
      60 * 60 * 1000, // 60 minutes TTL
      `[MCP] Prompts from ${server.name}`
    )
    return cachedListPrompts(server)
  }

  /**
   * Get a specific prompt from an MCP server (implementation)
   */
  private async getPromptImpl(
    server: MCPServer,
    name: string,
    args?: Record<string, any>
  ): Promise<GetMCPPromptResponse> {
    Logger.info(`[MCP] Getting prompt ${name} from server: ${server.name}`)
    const client = await this.initClient(server)
    return await client.getPrompt({ name, arguments: args })
  }

  /**
   * Get a specific prompt from an MCP server with caching
   */
  public async getPrompt(
    _: Electron.IpcMainInvokeEvent,
    { server, name, args }: { server: MCPServer; name: string; args?: Record<string, any> }
  ): Promise<GetMCPPromptResponse> {
    const cachedGetPrompt = withCache<[MCPServer, string, Record<string, any> | undefined], GetMCPPromptResponse>(
      this.getPromptImpl.bind(this),
      (server, name, args) => {
        const serverKey = this.getServerKey(server)
        const argsKey = args ? JSON.stringify(args) : 'no-args'
        return `mcp:get_prompt:${serverKey}:${name}:${argsKey}`
      },
      30 * 60 * 1000, // 30 minutes TTL
      `[MCP] Prompt ${name} from ${server.name}`
    )
    return await cachedGetPrompt(server, name, args)
  }

  /**
   * List resources available on an MCP server (implementation)
   */
  private async listResourcesImpl(server: MCPServer): Promise<MCPResource[]> {
    const client = await this.initClient(server)
    Logger.info(`[MCP] Listing resources for server: ${server.name}`)
    try {
      const result = await client.listResources()
      const resources = result.resources || []
      return (Array.isArray(resources) ? resources : []).map((resource: any) => ({
        ...resource,
        serverId: server.id,
        serverName: server.name
      }))
    } catch (error: any) {
      // -32601 is the code for the method not found
      if (error?.code !== -32601) {
        Logger.error(`[MCP] Failed to list resources for server: ${server.name}`, error?.message)
      }
      return []
    }
  }

  /**
   * List resources available on an MCP server with caching
   */
  public async listResources(_: Electron.IpcMainInvokeEvent, server: MCPServer): Promise<MCPResource[]> {
    const cachedListResources = withCache<[MCPServer], MCPResource[]>(
      this.listResourcesImpl.bind(this),
      (server) => {
        const serverKey = this.getServerKey(server)
        return `mcp:list_resources:${serverKey}`
      },
      60 * 60 * 1000, // 60 minutes TTL
      `[MCP] Resources from ${server.name}`
    )
    return cachedListResources(server)
  }

  /**
   * Get a specific resource from an MCP server (implementation)
   */
  private async getResourceImpl(server: MCPServer, uri: string): Promise<GetResourceResponse> {
    Logger.info(`[MCP] Getting resource ${uri} from server: ${server.name}`)
    const client = await this.initClient(server)
    try {
      const result = await client.readResource({ uri: uri })
      const contents: MCPResource[] = []
      if (result.contents && result.contents.length > 0) {
        result.contents.forEach((content: any) => {
          contents.push({
            ...content,
            serverId: server.id,
            serverName: server.name
          })
        })
      }
      return {
        contents: contents
      }
    } catch (error: Error | any) {
      Logger.error(`[MCP] Failed to get resource ${uri} from server: ${server.name}`, error.message)
      throw new Error(`Failed to get resource ${uri} from server: ${server.name}: ${error.message}`)
    }
  }

  /**
   * Get a specific resource from an MCP server with caching
   */
  public async getResource(
    _: Electron.IpcMainInvokeEvent,
    { server, uri }: { server: MCPServer; uri: string }
  ): Promise<GetResourceResponse> {
    const cachedGetResource = withCache<[MCPServer, string], GetResourceResponse>(
      this.getResourceImpl.bind(this),
      (server, uri) => {
        const serverKey = this.getServerKey(server)
        return `mcp:get_resource:${serverKey}:${uri}`
      },
      30 * 60 * 1000, // 30 minutes TTL
      `[MCP] Resource ${uri} from ${server.name}`
    )
    return await cachedGetResource(server, uri)
  }

  private getLoginShellEnv = memoize(async (): Promise<Record<string, string>> => {
    try {
      const loginEnv = await getLoginShellEnvironment()
      const pathSeparator = process.platform === 'win32' ? ';' : ':'
      const cherryBinPath = path.join(os.homedir(), '.cherrystudio', 'bin')
      loginEnv.PATH = `${loginEnv.PATH}${pathSeparator}${cherryBinPath}`
      Logger.info('[MCP] Successfully fetched login shell environment variables:')
      return loginEnv
    } catch (error) {
      Logger.error('[MCP] Failed to fetch login shell environment variables:', error)
      return {}
    }
  })

  private removeProxyEnv(env: Record<string, string>) {
    delete env.HTTPS_PROXY
    delete env.HTTP_PROXY
    delete env.grpc_proxy
    delete env.http_proxy
    delete env.https_proxy
  }

  // 实现 abortTool 方法
  public async abortTool(_: Electron.IpcMainInvokeEvent, callId: string) {
    const activeToolCall = this.activeToolCalls.get(callId)
    if (activeToolCall) {
      activeToolCall.abort()
      this.activeToolCalls.delete(callId)
      Logger.info(`[MCP] Aborted tool call: ${callId}`)
      return true
    } else {
      Logger.warn(`[MCP] No active tool call found for callId: ${callId}`)
      return false
    }
  }

  /**
   * Get the server version information
   */
  public async getServerVersion(_: Electron.IpcMainInvokeEvent, server: MCPServer): Promise<string | null> {
    try {
      Logger.info(`[MCP] Getting server version for: ${server.name}`)
      const client = await this.initClient(server)

      // Try to get server information which may include version
      const serverInfo = client.getServerVersion()
      Logger.info(`[MCP] Server info for ${server.name}:`, serverInfo)

      if (serverInfo && serverInfo.version) {
        Logger.info(`[MCP] Server version for ${server.name}: ${serverInfo.version}`)
        return serverInfo.version
      }

      Logger.warn(`[MCP] No version information available for server: ${server.name}`)
      return null
    } catch (error: any) {
      Logger.error(`[MCP] Failed to get server version for ${server.name}:`, error?.message)
      return null
    }
  }
}

export default new McpService()
