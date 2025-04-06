import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit'
import type { MCPConfig, MCPServer } from '@renderer/types'

export const initialState: MCPConfig = {
  servers: []
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
    }
  },
  selectors: {
    getActiveServers: (state) => {
      return state.servers.filter((server) => server.isActive)
    },
    getAllServers: (state) => state.servers
  }
})

export const { setMCPServers, addMCPServer, updateMCPServer, deleteMCPServer, setMCPServerActive } = mcpSlice.actions

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
    description: 'Automatically install MCP services (Beta version)',
    command: 'npx',
    args: ['-y', '@mcpmarket/mcp-auto-install', 'connect', '--json'],
    isActive: false
  },
  {
    id: nanoid(),
    name: '@cherry/memory',
    type: 'inMemory',
    description:
      'A basic implementation of persistent memory using a local knowledge graph. This lets Claude remember information about the user across chats. https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    isActive: true
  },
  {
    id: nanoid(),
    name: '@cherry/sequentialthinking',
    type: 'inMemory',
    description:
      'An MCP server implementation that provides a tool for dynamic and reflective problem-solving through a structured thinking process.',
    isActive: true
  },
  {
    id: nanoid(),
    name: '@cherry/brave-search',
    type: 'inMemory',
    description:
      'An MCP server implementation that integrates the Brave Search API, providing both web and local search capabilities.',
    isActive: false
  },
  {
    id: nanoid(),
    name: '@cherry/everything',
    type: 'inMemory',
    description:
      'This MCP server attempts to exercise all the features of the MCP protocol. It is not intended to be a useful server, but rather a test server for builders of MCP clients. It implements prompts, tools, resources, sampling, and more to showcase MCP capabilities.',
    isActive: true
  },
  {
    id: nanoid(),
    name: '@cherry/fetch',
    type: 'inMemory',
    description: 'An MCP server for fetching URLs / Youtube video transcript.',
    isActive: true
  },
  {
    id: nanoid(),
    name: '@cherry/filesystem',
    type: 'inMemory',
    description: 'Node.js server implementing Model Context Protocol (MCP) for filesystem operations.',
    isActive: false
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

  console.log('Adding new servers:', newServers)
  // Add the new built-in servers to the existing servers
  newServers.forEach((server) => {
    dispatch(addMCPServer(server))
  })
}
