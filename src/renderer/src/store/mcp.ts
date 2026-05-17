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
import { type BuiltinMCPServer, BuiltinMCPServerNames, type MCPConfig, type MCPServer } from '@renderer/types'

const logger = loggerService.withContext('Store:MCP')
const filesystemManualApprovalTools = ['write', 'edit', 'delete'] as const

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

/**
 * Hub MCP server for auto mode - aggregates all MCP servers for LLM code mode.
 * This server is injected automatically when mcpMode === 'auto'.
 */
export const hubMCPServer: BuiltinMCPServer = {
  id: 'hub',
  name: BuiltinMCPServerNames.hub,
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
export const builtinMCPServers: MCPServer[] = [
  {
    id: nanoid(),
    name: BuiltinMCPServerNames.flomo,
    reference: 'https://flomoapp.com',
    type: 'inMemory',
    isActive: false,
    provider: 'flomo',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
    name: BuiltinMCPServerNames.mcpAutoInstall,
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
    name: BuiltinMCPServerNames.memory,
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
    name: BuiltinMCPServerNames.sequentialThinking,
    type: 'inMemory',
    isActive: true,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
    name: BuiltinMCPServerNames.braveSearch,
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
    name: BuiltinMCPServerNames.fetch,
    type: 'inMemory',
    isActive: true,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
    name: BuiltinMCPServerNames.filesystem,
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
    name: BuiltinMCPServerNames.difyKnowledge,
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
    name: BuiltinMCPServerNames.python,
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
    name: BuiltinMCPServerNames.browser,
    type: 'inMemory',
    isActive: false,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
    name: 'GitHub',
    description: '连接你的 GitHub 仓库、Issue、PR 和 Actions。填入 GitHub PAT 后即可直接使用。',
    reference: 'https://github.com/github/github-mcp-server',
    type: 'streamableHttp',
    baseUrl: 'https://api.githubcopilot.com/mcp/',
    headers: {
      Authorization: 'Bearer YOUR_GITHUB_PERSONAL_ACCESS_TOKEN'
    },
    shouldConfig: true,
    isActive: false,
    provider: 'GitHub',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
    name: 'Gmail',
    description: '连接你的 Gmail 收件箱与发信能力。首次配置后可读邮件、搜索邮件、发送邮件。',
    reference: 'https://www.npmjs.com/package/@mjamei/gmail-mcp',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@mjamei/gmail-mcp'],
    env: {
      GOOGLE_CLIENT_ID: 'YOUR_GOOGLE_CLIENT_ID',
      GOOGLE_CLIENT_SECRET: 'YOUR_GOOGLE_CLIENT_SECRET'
    },
    shouldConfig: true,
    isActive: false,
    provider: 'Google',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
    name: 'Hugging Face',
    description: '连接你的 Hugging Face 账号与推理能力。填入 Access Token 后即可调用相关工具。',
    reference: 'https://npm.io/package/huggingface-mcp-server',
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'huggingface-mcp-server', '--transport', 'stdio'],
    env: {
      HUGGINGFACE_API_KEY: 'YOUR_HUGGINGFACE_API_KEY'
    },
    shouldConfig: true,
    isActive: false,
    provider: 'Hugging Face',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
    name: BuiltinMCPServerNames.nowledgeMem,
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
