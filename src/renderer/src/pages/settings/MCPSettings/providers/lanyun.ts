import type { MCPServer } from '@renderer/types'
import i18next from 'i18next'

// Token storage constants and utilities
const TOKEN_STORAGE_KEY = 'tokenLanyunToken'
export const TOKENLANYUN_HOST = 'https://mcp.lanyun.net'
export const LANYUN_MCP_HOST = TOKENLANYUN_HOST + '/mcp/manager/selectListByApiKey'
export const LANYUN_KEY_HOST = TOKENLANYUN_HOST + '/#/manage/apiKey'

export const saveTokenLanYunToken = (token: string): void => {
  localStorage.setItem(TOKEN_STORAGE_KEY, token)
}

export const getTokenLanYunToken = (): string | null => {
  return localStorage.getItem(TOKEN_STORAGE_KEY)
}

export const clearTokenLanYunToken = (): void => {
  localStorage.removeItem(TOKEN_STORAGE_KEY)
}

export const hasTokenLanYunToken = (): boolean => {
  return !!getTokenLanYunToken()
}

interface TokenLanYunServer {
  id: string
  /**
   * locales 字段用于存储多语言信息。
   * 其中 key（lang）为语言代码（如 'zh', 'en'），
   * value 为该语言下的 name 和 description。
   * 例如：
   * {
   *   "zh": { name: "文档处理工具", description: "..." },
   *   "en": { name: "Document Processor", description: "..." }
   * }
   */
  locales?: {
    [lang: string]: {
      description?: string
      name?: string
    }
  }
  chineseName?: string
  description?: string
  operationalUrls?: { url: string }[]
  tags?: string[]
  logoUrl?: string
}

interface TokenLanYunSyncResult {
  success: boolean
  message: string
  addedServers: MCPServer[]
  errorDetails?: string
}

// Function to fetch and process TokenLanYun servers
export const syncTokenLanYunServers = async (
  token: string,
  existingServers: MCPServer[]
): Promise<TokenLanYunSyncResult> => {
  const t = i18next.t

  try {
    const response = await fetch(LANYUN_MCP_HOST, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      }
    })

    // Handle authentication errors
    if (response.status === 401 || response.status === 403) {
      clearTokenLanYunToken()
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
    if (data.code === 401) {
      return {
        success: false,
        message: t('settings.mcp.sync.unauthorized', 'Sync Unauthorized'),
        addedServers: [],
        errorDetails: `Status: ${response.status}`
      }
    }
    if (data.code === 500) {
      return {
        success: false,
        message: t('settings.mcp.sync.error'),
        addedServers: [],
        errorDetails: `Status: ${response.status}`
      }
    }

    const servers: TokenLanYunServer[] = data.data || []

    if (servers.length === 0) {
      return {
        success: true,
        message: t('settings.mcp.sync.noServersAvailable', 'No MCP servers available'),
        addedServers: []
      }
    }

    // Transform Token servers to MCP servers format
    const addedServers: MCPServer[] = []
    console.log('TokenLanYun servers:', servers)
    for (const server of servers) {
      try {
        if (!server.operationalUrls?.[0]?.url) continue

        // If any existing server id contains '@lanyun', clear them before adding new ones
        // if (existingServers.some((s) => s.id.startsWith('@lanyun'))) {
        //   for (let i = existingServers.length - 1; i >= 0; i--) {
        //     if (existingServers[i].id.startsWith('@lanyun')) {
        //       existingServers.splice(i, 1)
        //     }
        //   }
        // }
        // Skip if server already exists after clearing
        if (existingServers.some((s) => s.id === `@lanyun/${server.id}`)) continue

        const mcpServer: MCPServer = {
          id: `@lanyun/${server.id}`,
          name:
            server.chineseName || server.locales?.zh?.name || server.locales?.en?.name || `LanYun Server ${server.id}`,
          description: server.description || '',
          type: 'sse',
          baseUrl: server.operationalUrls[0].url,
          command: '',
          args: [],
          env: {},
          isActive: true,
          provider: '蓝耘科技',
          providerUrl: server.operationalUrls[0].url,
          logoUrl: server.logoUrl || '',
          tags: server.tags ?? (server.chineseName ? [server.chineseName] : [])
        }

        addedServers.push(mcpServer)
      } catch (err) {
        console.error('Error processing LanYun server:', err)
      }
    }

    return {
      success: true,
      message: t('settings.mcp.sync.success', { count: addedServers.length }),
      addedServers
    }
  } catch (error) {
    console.error('TokenLanyun sync error:', error)
    return {
      success: false,
      message: t('settings.mcp.sync.error'),
      addedServers: [],
      errorDetails: String(error)
    }
  }
}
