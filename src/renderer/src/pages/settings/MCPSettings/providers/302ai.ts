import { nanoid } from '@reduxjs/toolkit'
import type { MCPServer } from '@renderer/types'
import i18next from 'i18next'

// Token storage constants and utilities
const TOKEN_STORAGE_KEY = 'ai302_token'
export const AI302_HOST = 'https://api.302.ai/mcp'

export const saveAI302Token = (token: string): void => {
  localStorage.setItem(TOKEN_STORAGE_KEY, token)
}

export const getAI302Token = (): string | null => {
  return localStorage.getItem(TOKEN_STORAGE_KEY)
}

export const clearAI302Token = (): void => {
  localStorage.removeItem(TOKEN_STORAGE_KEY)
}

export const hasAI302Token = (): boolean => {
  return !!getAI302Token()
}

interface Ai302SyncResult {
  success: boolean
  message: string
  addedServers: MCPServer[]
  errorDetails?: string
}

// Function to fetch and process 302ai servers
export const syncAi302Servers = async (token: string, existingServers: MCPServer[]): Promise<Ai302SyncResult> => {
  const t = i18next.t

  try {
    const response = await fetch(`${AI302_HOST}/v1/mcps/list?baseUrl=https://api.302.ai/custom-mcp/mcp`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': token
      }
    })

    // Handle authentication errors
    if (response.status === 401 || response.status === 403) {
      clearAI302Token()
      return {
        success: false,
        message: t('settings.mcp.sync.unauthorized', 'Sync Unauthorized'),
        addedServers: []
      }
    }

    // Handle server errors
    if (response.status === 500 || !response.ok) {
      return {
        success: false,
        message: t('settings.mcp.sync.error'),
        addedServers: [],
        errorDetails: `Status: ${response.status}`
      }
    }

    // Process successful response
    const data = await response.json()
    const servers: MCPServer[] = data.mcps || []
    console.log('servers', servers)

    if (servers.length === 0) {
      return {
        success: true,
        message: t('settings.mcp.sync.noServersAvailable', 'No MCP servers available'),
        addedServers: []
      }
    }

    // Transform TokenFlux servers to MCP servers format
    const addedServers: MCPServer[] = []

    for (const server of servers) {
      try {
        // Skip if server already exists
        if (existingServers.some((s) => s.id === `@302ai/${server.name}`)) continue
        const mcpServer: MCPServer = {
          id: `@302ai/${server.name}`,
          name: server.name || `302ai Server ${nanoid()}`,
          description: server.description || '',
          type: server.type,
          baseUrl: server.baseUrl,
          isActive: server.isActive,
          provider: server.provider,
          providerUrl: server.providerUrl,
          tags: server.tags,
          logoUrl: server.logoUrl
        }

        addedServers.push(mcpServer)
      } catch (err) {
        console.error('Error processing 302ai server:', err)
      }
    }

    return {
      success: true,
      message: t('settings.mcp.sync.success', { count: addedServers.length }),
      addedServers
    }
  } catch (error) {
    console.error('302ai sync error:', error)
    return {
      success: false,
      message: t('settings.mcp.sync.error'),
      addedServers: [],
      errorDetails: String(error)
    }
  }
}
