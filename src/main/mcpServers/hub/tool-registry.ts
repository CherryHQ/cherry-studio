import { loggerService } from '@logger'

import { generateToolFunction } from './generator'
import { callMcpTool, getActiveServers, listToolsFromServer } from './mcp-bridge'
import type { GeneratedTool, ToolRegistryOptions } from './types'

const logger = loggerService.withContext('MCPServer:Hub:Registry')

const DEFAULT_TTL = 10 * 60 * 1000

export class ToolRegistry {
  private tools: Map<string, GeneratedTool> = new Map()
  private lastRefresh: number = 0
  private readonly ttl: number
  private refreshPromise: Promise<void> | null = null

  constructor(options: ToolRegistryOptions = {}) {
    this.ttl = options.ttl ?? DEFAULT_TTL
  }

  async getTools(): Promise<GeneratedTool[]> {
    if (this.isExpired()) {
      await this.refresh()
    }
    return Array.from(this.tools.values())
  }

  async getTool(toolId: string): Promise<GeneratedTool | undefined> {
    if (this.isExpired()) {
      await this.refresh()
    }
    return this.tools.get(toolId)
  }

  getToolByFunctionName(functionName: string): GeneratedTool | undefined {
    for (const tool of this.tools.values()) {
      if (tool.functionName === functionName) {
        return tool
      }
    }
    return undefined
  }

  private isExpired(): boolean {
    return Date.now() - this.lastRefresh > this.ttl
  }

  invalidate(): void {
    this.lastRefresh = 0
    this.tools.clear()
    logger.debug('Tool registry invalidated')
  }

  async refresh(): Promise<void> {
    if (this.refreshPromise) {
      return this.refreshPromise
    }

    this.refreshPromise = this.doRefresh()

    try {
      await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  private async doRefresh(): Promise<void> {
    logger.debug('Refreshing tool registry')

    const servers = getActiveServers()
    const newTools = new Map<string, GeneratedTool>()
    const existingNames = new Set<string>()

    for (const server of servers) {
      try {
        const serverTools = await listToolsFromServer(server)

        for (const tool of serverTools) {
          const generatedTool = generateToolFunction(tool, server, existingNames, callMcpTool)

          newTools.set(generatedTool.toolId, generatedTool)
        }
      } catch (error) {
        logger.error(`Failed to list tools from server ${server.name}:`, error as Error)
      }
    }

    this.tools = newTools
    this.lastRefresh = Date.now()

    logger.debug(`Tool registry refreshed with ${this.tools.size} tools`)
  }

  getToolCount(): number {
    return this.tools.size
  }
}
