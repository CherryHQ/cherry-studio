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
import { loggerService } from '@logger'
import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit'
import { type BuiltinMcpServer, BuiltinMcpServerNames, type McpConfig, type McpServer } from '@renderer/types'

const logger = loggerService.withContext('Store:MCP')
const filesystemManualApprovalTools = ['write', 'edit', 'delete'] as const

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

/**
 * Hub MCP server for auto mode - aggregates all MCP servers for LLM code mode.
 * This server is injected automatically when mcpMode === 'auto'.
 */
export const hubMcpServer: BuiltinMcpServer = {
  id: 'hub',
  name: BuiltinMcpServerNames.hub,
  type: 'inMemory',
  isActive: true,
  provider: 'CherryAI',
  installSource: 'builtin',
  isTrusted: true
}

/**
 * User-installable built-in MCP servers shown in the UI.
 *
 * Note: The `hub` server (@cherry/hub) is intentionally excluded because:
 * - It's a meta-server that aggregates all other MCP servers
 * - It's designed for LLM code mode, not direct user interaction
 * - It should be auto-enabled internally when needed, not manually installed
 */
export const builtinMcpServers: BuiltinMcpServer[] = [
  {
    id: nanoid(),
    name: BuiltinMcpServerNames.flomo,
    reference: 'https://flomoapp.com',
    type: 'inMemory',
    isActive: false,
    provider: 'flomo',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
    name: BuiltinMcpServerNames.mcpAutoInstall,
    reference: 'https://docs.cherry-ai.com/advanced-basic/mcp/auto-install',
    type: 'inMemory',
    command: 'npx',
    args: ['-y', '@mcpmarket/mcp-auto-install', 'connect', '--json'],
    isActive: false,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
    name: BuiltinMcpServerNames.memory,
    reference: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    type: 'inMemory',
    isActive: true,
    env: {
      MEMORY_FILE_PATH: 'YOUR_MEMORY_FILE_PATH'
    },
    shouldConfig: true,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
    name: BuiltinMcpServerNames.sequentialThinking,
    type: 'inMemory',
    isActive: true,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
    name: BuiltinMcpServerNames.braveSearch,
    type: 'inMemory',
    isActive: false,
    env: {
      BRAVE_API_KEY: 'YOUR_API_KEY'
    },
    shouldConfig: true,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
    name: BuiltinMcpServerNames.fetch,
    type: 'inMemory',
    isActive: true,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
    name: BuiltinMcpServerNames.filesystem,
    type: 'inMemory',
    args: ['/Users/username/Desktop'],
    disabledAutoApproveTools: [...filesystemManualApprovalTools],
    shouldConfig: true,
    isActive: false,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
    name: BuiltinMcpServerNames.difyKnowledge,
    type: 'inMemory',
    isActive: false,
    env: {
      DIFY_KEY: 'YOUR_DIFY_KEY'
    },
    shouldConfig: true,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
    name: BuiltinMcpServerNames.python,
    type: 'inMemory',
    isActive: false,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
    name: '@cherry/didi-mcp',
    reference: 'https://mcp.didichuxing.com/',
    type: 'inMemory',
    isActive: false,
    env: {
      DIDI_API_KEY: 'YOUR_DIDI_API_KEY'
    },
    shouldConfig: true,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
    name: BuiltinMcpServerNames.browser,
    type: 'inMemory',
    isActive: false,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
    name: BuiltinMcpServerNames.nowledgeMem,
    reference: 'https://mem.nowledge.co/',
    type: 'inMemory',
    isActive: false,
    provider: 'Nowledge',
    installSource: 'builtin',
    isTrusted: true
  }
] as const

/**
 * Utility function to add servers to the MCP store during app initialization
 * @param servers Array of MCP servers to add
 * @param dispatch Redux dispatch function
 */
export const initializeMcpServers = (existingServers: McpServer[], dispatch: (action: any) => void): void => {
  // Check if the existing servers already contain the built-in servers
  const serverIds = new Set(existingServers.map((server) => server.name))

  // Filter out any built-in servers that are already present
  const newServers = builtinMcpServers.filter((server) => !serverIds.has(server.name))

  logger.info('Adding new servers:', newServers)
  // Add the new built-in servers to the existing servers
  newServers.forEach((server) => {
    dispatch(addMcpServer(server))
  })
}
