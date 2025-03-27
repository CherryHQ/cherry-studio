import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { isLinux, isMac, isWin } from '@main/constant'
import { getBinaryPath } from '@main/utils/process'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { MCPServer, MCPTool } from '@types'
import { app } from 'electron'
import log from 'electron-log'
import { v4 as uuidv4 } from 'uuid'

import { CacheService } from './CacheService'
import { windowService } from './WindowService'

interface ActiveServer {
  client: Client
  server: MCPServer
}

/**
 * Service for managing Model Context Protocol servers and tools
 */
export default class MCPService extends EventEmitter {
  private servers: MCPServer[] = []
  private activeServers: Map<string, ActiveServer> = new Map()
  private clients: { [key: string]: Client } = {}
  private Client: typeof Client | undefined
  private stdioTransport: typeof StdioClientTransport | undefined
  private sseTransport: typeof SSEClientTransport | undefined
  private initialized = false
  private initPromise: Promise<void> | null = null
  private configPath: string

  // Simplified server loading state management
  private readyState = {
    serversLoaded: false,
    promise: null as Promise<void> | null,
    resolve: null as ((value: void) => void) | null
  }

  constructor() {
    super()
    const userDataPath = app.getPath('userData')
    this.configPath = join(userDataPath, 'cherry-mcp-servers.json')
    this.createServerLoadingPromise()
    this.init().catch((err) => this.logError('Failed to initialize MCP service', err))
  }

  /**
   * Create a promise that resolves when servers are loaded
   */
  private createServerLoadingPromise(): void {
    this.readyState.promise = new Promise<void>((resolve) => {
      this.readyState.resolve = resolve
    })
  }

  private async ensureConfigExists(): Promise<void> {
    try {
      await fs.access(this.configPath)
    } catch {
      const defaultServers = {
        name: 'mcp-auto-install',
        command: 'npx',
        args: ['-y', '@mcpmarket/mcp-auto-install', 'connect'],
        env: {
          MCP_SETTINGS_PATH: this.configPath
        },
        isActive: true
      }
      const defaultConfig = {
        mcpServers: {
          'mcp-auto-install': defaultServers
        }
      }
      // 尝试从Redux获取已有配置
      try {
        const mainWindow = windowService.getMainWindow()
        if (mainWindow) {
          const servers = await mainWindow.webContents.executeJavaScript(`
            window.store.getState().mcp.servers
          `)
          if (servers && servers.length > 0) {
            // 将从Redux获取的配置保存到文件
            await this.saveConfigToFile(servers.concat([defaultServers]))
            log.info('[MCP] Migrated servers config from Redux to file')
            return
          }
        }
      } catch (error) {
        log.warn('[MCP] Failed to get servers from Redux:', error)
      }

      // 如果没有Redux配置，则创建默认配置
      await fs.writeFile(this.configPath, JSON.stringify(defaultConfig, null, 2))
      log.info('[MCP] Created default config file')
    }
  }

  private async loadConfigFromFile(): Promise<MCPServer[]> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8')
      const config = JSON.parse(data)

      if (config.mcpServers && typeof config.mcpServers === 'object') {
        console.log('读写读写读写', config)
        return Object.entries(config.mcpServers).map(([name, serverData]) => ({
          name,
          ...(serverData as Omit<MCPServer, 'name'>)
        }))
      }

