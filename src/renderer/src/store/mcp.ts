import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { MCPConfig, MCPServer } from '@renderer/types'

const initialState: MCPConfig = {
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
      state.servers.push(action.payload)
    },
    updateMCPServer: (state, action: PayloadAction<MCPServer>) => {
      const index = state.servers.findIndex((server) => server.name === action.payload.name)
      if (index !== -1) {
        state.servers[index] = action.payload
      }
    },
    deleteMCPServer: (state, action: PayloadAction<string>) => {
      state.servers = state.servers.filter((server) => server.name !== action.payload)
    },
    setMCPServerActive: (state, action: PayloadAction<{ name: string; isActive: boolean }>) => {
      const index = state.servers.findIndex((server) => server.name === action.payload.name)
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

// Export the reducer as default export
export default mcpSlice.reducer
