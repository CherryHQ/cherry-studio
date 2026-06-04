import { loggerService } from '@logger'
import { nanoid } from '@reduxjs/toolkit'
import type { McpServer } from '@renderer/types'
import i18next from 'i18next'

const logger = loggerService.withContext('McpRouterSyncUtils')

// Token storage constants and utilities
const TOKEN_STORAGE_KEY = 'mcprouter_token'
export const MCPROUTER_HOST = 'https://mcprouter.co'

export const saveMcpRouterToken = (token: string): void => {
  localStorage.setItem(TOKEN_STORAGE_KEY, token)
}

export const getMcpRouterToken = (): string | null => {
  return localStorage.getItem(TOKEN_STORAGE_KEY)
}

export const clearMcpRouterToken = (): void => {
  localStorage.removeItem(TOKEN_STORAGE_KEY)
}

export const hasMcpRouterToken = (): boolean => {
  return !!getMcpRouterToken()
}

interface McpRouterServer {
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

interface McpRouterSyncResult {
  success: boolean
  message: string
  allServers: McpServer[]
  errorDetails?: string
}

// Function to fetch and process McpRouter servers
export const syncMcpRouterServers = async (token: string): Promise<McpRouterSyncResult> => {
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
      clearMcpRouterToken()
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
    const servers: McpRouterServer[] = data.data?.servers || []

    if (servers.length === 0) {
      return {
        success: true,
        message: t('settings.mcp.sync.noServersAvailable', 'No MCP servers available'),
        allServers: []
      }
    }

    // Transform McpRouter servers to MCP servers format
    const allServers: McpServer[] = []
    for (const server of servers) {
      try {
        const mcpServer: McpServer = {
          id: `@mcprouter/${server.server_key}`,
          name: server.title || server.name || `McpRouter Server ${nanoid()}`,
          description: server.description || '',
          type: 'streamableHttp',
          baseUrl: server.server_url,
          isActive: true,
          provider: 'McpRouter',
          providerUrl: `https://mcprouter.co/${server.server_key}`,
          logoUrl: '',
          tags: [],
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
        allServers.push(mcpServer)
      } catch (err) {
        logger.error('Error processing McpRouter server:', err as Error)
      }
    }

    return {
      success: true,
      message: t('settings.mcp.sync.success', { count: allServers.length }),
      allServers
    }
  } catch (error) {
    logger.error('McpRouter sync error:', error as Error)
    return {
      success: false,
      message: t('settings.mcp.sync.error'),
      allServers: [],
      errorDetails: String(error)
    }
  }
}