      return []
    } catch (error) {
      log.error('[MCP] Error loading config file:', error)
      return []
    }
  }

  private async saveConfigToFile(servers: MCPServer[]): Promise<void> {
    try {
      // 将数组转换为对象结构
      const mcpServers = servers.reduce(
        (acc, server) => {
          const { name, ...serverData } = server
          acc[name] = serverData
          return acc
        },
        {} as Record<string, Omit<MCPServer, 'name'>>
      )

      const config = { mcpServers }
      await fs.writeFile(this.configPath, JSON.stringify(config, null, 2))
    } catch (error) {
      log.error('[MCP] Error saving config file:', error)
      throw error
    }
  }

  /**
   * Set servers received from Redux and trigger initialization if needed
   */
  public setServers(servers: any): void {
    // 如果已初始化，则更新服务器列表并保存到文件
    this.servers = servers
    if (this.initialized) {
      log.info(`[MCP] Received ${servers.length} servers from Redux, saving to file`)
      // 保存到文件
      this.saveConfigToFile(servers).catch((err) => {
        log.error('[MCP] Failed to save servers to file:', err)
      })
    } else {
      log.info(`[MCP] Received ${servers.length} servers from Redux, but service not initialized yet`)

      // 如果未初始化，则标记已加载并解决 Promise
      if (!this.readyState.serversLoaded && this.readyState.resolve) {
        this.readyState.serversLoaded = true
        this.readyState.resolve()
        this.readyState.resolve = null
      }

      // 初始化服务
      // this.init().catch((err) => this.logError('Failed to initialize MCP service', err))
    }
  }

  /**
   * Initialize the MCP service if not already initialized
   */
  public async init(): Promise<void> {
    if (this.initialized) return
    if (this.initPromise) return this.initPromise

    this.initPromise = (async () => {
      try {
        log.info('[MCP] Starting initialization')

        // 加载 SDK 组件
        const [Client, StdioTransport, SSETransport] = await Promise.all([
          this.importClient(),
          this.importStdioClientTransport(),
          this.importSSEClientTransport()
        ])

        this.Client = Client
        this.stdioTransport = StdioTransport
        this.sseTransport = SSETransport

        // 等待Redux初始化完成后再加载配置
        if (!this.readyState.serversLoaded && this.readyState.promise) {
          await this.readyState.promise
        }
        // 确保配置文件存在
        await this.ensureConfigExists()
        // 从文件加载配置
        const serversFromFile = await this.loadConfigFromFile()
        if (serversFromFile.length > 0) {
          this.servers = serversFromFile
          // 将从文件加载的配置通知给 Redux
          this.notifyReduxServersChanged(serversFromFile)
        }

        // 标记为已初始化并解决 readyState 的 Promise
        this.initialized = true
        if (this.readyState.resolve) {
          this.readyState.serversLoaded = true
          this.readyState.resolve()
          this.readyState.resolve = null
        }

        // 加载活跃服务器
        await this.loadActiveServers()
        log.info('[MCP] Initialization successfully')

        return
      } catch (err) {
        this.initialized = false
        log.error('[MCP] Failed to initialize:', err)
        throw err
      } finally {
        this.initPromise = null
      }
    })()

    return this.initPromise
  }

  /**
   * Helper to create consistent error logging functions
   */
  private logError(message: string, err?: unknown): void {
    log.error(`[MCP] ${message}`, err)
  }

  /**
   * Import the MCP client SDK
   */
  private async importClient() {
    try {
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
      return Client
    } catch (err) {
      this.logError('Failed to import Client:', err)
      throw err
    }
  }

  /**
   * Import the stdio transport
   */
  private async importStdioClientTransport() {
    try {
      const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
      return StdioClientTransport
    } catch (err) {
      log.error('[MCP] Failed to import StdioTransport:', err)
      throw err
    }
  }

  /**
   * Import the SSE transport
   */
  private async importSSEClientTransport() {
    try {
      const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js')
      return SSEClientTransport
    } catch (err) {
      log.error('[MCP] Failed to import SSETransport:', err)
      throw err
    }
  }

  /**
   * List all available MCP servers
   */
  public async listAvailableServices(): Promise<MCPServer[]> {
    await this.ensureInitialized()
    return this.servers
  }

  /**
   * Ensure the service is initialized before operations
   */
  private async ensureInitialized() {
    if (!this.initialized) {
      log.debug('[MCP] Ensuring initialization')
      await this.init()
    }
  }

  /**
   * Add a new MCP server
   */
  public async addServer(server: MCPServer): Promise<void> {
    await this.ensureInitialized()

    // Check for duplicate name
    if (this.servers.some((s) => s.name === server.name)) {
      throw new Error(`Server with name ${server.name} already exists`)
    }

    // Activate if needed
    if (server.isActive) {
      await this.activate(server)
    }

    // Add to servers list
    this.servers = [...this.servers, server]
    this.notifyReduxServersChanged(this.servers)
  }

  /**
   * Update an existing MCP server
   */
  public async updateServer(server: MCPServer): Promise<void> {
    await this.ensureInitialized()

    const index = this.servers.findIndex((s) => s.name === server.name)
    if (index === -1) {
      throw new Error(`Server ${server.name} not found`)
    }

    // Check activation status change
    const wasActive = this.servers[index].isActive
    if (wasActive && !server.isActive) {
      await this.deactivate(server.name)
    } else if (!wasActive && server.isActive) {
      await this.activate(server)
    } else {
      await this.restartServer(server)
    }

    // Update servers list
    const updatedServers = [...this.servers]
    updatedServers[index] = server
    this.servers = updatedServers

    // Notify Redux
    this.notifyReduxServersChanged(updatedServers)
  }

  public async restartServer(_server: MCPServer): Promise<void> {
    await this.ensureInitialized()

    const server = this.servers.find((s) => s.name === _server.name)

    if (server) {
      if (server.isActive) {
        await this.deactivate(server.name)
      }
      await this.activate(server)
    }
  }
  /**
   * Delete an MCP server
   */
  public async deleteServer(serverName: string): Promise<void> {
    await this.ensureInitialized()

    // Deactivate if running
    if (this.clients[serverName]) {
      await this.deactivate(serverName)
    }

    // Update servers list
    const filteredServers = this.servers.filter((s) => s.name !== serverName)
    this.servers = filteredServers
    this.notifyReduxServersChanged(filteredServers)
  }

  /**
   * Set a server's active state
   */
  public async setServerActive(params: { name: string; isActive: boolean }): Promise<void> {
    await this.ensureInitialized()

    const { name, isActive } = params
    const server = this.servers.find((s) => s.name === name)

    if (!server) {
      throw new Error(`Server ${name} not found`)
    }

    // Activate or deactivate as needed
    if (isActive) {
      await this.activate(server)
    } else {
      await this.deactivate(name)
    }

    // Update server status
    server.isActive = isActive
    this.notifyReduxServersChanged([...this.servers])
  }

  /**
   * Notify Redux in the renderer process about server changes
   */
  private notifyReduxServersChanged(servers: MCPServer[]): void {
    const mainWindow = windowService.getMainWindow()
    if (mainWindow) {
      mainWindow.webContents.send('mcp:servers-changed', servers)
    }
  }

  /**
   * Activate an MCP server
   */
  public async activate(server: MCPServer): Promise<void> {
    await this.ensureInitialized()

    const { name, baseUrl, command, env } = server
    const args = [...(server.args || [])]

    // Skip if already running
    if (this.clients[name]) {
      log.info(`[MCP] Server ${name} is already running`)
      return
    }

    let transport: StdioClientTransport | SSEClientTransport

    try {
      // Create appropriate transport based on configuration
      if (baseUrl) {
        transport = new this.sseTransport!(new URL(baseUrl))
      } else if (command) {
        let cmd: string = command
        if (command === 'npx') {
          cmd = await getBinaryPath('bun')

          if (cmd === 'bun') {
            cmd = 'npx'
          }

          log.info(`[MCP] Using command: ${cmd}`)

          // add -x to args if args exist
          if (args && args.length > 0) {
            if (!args.includes('-y')) {
              args.unshift('-y')
            }
            if (cmd.includes('bun') && !args.includes('x')) {
              args.unshift('x')
            }
          }
        } else if (command === 'uvx') {
          cmd = await getBinaryPath('uvx')
        }

        log.info(`[MCP] Starting server with command: ${cmd} ${args ? args.join(' ') : ''}`)

        transport = new this.stdioTransport!({
          command: cmd,
          args,
          stderr: 'pipe',
          env: {
            PATH: this.getEnhancedPath(process.env.PATH || ''),
            ...env
          }
        })
      } else {
        throw new Error('Either baseUrl or command must be provided')
      }

      // Create and connect client
      const client = new this.Client!({ name, version: '1.0.0' }, { capabilities: {} })

      await client.connect(transport)

      // Store client and server info
      this.clients[name] = client
      this.activeServers.set(name, { client, server })

      log.info(`[MCP] Activated server: ${server.name}`)
      this.emit('server-started', { name })
    } catch (error) {
      log.error(`[MCP] Error activating server ${name}:`, error)
      this.setServerActive({ name, isActive: false })
      throw error
    }
  }

  /**
   * Deactivate an MCP server
   */
  public async deactivate(name: string): Promise<void> {
    await this.ensureInitialized()

    if (!this.clients[name]) {
      log.warn(`[MCP] Server ${name} is not running`)
      return
    }

    try {
      log.info(`[MCP] Stopping server: ${name}`)
      await this.clients[name].close()
      delete this.clients[name]
      this.activeServers.delete(name)
      this.emit('server-stopped', { name })
    } catch (error) {
      log.error(`[MCP] Error deactivating server ${name}:`, error)
      throw error
    }
  }

  /**
   * List available tools from active MCP servers
   */
  public async listTools(serverName?: string): Promise<MCPTool[]> {
    await this.ensureInitialized()
    log.info(`[MCP] Listing tools from ${serverName || 'all active servers'}`)

    try {
      // If server name provided, list tools for that server only
      if (serverName) {
        return await this.listToolsFromServer(serverName)
      }

      // Otherwise list tools from all active servers
      let allTools: MCPTool[] = []

      for (const clientName in this.clients) {
        log.info(`[MCP] Listing tools from ${clientName}`)
        try {
          const tools = await this.listToolsFromServer(clientName)
          allTools = allTools.concat(tools)
        } catch (error) {
          this.logError(`Error listing tools for ${clientName}`, error)
        }
      }

      log.info(`[MCP] Total tools listed: ${allTools.length}`)
      return allTools
    } catch (error) {
      this.logError('Error listing tools:', error)
      return []
    }
  }

  /**
   * Helper method to list tools from a specific server
   */
  private async listToolsFromServer(serverName: string): Promise<MCPTool[]> {
    log.info(`[MCP] start list tools from ${serverName}:`)
    if (!this.clients[serverName]) {
      throw new Error(`MCP Client ${serverName} not found`)
    }
    const cacheKey = `mcp:list_tool:${serverName}`

    if (CacheService.has(cacheKey)) {
      log.info(`[MCP] Tools from ${serverName} loaded from cache`)
      // Check if cache is still valid
      const cachedTools = CacheService.get<MCPTool[]>(cacheKey)
      if (cachedTools && cachedTools.length > 0) {
        return cachedTools
      }
      CacheService.remove(cacheKey)
    }

    const { tools } = await this.clients[serverName].listTools()

    const transformedTools = tools.map((tool: any) => ({
      ...tool,
      serverName,
      id: 'f' + uuidv4().replace(/-/g, '')
    }))

    // Cache the tools for 5 minutes
    if (transformedTools.length > 0) {
      CacheService.set(cacheKey, transformedTools, 5 * 60 * 1000)
    }

    log.info(`[MCP] Tools from ${serverName}:`, transformedTools)
    return transformedTools
  }

  /**
   * Call a tool on an MCP server
   */
  public async callTool(params: { client: string; name: string; args: any }): Promise<any> {
    await this.ensureInitialized()

    const { client, name, args } = params

    if (!this.clients[client]) {
      throw new Error(`MCP Client ${client} not found`)
    }

    log.info('[MCP] Calling:', client, name, args)

    try {
      return await this.clients[client].callTool({
        name,
        arguments: args
      })
    } catch (error) {
      log.error(`[MCP] Error calling tool ${name} on ${client}:`, error)
      throw error
    }
  }

  /**
   * Clean up all MCP resources
   */
  public async cleanup(): Promise<void> {
    const clientNames = Object.keys(this.clients)

    if (clientNames.length === 0) {
      log.info('[MCP] No active servers to clean up')
      return
    }

    log.info(`[MCP] Cleaning up ${clientNames.length} active servers`)

    // Deactivate all clients
    await Promise.allSettled(
      clientNames.map((name) =>
        this.deactivate(name).catch((err) => {
          log.error(`[MCP] Error during cleanup of ${name}:`, err)
        })
      )
    )

    this.clients = {}
    this.activeServers.clear()
    log.info('[MCP] All servers cleaned up')
  }

  /**
   * Load all active servers
   */
  private async loadActiveServers(): Promise<void> {
    console.log('loadActiveServers', this.servers)
    const activeServers = this.servers.filter((server) => server.isActive)

    if (activeServers.length === 0) {
      log.info('[MCP] No active servers to load')
      return
    }

    log.info(`[MCP] Start loading ${activeServers.length} active servers`)

    // Activate servers in parallel for better performance
    await Promise.allSettled(
      activeServers.map(async (server) => {
        try {
          await this.activate(server)
        } catch (error) {
          this.logError(`Failed to activate server ${server.name}`, error)
          this.emit('server-error', { name: server.name, error })
        }
      })
    )

    log.info(`[MCP] End loading ${Object.keys(this.clients).length} active servers`)
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
        '/snap/bin'
      )
    }

    if (isWin) {
      newPaths.push(`${process.env.APPDATA}\\npm`, `${homeDir}\\AppData\\Local\\Yarn\\bin`, `${homeDir}\\.cargo\\bin`)
    }

    // 只添加不存在的路径
    for (const path of newPaths) {
      if (path && !existingPaths.has(path)) {
        existingPaths.add(path)
      }
    }

    // 转换回字符串
    return Array.from(existingPaths).join(pathSeparator)
  }
}
