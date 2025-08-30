import * as z from 'zod/v4'

import type { KnowledgeReference } from './knowledge'
import type { MemoryItem } from './memory'
import type { WebSearchResponse } from './websearch'

export type MCPTool = {
  id: string
  serverId: string
  serverName: string
  name: string
  description?: string
  inputSchema: MCPToolInputSchema
  outputSchema?: z.infer<typeof MCPToolOutputSchema>
  isBuiltIn?: boolean // 标识是否为内置工具，内置工具不需要通过MCP协议调用
}
export type MCPPromptArguments = {
  name: string
  description?: string
  required?: boolean
}
export type MCPPrompt = {
  id: string
  name: string
  description?: string
  arguments?: MCPPromptArguments[]
  serverId: string
  serverName: string
}
export type GetMCPPromptResponse = {
  description?: string
  messages: {
    role: string
    content: {
      type: 'text' | 'image' | 'audio' | 'resource'
      text?: string
      data?: string
      mimeType?: string
    }
  }[]
}
export type MCPConfig = {
  servers: MCPServer[]
  isUvInstalled: boolean
  isBunInstalled: boolean
}
export type MCPToolResponseStatus = 'pending' | 'cancelled' | 'invoking' | 'done' | 'error'
export const MCPToolOutputSchema = z.object({
  type: z.literal('object'),
  properties: z.record(z.string(), z.unknown()),
  required: z.array(z.string())
})
export type MCPToolResponse = ToolUseResponse | ToolCallResponse
export type MCPToolResultContent = {
  type: 'text' | 'image' | 'audio' | 'resource'
  text?: string
  data?: string
  mimeType?: string
  resource?: {
    uri?: string
    text?: string
    mimeType?: string
    blob?: string
  }
}
export type MCPCallToolResponse = {
  content: MCPToolResultContent[]
  isError?: boolean
}
export type MCPResource = {
  serverId: string
  serverName: string
  uri: string
  name: string
  description?: string
  mimeType?: string
  size?: number
  text?: string
  blob?: string
}
export type GetResourceResponse = {
  contents: MCPResource[]
}
export type BaseToolResponse = {
  id: string // unique id
  tool: MCPTool
  arguments: Record<string, unknown> | undefined
  status: MCPToolResponseStatus
  response?: any
}
export type ToolUseResponse = BaseToolResponse & {
  toolUseId: string
}
export type ToolCallResponse = BaseToolResponse & {
  // gemini tool call id might be undefined
  toolCallId?: string
}
export type MCPServer = {
  id: string
  name: string
  type?: 'stdio' | 'sse' | 'inMemory' | 'streamableHttp'
  description?: string
  baseUrl?: string
  command?: string
  registryUrl?: string
  args?: string[]
  env?: Record<string, string>
  shouldConfig?: boolean
  isActive: boolean
  disabledTools?: string[] // List of tool names that are disabled for this server
  disabledAutoApproveTools?: string[] // Whether to auto-approve tools for this server
  configSample?: MCPConfigSample
  headers?: Record<string, string> // Custom headers to be sent with requests to this server
  searchKey?: string
  provider?: string // Provider name for this server like ModelScope, Higress, etc.
  providerUrl?: string // URL of the MCP server in provider's website or documentation
  logoUrl?: string // URL of the MCP server's logo
  tags?: string[] // List of tags associated with this server
  longRunning?: boolean // Whether the server is long running
  timeout?: number // Timeout in seconds for requests to this server, default is 60 seconds
  dxtVersion?: string // Version of the DXT package
  dxtPath?: string // Path where the DXT package was extracted
  reference?: string // Reference link for the server, e.g., documentation or homepage
}
export type BuiltinMCPServer = MCPServer & {
  type: 'inMemory'
  name: BuiltinMCPServerName
}
export const isBuiltinMCPServer = (server: MCPServer): server is BuiltinMCPServer => {
  return server.type === 'inMemory' && isBuiltinMCPServerName(server.name)
}
export const BuiltinMCPServerNames = {
  mcpAutoInstall: '@cherry/mcp-auto-install',
  memory: '@cherry/memory',
  sequentialThinking: '@cherry/sequentialthinking',
  braveSearch: '@cherry/brave-search',
  fetch: '@cherry/fetch',
  filesystem: '@cherry/filesystem',
  difyKnowledge: '@cherry/dify-knowledge',
  python: '@cherry/python'
} as const
export type MCPConfigSample = {
  command: string
  args: string[]
  env?: Record<string, string> | undefined
}
export type MCPArgType = 'string' | 'list' | 'number'
export type MCPEnvType = 'string' | 'number'
export type MCPArgParameter = { [key: string]: MCPArgType }
export type MCPEnvParameter = { [key: string]: MCPEnvType }
export type MCPServerParameter = {
  name: string
  type: MCPArgType | MCPEnvType
  description: string
}
export type BuiltinMCPServerName = (typeof BuiltinMCPServerNames)[keyof typeof BuiltinMCPServerNames]
export const BuiltinMCPServerNamesArray = Object.values(BuiltinMCPServerNames)
export const isBuiltinMCPServerName = (name: string): name is BuiltinMCPServerName => {
  return BuiltinMCPServerNamesArray.some((n) => n === name)
}
export type MCPToolInputSchema = {
  type: string
  title: string
  description?: string
  required?: string[]
  properties: Record<string, object>
}
export type ExternalToolResult = {
  mcpTools?: MCPTool[]
  toolUse?: MCPToolResponse[]
  webSearch?: WebSearchResponse
  knowledge?: KnowledgeReference[]
  memories?: MemoryItem[]
}
