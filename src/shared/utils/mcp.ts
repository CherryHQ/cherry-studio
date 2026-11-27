import { ContentBlockSchema } from '@modelcontextprotocol/core'
import type * as z from 'zod'

import { type Assistant, DEFAULT_MCP_MODE, type McpMode } from '@shared/data/types/assistant'
import type { McpServer } from '@shared/data/types/mcpServer'

type ContentBlock = z.infer<typeof ContentBlockSchema>

export const BuiltinMcpServerNames = {
  flomo: '@cherry/flomo',
  qveris: '@cherry/qveris',
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
  type: 'inMemory' | 'stdio'
  name: BuiltinMcpServerName
}

export const isInMemoryBuiltinMcpServer = (server: McpServer): server is BuiltinMcpServer & { type: 'inMemory' } => {
  return server.type === 'inMemory' && isBuiltinMcpServerName(server.name)
}

/** `settings.mcpMode` if set; else the shared default ('manual' — only linked
 *  servers; with zero links that resolves to no tools, same as 'disabled'). */
export function getEffectiveMcpMode(assistant: Pick<Assistant, 'settings'>): McpMode {
  return assistant.settings?.mcpMode ?? DEFAULT_MCP_MODE
}

export const isBrowserMcpServer = (server: Pick<McpServer, 'type' | 'name'>): boolean =>
  server.type === 'inMemory' && server.name === BuiltinMcpServerNames.browser

/**
 * Spec-aligned guard for a single MCP `CallToolResult` content block
 * (text / image / audio / resource_link / embedded resource).
 */
export const isMcpContentBlock = (value: unknown): value is ContentBlock => {
  return ContentBlockSchema.safeParse(value).success
}
