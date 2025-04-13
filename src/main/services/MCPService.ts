import os from 'node:os'
import path from 'node:path'

import { isLinux, isMac, isWin } from '@main/constant'
import { createInMemoryMCPServer } from '@main/mcpServers/factory'
import { makeSureDirExists } from '@main/utils'
import { getBinaryName, getBinaryPath } from '@main/utils/process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory'
import { nanoid } from '@reduxjs/toolkit'
import { GetMCPPromptResponse, GetResourceResponse, MCPPrompt, MCPResource, MCPServer, MCPTool } from '@types'
import { app } from 'electron'
import Logger from 'electron-log'

import { CacheService } from './CacheService'
import { StreamableHTTPClientTransport, type StreamableHTTPClientTransportOptions } from './MCPStreamableHttpClient'

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

  private getServerKey(server: MCPServer): string {
    return JSON.stringify({
      baseUrl: server.baseUrl,
      command: server.command,
      args: server.args,
      registryUrl: server.registryUrl,
      env: server.env,
      id: server.id
    })
  }

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
    this.cleanup = this.cleanup.bind(this)
  }

  async initClient(server: MCPServer): Promise<Client> {
    const serverKey = this.getServerKey(server)

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
      } catch (error) {
        Logger.error(`[MCP] Error pinging server ${server.name}:`, error)
        this.clients.delete(serverKey)
      }
    }
    // Create new client instance for each connection
    const client = new Client({ name: 'Cherry Studio', version: app.getVersion() }, { capabilities: {} })

    const args = [...(server.args || [])]

    let transport: StdioClientTransport | SSEClientTransport | InMemoryTransport | StreamableHTTPClientTransport

    try {
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
        transport = clientTransport
      } else if (server.baseUrl) {
        if (server.type === 'streamableHttp') {
          transport = new StreamableHTTPClientTransport(
            new URL(server.baseUrl!),
            {} as StreamableHTTPClientTransportOptions
          )
        } else if (server.type === 'sse') {
          transport = new SSEClientTransport(new URL(server.baseUrl!))
        } else {
          throw new Error('Invalid server type')
        }
      } else if (server.command) {
        let cmd = server.command

        if (server.command === 'npx' || server.command === 'bun' || server.command === 'bunx') {
          cmd = await getBinaryPath('bun')
          Logger.info(`[MCP] Using command: ${cmd}`)

          // add -x to args if args exist
          if (args && args.length > 0) {
            if (!args.includes('-y')) {
              !args.includes('-y') && args.unshift('-y')
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

        transport = new StdioClientTransport({
          command: cmd,
          args,
          env: {
            ...getDefaultEnvironment(),
            PATH: this.getEnhancedPath(process.env.PATH || ''),
            ...server.env
          },
          stderr: 'pipe'
        })
        transport.stderr?.on('data', (data) =>
          Logger.info(`[MCP] Stdio stderr for server: ${server.name} `, data.toString())
        )
      } else {
        throw new Error('Either baseUrl or command must be provided')
      }

      await client.connect(transport)

      // Store the new client in the cache
      this.clients.set(serverKey, client)

      Logger.info(`[MCP] Activated server: ${server.name}`)
      return client
    } catch (error: any) {
      Logger.error(`[MCP] Error activating server ${server.name}:`, error)
      throw new Error(`[MCP] Error activating server ${server.name}: ${error.message}`)
    }
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
      } catch (error) {
        Logger.error(`[MCP] Failed to close client: ${error}`)
      }
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
          id: `f${nanoid()}`,
          serverId: server.id,
          serverName: server.name
        }
        serverTools.push(serverTool)
      })
      return serverTools
    } catch (error) {
      Logger.error(`[MCP] Failed to list tools for server: ${server.name}`, error)
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
    { server, name, args }: { server: MCPServer; name: string; args: any }
  ): Promise<any> {
    try {
      Logger.info('[MCP] Calling:', server.name, name, args)
      const client = await this.initClient(server)
      const result = await client.callTool({ name, arguments: args })
      return result
    } catch (error) {
      Logger.error(`[MCP] Error calling tool ${name} on ${server.name}:`, error)
      throw error
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
    Logger.info(`[MCP] Listing prompts for server: ${server.name}`)
    const client = await this.initClient(server)
    try {
      const { prompts } = await client.listPrompts()
      const serverPrompts = prompts.map((prompt: any) => ({
        ...prompt,
        id: `p${nanoid()}`,
        serverId: server.id,
        serverName: server.name
      }))
      return serverPrompts
    } catch (error) {
      Logger.error(`[MCP] Failed to list prompts for server: ${server.name}`, error)
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
    Logger.info(`[MCP] Listing resources for server: ${server.name}`)
    const client = await this.initClient(server)
    try {
      const result = await client.listResources()
      const resources = result.resources || []
      const serverResources = (Array.isArray(resources) ? resources : []).map((resource: any) => ({
        ...resource,
        serverId: server.id,
        serverName: server.name
      }))
      return serverResources
    } catch (error) {
      Logger.error(`[MCP] Failed to list resources for server: ${server.name}`, error)
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
      Logger.error(`[MCP] Failed to get resource ${uri} from server: ${server.name}`, error)
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

  /**
   * Get enhanced PATH including common tool locations
   */
  private getEnhancedPath(originalPath: string): string {
    // 将原始 PATH 按分隔符分割成数组
    const pathSeparator = process.platform === 'win32' ? ';' : ':'
    const existingPaths = new Set(originalPath.split(pathSeparator).filter(Boolean))
    const homeDir = process.env.HOME || process.env.USERPROFILE || ''

    // 定义要添加的新路径
    const newPaths: string[] = []

    if (isMac) {
      newPaths.push(
        '/bin',
        '/usr/bin',
        '/usr/local/bin',
        '/usr/local/sbin',
        '/opt/homebrew/bin',
        '/opt/homebrew/sbin',
        '/usr/local/opt/node/bin',
        `${homeDir}/.nvm/current/bin`,
        `${homeDir}/.npm-global/bin`,
        `${homeDir}/.yarn/bin`,
        `${homeDir}/.cargo/bin`,
        `${homeDir}/.cherrystudio/bin`,
        '/opt/local/bin'
      )
    }

    if (isLinux) {
      newPaths.push(
        '/bin',
        '/usr/bin',
        '/usr/local/bin',
        `${homeDir}/.nvm/current/bin`,
        `${homeDir}/.npm-global/bin`,
        `${homeDir}/.yarn/bin`,
        `${homeDir}/.cargo/bin`,
        `${homeDir}/.cherrystudio/bin`,
        '/snap/bin'
      )
    }

    if (isWin) {
      newPaths.push(
        `${process.env.APPDATA}\\npm`,
        `${homeDir}\\AppData\\Local\\Yarn\\bin`,
        `${homeDir}\\.cargo\\bin`,
        `${homeDir}\\.cherrystudio\\bin`
      )
    }

    // 只添加不存在的路径
    newPaths.forEach((path) => {
      if (path && !existingPaths.has(path)) {
        existingPaths.add(path)
      }
    })

    // 转换回字符串
    return Array.from(existingPaths).join(pathSeparator)
  }
}

const mcpService = new McpService()
export default mcpService
