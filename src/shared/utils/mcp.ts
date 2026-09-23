import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js'
import { ContentBlockSchema } from '@modelcontextprotocol/sdk/types.js'

import type { McpServer } from '@shared/data/types/mcpServer'

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

export const isBrowserMcpServer = (server: Pick<McpServer, 'type' | 'name'>): boolean =>
  server.type === 'inMemory' && server.name === BuiltinMcpServerNames.browser

/**
 * Spec-aligned guard for a single MCP `CallToolResult` content block
 * (text / image / audio / resource_link / embedded resource).
 */
export const isMcpContentBlock = (value: unknown): value is ContentBlock => {
  // Cherry persists MCP images as FileEntry references. The SDK schema still
  // requires `data`, so accept the asset-only form at our boundary as well.
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const block = value as Record<string, unknown>
    if (block.type === 'image' && typeof block.assetId === 'string' && block.assetId.length > 0) return true
  }
  return ContentBlockSchema.safeParse(value).success
}

/** Remove inline bytes from MCP image blocks once a Cherry-managed asset id exists. */
export function stripMcpImageData<T>(value: T): T {
  const visit = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(visit)
    if (!candidate || typeof candidate !== 'object') return candidate

    const record = candidate as Record<string, unknown>
    const next: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(record)) {
      if (key === 'data' && record.type === 'image' && typeof record.assetId === 'string') continue
      next[key] = visit(child)
    }
    return next
  }

  return visit(value) as T
}

/** Collect Cherry-managed MCP image assets from an arbitrary tool result. */
export function collectMcpImageAssetIds(value: unknown): string[] {
  const ids = new Set<string>()
  const visit = (candidate: unknown) => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit)
      return
    }
    if (!candidate || typeof candidate !== 'object') return
    const record = candidate as Record<string, unknown>
    if (record.type === 'image' && typeof record.assetId === 'string' && record.assetId.length > 0) {
      ids.add(record.assetId)
    }
    Object.values(record).forEach(visit)
  }
  visit(value)
  return [...ids]
}
