import type { MCPServer } from '@renderer/types'

// MCProuter API configuration
export const MCPROUTER_API_HOST = 'https://api.mcprouter.to'
export const MCPROUTER_LIST_SERVERS_URL = `${MCPROUTER_API_HOST}/v1/list-servers`

// Token storage key
const MCPROUTER_TOKEN_KEY = 'mcprouter_api_token'

// MCProuter server interface based on API response
interface MCProuterServer {
  created_at: string
  updated_at: string
  name: string
  author_name: string
  title: string
  description: string
  content: string
  server_key: string
  config_name: string
}

// MCProuter API response interface
interface MCProuterResponse {
  code: number
  message: string
  data: {
    servers: MCProuterServer[]
  }
}

// Sync result interface
interface SyncResult {
  success: boolean
  message: string
  addedServers: MCPServer[]
  errorDetails?: string
}

// Token management functions
export const saveMCProuterToken = (token: string): void => {
  localStorage.setItem(MCPROUTER_TOKEN_KEY, token)
}

export const getMCProuterToken = (): string | null => {
  return localStorage.getItem(MCPROUTER_TOKEN_KEY)
}

export const clearMCProuterToken = (): void => {
  localStorage.removeItem(MCPROUTER_TOKEN_KEY)
}

export const hasMCProuterToken = (): boolean => {
  return !!getMCProuterToken()
}

// Transform MCProuter server to MCPServer format
const transformToMCPServer = (server: MCProuterServer): MCPServer => {
  const token = getMCProuterToken()
  return {
    id: `@mcprouter/${server.server_key}`,
    name: server.name,
    description: server.description,
    type: 'streamableHttp',
    baseUrl: `https://mcprouter.to/${server.server_key}`,
    isActive: true,
    headers: {
      Authorization: `Bearer ${token}`
    }
  }
}

// Main sync function
export const syncMCProuterServers = async (token: string, existingServers: MCPServer[]): Promise<SyncResult> => {
  try {
    if (!token?.trim()) {
      return {
        success: false,
        message: 'API token is required',
        addedServers: []
      }
    }

    // Make API request
    const response = await fetch(MCPROUTER_LIST_SERVERS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': window.location.origin,
        'X-Title': 'Cherry Studio'
      },
      body: JSON.stringify({})
    })

    // Handle authentication errors
    if (response.status === 401 || response.status === 403) {
      clearMCProuterToken()
      return {
        success: false,
        message: 'Invalid API token. Please check your token and try again.',
        addedServers: [],
        errorDetails: 'Authentication failed'
      }
    }

    // Handle other HTTP errors
    if (!response.ok) {
      return {
        success: false,
        message: `Server error (${response.status}). Please try again later.`,
        addedServers: [],
        errorDetails: `HTTP ${response.status}: ${response.statusText}`
      }
    }

    // Parse response
    const data: MCProuterResponse = await response.json()

    // Check API response format
    if (data.code !== 0) {
      return {
        success: false,
        message: data.message || 'API request failed',
        addedServers: [],
        errorDetails: `API error code: ${data.code}`
      }
    }

    // Get servers from response
    const servers = data.data?.servers || []

    if (servers.length === 0) {
      return {
        success: true,
        message: 'No servers found in your MCProuter account',
        addedServers: []
      }
    }

    // Transform and filter servers
    const addedServers: MCPServer[] = []
    const existingIds = new Set(existingServers.map((s) => s.id))

    for (const server of servers) {
      const mcpServer = transformToMCPServer(server)

      // Skip if server already exists
      if (existingIds.has(mcpServer.id)) {
        continue
      }

      addedServers.push(mcpServer)
    }

    // Return results
    if (addedServers.length === 0) {
      return {
        success: true,
        message: 'All MCProuter servers are already synced',
        addedServers: []
      }
    }

    return {
      success: true,
      message: `Successfully synced ${addedServers.length} server${addedServers.length === 1 ? '' : 's'} from MCProuter`,
      addedServers
    }
  } catch (error: any) {
    console.error('MCProuter sync error:', error)

    return {
      success: false,
      message: 'Failed to connect to MCProuter. Please check your network connection.',
      addedServers: [],
      errorDetails: error.message
    }
  }
}
