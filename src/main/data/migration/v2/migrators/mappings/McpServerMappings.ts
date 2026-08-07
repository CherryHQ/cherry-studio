/**
 * MCP Server migration mappings and transform functions
 *
 * Transforms legacy Redux McpServer objects to SQLite mcp_server table rows.
 */

import type { InsertMcpServerRow } from '@data/db/schemas/mcpServer'
import { v4 as uuidv4 } from 'uuid'

function toNullable<T>(value: unknown): T | null {
  return (value ?? null) as T | null
}

const VALID_MCP_SERVER_TYPES = new Set(['stdio', 'sse', 'streamableHttp', 'inMemory'])

/**
 * Legacy Redux state was never re-validated against the current type enum after
 * being written (e.g. v1 briefly allowed literal 'http' / 'streamable_http', and
 * arbitrary strings could slip in via unvalidated code paths). The `type` column
 * has a CHECK constraint restricting it to the current enum, so passing through
 * anything else aborts the whole insert batch. Mirror v1's own normalization
 * (any "http"-containing string collapses to streamableHttp) and drop anything
 * else to null rather than fail the migration.
 */
function toMcpServerType(value: unknown): InsertMcpServerRow['type'] {
  if (typeof value !== 'string') return null
  if (VALID_MCP_SERVER_TYPES.has(value)) return value as InsertMcpServerRow['type']
  if (value.includes('http')) return 'streamableHttp'
  return null
}

function toRequired<T>(value: unknown, fallback: T): T {
  return (value ?? fallback) as T
}

function toRequiredString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback
}

export interface McpServerTransformResult {
  row: InsertMcpServerRow
  oldId: string
}

export function transformMcpServer(source: Record<string, unknown>, index: number): McpServerTransformResult {
  const oldId = source.id as string
  const newId = uuidv4()

  return {
    oldId,
    row: {
      id: newId,
      name: toRequiredString(source.name, newId),
      type: toMcpServerType(source.type),
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
      sortOrder: index,
      isActive: toRequired(source.isActive, false),
      installSource: toNullable(source.installSource),
      isTrusted: toNullable(source.isTrusted),
      trustedAt: toNullable(source.trustedAt),
      installedAt: toNullable(source.installedAt)
    }
  }
}
