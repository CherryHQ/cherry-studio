import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js'
import { ContentBlockSchema } from '@modelcontextprotocol/sdk/types.js'
import type { McpServer } from '@shared/data/types/mcpServer'

export const BuiltinMcpServerNames = {
  flomo: '@cherry/flomo',
  mcpAutoInstall: '@cherry/mcp-auto-install',
  memory: '@cherry/memory',
  sequentialThinking: '@cherry/sequentialthinking',
  braveSearch: '@cherry/brave-search',
  fetch: '@cherry/fetch',
  filesystem: '@cherry/filesystem',
  difyKnowledge: '@cherry/dify-knowledge',
  python: '@cherry/python',
  didiMcp: '@cherry/didi-mcp',
  browser: '@cherry/browser',
  nowledgeMem: '@cherry/nowledge-mem',
  hub: '@cherry/hub'
} as const

export type BuiltinMcpServerName = (typeof BuiltinMcpServerNames)[keyof typeof BuiltinMcpServerNames]

export const BuiltinMcpServerNamesArray = Object.values(BuiltinMcpServerNames)

export const isBuiltinMcpServerName = (name: string): name is BuiltinMcpServerName => {
  return BuiltinMcpServerNamesArray.some((n) => n === name)
}

export type BuiltinMcpServer = McpServer & {
  type: 'inMemory'
  name: BuiltinMcpServerName
}

export const isBuiltinMcpServer = (server: McpServer): server is BuiltinMcpServer => {
  return server.type === 'inMemory' && isBuiltinMcpServerName(server.name)
}

/**
 * Spec-aligned guard for a single MCP `CallToolResult` content block
 * (text / image / audio / resource_link / embedded resource).
 */
export const isMcpContentBlock = (value: unknown): value is ContentBlock => {
  return ContentBlockSchema.safeParse(value).success
}
