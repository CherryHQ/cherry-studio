import { loggerService } from '@logger'
import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit'
import i18n from '@renderer/i18n'
import type { MCPConfig, MCPServer } from '@renderer/types'

const logger = loggerService.withContext('Store:MCP')

export const initialState: MCPConfig = {
  servers: [],
  isUvInstalled: true,
  isBunInstalled: true
}

const mcpSlice = createSlice({
  name: 'mcp',
  initialState,
  reducers: {
    setMCPServers: (state, action: PayloadAction<MCPServer[]>) => {
      state.servers = action.payload
    },
    addMCPServer: (state, action: PayloadAction<MCPServer>) => {
      state.servers.unshift(action.payload)
    },
    updateMCPServer: (state, action: PayloadAction<MCPServer>) => {
      const index = state.servers.findIndex((server) => server.id === action.payload.id)
      if (index !== -1) {
        state.servers[index] = action.payload
      }
    },
    deleteMCPServer: (state, action: PayloadAction<string>) => {
      state.servers = state.servers.filter((server) => server.id !== action.payload)
    },
    setMCPServerActive: (state, action: PayloadAction<{ id: string; isActive: boolean }>) => {
      const index = state.servers.findIndex((server) => server.id === action.payload.id)
      if (index !== -1) {
        state.servers[index].isActive = action.payload.isActive
      }
    },
    setIsUvInstalled: (state, action: PayloadAction<boolean>) => {
      state.isUvInstalled = action.payload
    },
    setIsBunInstalled: (state, action: PayloadAction<boolean>) => {
      state.isBunInstalled = action.payload
    }
  },
  selectors: {
    getActiveServers: (state) => {
      return state.servers.filter((server) => server.isActive)
    },
    getAllServers: (state) => state.servers
  }
})

export const {
  setMCPServers,
  addMCPServer,
  updateMCPServer,
  deleteMCPServer,
  setMCPServerActive,
  setIsBunInstalled,
  setIsUvInstalled
} = mcpSlice.actions

// Export the generated selectors from the slice
export const { getActiveServers, getAllServers } = mcpSlice.selectors

// Type-safe selector for accessing this slice from the root state
export const selectMCP = (state: { mcp: MCPConfig }) => state.mcp

export { mcpSlice }
// Export the reducer as default export
export default mcpSlice.reducer

export const builtinMCPServers: MCPServer[] = [
  {
    id: nanoid(),
    name: '@cherry/mcp-auto-install',
    reference: 'https://docs.cherry-ai.com/advanced-basic/mcp/auto-install',
    getBuiltinDescription: () => i18n.t('settings.mcp.builtinServersDescriptions.mcp_auto_install'),
    type: 'inMemory',
    command: 'npx',
    args: ['-y', '@mcpmarket/mcp-auto-install', 'connect', '--json'],
    isActive: false,
    provider: 'CherryAI'
  },
  {
    id: nanoid(),
    name: '@cherry/memory',
    reference: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    getBuiltinDescription: () => i18n.t('settings.mcp.builtinServersDescriptions.memory'),
    type: 'inMemory',
    isActive: true,
    env: {
      MEMORY_FILE_PATH: 'YOUR_MEMORY_FILE_PATH'
    },
    shouldConfig: true,
    provider: 'CherryAI'
  },
  {
    id: nanoid(),
    name: '@cherry/sequentialthinking',
    getBuiltinDescription: () => i18n.t('settings.mcp.builtinServersDescriptions.sequentialthinking'),
    type: 'inMemory',
    isActive: true,
    provider: 'CherryAI'
  },
  {
    id: nanoid(),
    name: '@cherry/brave-search',
    type: 'inMemory',
    getBuiltinDescription: () => i18n.t('settings.mcp.builtinServersDescriptions.brave_search'),
    isActive: false,
    env: {
      BRAVE_API_KEY: 'YOUR_API_KEY'
    },
    shouldConfig: true,
    provider: 'CherryAI'
  },
  {
    id: nanoid(),
    name: '@cherry/fetch',
    type: 'inMemory',
    getBuiltinDescription: () => i18n.t('settings.mcp.builtinServersDescriptions.fetch'),
    isActive: true,
    provider: 'CherryAI'
  },
  {
    id: nanoid(),
    name: '@cherry/filesystem',
    type: 'inMemory',
    getBuiltinDescription: () => i18n.t('settings.mcp.builtinServersDescriptions.filesystem'),
    args: ['/Users/username/Desktop', '/path/to/other/allowed/dir'],
    shouldConfig: true,
    isActive: false,
    provider: 'CherryAI'
  },
  {
    id: nanoid(),
    name: '@cherry/dify-knowledge',
    type: 'inMemory',
    getBuiltinDescription: () => i18n.t('settings.mcp.builtinServersDescriptions.dify_knowledge'),
    isActive: false,
    env: {
      DIFY_KEY: 'YOUR_DIFY_KEY'
    },
    shouldConfig: true,
    provider: 'CherryAI'
  },
  {
    id: nanoid(),
    name: '@cherry/python',
    type: 'inMemory',
    getBuiltinDescription: () => i18n.t('settings.mcp.builtinServersDescriptions.python'),
    isActive: false,
    provider: 'CherryAI'
  }
]

/**
 * Utility function to add servers to the MCP store during app initialization
 * @param servers Array of MCP servers to add
 * @param dispatch Redux dispatch function
 */
export const initializeMCPServers = (existingServers: MCPServer[], dispatch: (action: any) => void): void => {
  // Check if the existing servers already contain the built-in servers
  const serverIds = new Set(existingServers.map((server) => server.name))

  // Filter out any built-in servers that are already present
  const newServers = builtinMCPServers.filter((server) => !serverIds.has(server.name))

  logger.info('Adding new servers:', newServers)
  // Add the new built-in servers to the existing servers
  newServers.forEach((server) => {
    dispatch(addMCPServer(server))
  })
}
