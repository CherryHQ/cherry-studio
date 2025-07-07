import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit'
import Logger from '@renderer/config/logger'
import type { MCPConfig, MCPServer } from '@renderer/types'

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
    description: '自动安装 MCP 服务（测试版）https://docs.cherry-ai.com/advanced-basic/mcp/auto-install',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@mcpmarket/mcp-auto-install', 'connect', '--json'],
    isActive: false,
    provider: 'CherryAI'
  },
  {
    id: nanoid(),
    name: '@cherry/memory',
    type: 'inMemory',
    description:
      '基于本地知识图谱的持久性记忆基础实现。这使得模型能够在不同对话间记住用户的相关信息。需要配置 MEMORY_FILE_PATH 环境变量。https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    isActive: true,
    env: {
      MEMORY_FILE_PATH: 'YOUR_MEMORY_FILE_PATH'
    },
    provider: 'CherryAI'
  },
  {
    id: nanoid(),
    name: '@cherry/sequentialthinking',
    type: 'inMemory',
    description: '一个 MCP 服务器实现，提供了通过结构化思维过程进行动态和反思性问题解决的工具',
    isActive: true,
    provider: 'CherryAI'
  },
  {
    id: nanoid(),
    name: '@cherry/brave-search',
    type: 'inMemory',
    description:
      '一个集成了Brave 搜索 API 的 MCP 服务器实现，提供网页与本地搜索双重功能。需要配置 BRAVE_API_KEY 环境变量',
    isActive: false,
    env: {
      BRAVE_API_KEY: 'YOUR_API_KEY'
    },
    provider: 'CherryAI'
  },
  {
    id: nanoid(),
    name: '@cherry/fetch',
    type: 'inMemory',
    description: '用于获取 URL 网页内容的 MCP 服务器',
    isActive: true,
    provider: 'CherryAI'
  },
  {
    id: nanoid(),
    name: '@cherry/filesystem',
    type: 'inMemory',
    description: '实现文件系统操作的模型上下文协议（MCP）的 Node.js 服务器',
    args: ['/Users/username/Desktop', '/path/to/other/allowed/dir'],
    isActive: false,
    provider: 'CherryAI'
  },
  {
    id: nanoid(),
    name: '@cherry/dify-knowledge',
    type: 'inMemory',
    description: 'Dify 的 MCP 服务器实现，提供了一个简单的 API 来与 Dify 进行交互',
    isActive: false,
    env: {
      DIFY_KEY: 'YOUR_DIFY_KEY'
    },
    provider: 'CherryAI'
  },
  {
    id: nanoid(),
    name: '@cherry/python',
    type: 'inMemory',
    description: '在安全的沙盒环境中执行 Python 代码。使用 Pyodide 运行 Python，支持大多数标准库和科学计算包',
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

  Logger.log('[initializeMCPServers] Adding new servers:', newServers)
  // Add the new built-in servers to the existing servers
  newServers.forEach((server) => {
    dispatch(addMCPServer(server))
  })
}
