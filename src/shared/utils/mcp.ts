import { ContentBlockSchema } from '@modelcontextprotocol/core'
import type * as z from 'zod'

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

/**
 * The Cherry-owned agent MCP servers. Which of them a session mounts is the runtime's call.
 * Lives in shared (re-exported by the tool-approval registry, its policy-side consumer) so the
 * data layer can reserve these keys when it mirrors the runtime's server-key allocation.
 */
export const CHERRY_MCP_SERVER = {
  CHERRY_TOOLS: 'cherry-tools',
  BROWSER: 'browser',
  AGENT_MEMORY: 'agent-memory',
  SKILLS: 'skills',
  MCP_MANAGER: 'mcp-manager',
  ASSISTANT: 'assistant',
  ASSISTANT_FILES: 'assistant-files'
} as const

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

export const isBrowserMcpServer = (server: Pick<McpServer, 'type' | 'name'>): boolean =>
  server.type === 'inMemory' && server.name === BuiltinMcpServerNames.browser

/**
 * Spec-aligned guard for a single MCP `CallToolResult` content block
 * (text / image / audio / resource_link / embedded resource).
 */
export const isMcpContentBlock = (value: unknown): value is ContentBlock => {
  return ContentBlockSchema.safeParse(value).success
}
