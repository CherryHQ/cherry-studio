/**
 * MCP Server migration mappings and transform functions
 *
 * Transforms legacy Redux MCPServer objects to SQLite mcp_server table rows.
 */

import type { McpServerInsert } from '@data/db/schemas/mcpServer'

function toNullable<T>(value: unknown): T | null {
  return (value ?? null) as T | null
}

function toRequired<T>(value: unknown, fallback: T): T {
  return (value ?? fallback) as T
}

export function transformMcpServer(source: Record<string, unknown>): McpServerInsert {
  return {
    id: toRequired<string>(source.id, ''),
    name: toRequired<string>(source.name, ''),
    type: toNullable(source.type),
    description: toNullable(source.description),
    baseUrl: toNullable(source.baseUrl ?? source.url),
    command: toNullable(source.command),
    registryUrl: toNullable(source.registryUrl),
    args: toNullable(source.args),
    env: toNullable(source.env),
    headers: toNullable(source.headers),
    provider: toNullable(source.provider),
    providerUrl: toNullable(source.providerUrl),
    logoUrl: toNullable(source.logoUrl),
    tags: toNullable(source.tags),
    longRunning: toNullable(source.longRunning),
    timeout: toNullable(source.timeout),
    dxtVersion: toNullable(source.dxtVersion),
    dxtPath: toNullable(source.dxtPath),
    reference: toNullable(source.reference),
    searchKey: toNullable(source.searchKey),
    configSample: toNullable(source.configSample),
    disabledTools: toNullable(source.disabledTools),
    disabledAutoApproveTools: toNullable(source.disabledAutoApproveTools),
    shouldConfig: toNullable(source.shouldConfig),
    isActive: toRequired(source.isActive, false),
    installSource: toNullable(source.installSource),
    isTrusted: toNullable(source.isTrusted),
    trustedAt: toNullable(source.trustedAt),
    installedAt: toNullable(source.installedAt)
  }
}
