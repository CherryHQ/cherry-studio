import { loggerService } from '@logger'
import { nanoid } from '@reduxjs/toolkit'
import type { MCPServer } from '@renderer/types'
import i18next from 'i18next'

const logger = loggerService.withContext('MCPRouterSyncUtils')

// Token storage constants and utilities
const TOKEN_STORAGE_KEY = 'mcprouter_token'
export const MCPROUTER_HOST = 'https://mcprouter.co'

export const saveMCPRouterToken = (token: string): void => {
  localStorage.setItem(TOKEN_STORAGE_KEY, token)
}

export const getMCPRouterToken = (): string | null => {
  return localStorage.getItem(TOKEN_STORAGE_KEY)
}

export const clearMCPRouterToken = (): void => {
  localStorage.removeItem(TOKEN_STORAGE_KEY)
}

export const hasMCPRouterToken = (): boolean => {
  return !!getMCPRouterToken()
}

interface MCPRouterServer {
  created_at: string
  updated_at: string
  name: string
  author_name?: string
  title?: string
  description?: string
  content?: string
  server_key: string
  config_name: string
  server_url: string
}

interface MCPRouterSyncResult {
  success: boolean
  message: string
  allServers: MCPServer[]
  errorDetails?: string
}

// Function to fetch and process MCPRouter servers
export const syncMCPRouterServers = async (token: string): Promise<MCPRouterSyncResult> => {
  const t = i18next.t

  try {
    const response = await fetch('https://api.mcprouter.to/v1/list-servers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'HTTP-Referer': 'https://cherry-ai.com',
        'X-Title': 'Cherry Studio'
      },
      body: JSON.stringify({})
    })

    // Handle authentication errors
    if (response.status === 401 || response.status === 403) {
      clearMCPRouterToken()
      return {
        success: false,
        message: t('settings.mcp.sync.unauthorized', 'Sync Unauthorized'),
        allServers: []
      }
    }

    // Handle server errors
    if (response.status === 500 || !response.ok) {
      return {
        success: false,
        message: t('settings.mcp.sync.error'),
        allServers: [],
        errorDetails: `Status: ${response.status}`
      }
    }

    // Process successful response
    const data = await response.json()
    const servers: MCPRouterServer[] = data.data?.servers || []

    if (servers.length === 0) {
      return {
        success: true,
        message: t('settings.mcp.sync.noServersAvailable', 'No MCP servers available'),
        allServers: []
      }
    }

    // Transform MCPRouter servers to MCP servers format
    const allServers: MCPServer[] = []
    for (const server of servers) {
      try {
        const mcpServer: MCPServer = {
          id: `@mcprouter/${server.server_key}`,
          name: server.title || server.name || `MCPRouter Server ${nanoid()}`,
          description: server.description || '',
          type: 'streamableHttp',
          baseUrl: server.server_url,
          isActive: true,
          provider: 'MCPRouter',
          providerUrl: `https://mcprouter.co/${server.server_key}`,
          logoUrl: '',
          tags: [],
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
        allServers.push(mcpServer)
      } catch (err) {
        logger.error('Error processing MCPRouter server:', err as Error)
      }
    }

    return {
      success: true,
      message: t('settings.mcp.sync.success', { count: allServers.length }),
      allServers
    }
  } catch (error) {
    logger.error('MCPRouter sync error:', error as Error)
    return {
      success: false,
      message: t('settings.mcp.sync.error'),
      allServers: [],
      errorDetails: String(error)
    }
  }
}
