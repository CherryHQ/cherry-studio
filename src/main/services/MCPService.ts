import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { isLinux, isMac, isWin } from '@main/constant'
import { createInMemoryMCPServer } from '@main/mcpServers/factory'
import { makeSureDirExists } from '@main/utils'
import { getBinaryName, getBinaryPath } from '@main/utils/process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport, SSEClientTransportOptions } from '@modelcontextprotocol/sdk/client/sse.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
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

import { CacheService } from './CacheService'
import { CallBackServer } from './mcp/oauth/callback'
import { McpOAuthClientProvider } from './mcp/oauth/provider'
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
              fetch: (url, init) => fetch(url, { ...init, headers: server.headers || {} }),
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

        if (server.command === 'npx') {
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

        const stdioTransport = new StdioClientTransport({
          command: cmd,
          args,
          env: {
            ...getDefaultEnvironment(),
            PATH: await this.getEnhancedPath(process.env.PATH || ''),
            ...server.env
          },
          stderr: 'pipe'
        })
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
        if (error instanceof Error && (error.name === 'UnauthorizedError' || error.message.includes('Unauthorized'))) {
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
  ): Promise<MCPCallToolResponse> {
    try {
      Logger.info('[MCP] Calling:', server.name, name, args)
      const client = await this.initClient(server)
      const result = await client.callTool({ name, arguments: args })
      return result as MCPCallToolResponse
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

  private getSystemPath = memoize(async (): Promise<string> => {
    return new Promise((resolve, reject) => {
      let command: string
      let shell: string

      if (process.platform === 'win32') {
        shell = 'powershell.exe'
        command = '$env:PATH'
      } else {
        // 尝试获取当前用户的默认 shell

        let userShell = process.env.SHELL
        if (!userShell) {
          if (fs.existsSync('/bin/zsh')) {
            userShell = '/bin/zsh'
          } else if (fs.existsSync('/bin/bash')) {
            userShell = '/bin/bash'
          } else if (fs.existsSync('/bin/fish')) {
            userShell = '/bin/fish'
          } else {
            userShell = '/bin/sh'
          }
        }
        shell = userShell

        // 根据不同的 shell 构建不同的命令
        if (userShell.includes('zsh')) {
          command =
            'source /etc/zshenv 2>/dev/null || true; source ~/.zshenv 2>/dev/null || true; source /etc/zprofile 2>/dev/null || true; source ~/.zprofile 2>/dev/null || true; source /etc/zshrc 2>/dev/null || true; source ~/.zshrc 2>/dev/null || true; source /etc/zlogin 2>/dev/null || true; source ~/.zlogin 2>/dev/null || true; echo $PATH'
        } else if (userShell.includes('bash')) {
          command =
            'source /etc/profile 2>/dev/null || true; source ~/.bash_profile 2>/dev/null || true; source ~/.bash_login 2>/dev/null || true; source ~/.profile 2>/dev/null || true; source ~/.bashrc 2>/dev/null || true; echo $PATH'
        } else if (userShell.includes('fish')) {
          command =
            'source /etc/fish/config.fish 2>/dev/null || true; source ~/.config/fish/config.fish 2>/dev/null || true; source ~/.config/fish/config.local.fish 2>/dev/null || true; echo $PATH'
        } else {
          // 默认使用 zsh
          shell = '/bin/zsh'
          command =
            'source /etc/zshenv 2>/dev/null || true; source ~/.zshenv 2>/dev/null || true; source /etc/zprofile 2>/dev/null || true; source ~/.zprofile 2>/dev/null || true; source /etc/zshrc 2>/dev/null || true; source ~/.zshrc 2>/dev/null || true; source /etc/zlogin 2>/dev/null || true; source ~/.zlogin 2>/dev/null || true; echo $PATH'
        }
      }

      console.log(`Using shell: ${shell} with command: ${command}`)
      const child = require('child_process').spawn(shell, ['-c', command], {
        env: { ...process.env },
        cwd: app.getPath('home')
      })

      let path = ''
      child.stdout.on('data', (data: Buffer) => {
        path += data.toString()
      })

      child.stderr.on('data', (data: Buffer) => {
        console.error('Error getting PATH:', data.toString())
      })

      child.on('close', (code: number) => {
        if (code === 0) {
          const trimmedPath = path.trim()
          resolve(trimmedPath)
        } else {
          reject(new Error(`Failed to get system PATH, exit code: ${code}`))
        }
      })
    })
  })

  /**
   * Get enhanced PATH including common tool locations
   */
  private async getEnhancedPath(originalPath: string): Promise<string> {
    let systemPath = ''
    try {
      systemPath = await this.getSystemPath()
    } catch (error) {
      Logger.error('[MCP] Failed to get system PATH:', error)
    }
    // 将原始 PATH 按分隔符分割成数组
    const pathSeparator = process.platform === 'win32' ? ';' : ':'
    const existingPaths = new Set(
      [...systemPath.split(pathSeparator), ...originalPath.split(pathSeparator)].filter(Boolean)
    )
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
