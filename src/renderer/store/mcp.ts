/**
 * @deprecated Scheduled for removal in v2.0.0
 * --------------------------------------------------------------------------
 * ⚠️ NOTICE: V2 DATA&UI REFACTORING (by 0xfullex)
 * --------------------------------------------------------------------------
 * STOP: Feature PRs affecting this file are currently BLOCKED.
 * Only critical bug fixes are accepted during this migration phase.
 *
 * This file is being refactored to v2 standards.
 * Any non-critical changes will conflict with the ongoing work.
 *
 * 🔗 Context & Status:
 * - Contribution Hold: https://github.com/CherryHQ/cherry-studio/issues/10954
 * - v2 Refactor PR   : https://github.com/CherryHQ/cherry-studio/pull/10162
 * --------------------------------------------------------------------------
 */
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { McpConfig } from '@renderer/types/mcpTool'
import type { McpServer } from '@shared/data/types/mcpServer'

export const initialState: McpConfig = {
  servers: [],
  isUvInstalled: true,
  isBunInstalled: true
}

const mcpSlice = createSlice({
  name: 'mcp',
  initialState,
  reducers: {
    setMcpServers: (state, action: PayloadAction<McpServer[]>) => {
      state.servers = action.payload
    },
    addMcpServer: (state, action: PayloadAction<McpServer>) => {
      state.servers.unshift(action.payload)
    },
    updateMcpServer: (state, action: PayloadAction<McpServer>) => {
      const index = state.servers.findIndex((server) => server.id === action.payload.id)
      if (index !== -1) {
        state.servers[index] = action.payload
      }
    },
    deleteMcpServer: (state, action: PayloadAction<string>) => {
      state.servers = state.servers.filter((server) => server.id !== action.payload)
    },
    setMcpServerActive: (state, action: PayloadAction<{ id: string; isActive: boolean }>) => {
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
  setMcpServers,
  addMcpServer,
  updateMcpServer,
  deleteMcpServer,
  setMcpServerActive,
  setIsBunInstalled,
  setIsUvInstalled
} = mcpSlice.actions

// Export the generated selectors from the slice
export const { getActiveServers, getAllServers } = mcpSlice.selectors

// Type-safe selector for accessing this slice from the root state
export const selectMcp = (state: { mcp: McpConfig }) => state.mcp

export { mcpSlice }
// Export the reducer as default export
export default mcpSlice.reducer
