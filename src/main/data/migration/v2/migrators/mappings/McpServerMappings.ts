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

function toRequiredString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback
}

/**
 * Legacy Redux values were never validated against the column types they land
 * in. That matters for the batched INSERT: better-sqlite3 binds an array as a
 * list of positional parameters and a plain object as named parameters, so one
 * server whose e.g. `provider` or `logoUrl` is an object does not fail on its
 * own row — the whole batch aborts with "Too few parameter values were
 * provided" (#20301). A scalar column therefore only ever receives a scalar of
 * its type; a value of any other shape becomes null.
 */
function toNullableString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function toNullableInteger(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Math.trunc(Number(value))
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime()
  return null
}

function toNullableBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

const VALID_INSTALL_SOURCES = new Set(['builtin', 'manual', 'ai_assisted', 'protocol', 'unknown'])

/** `install_source` has a CHECK constraint; anything outside the enum becomes null. */
function toInstallSource(value: unknown): InsertMcpServerRow['installSource'] {
  return typeof value === 'string' && VALID_INSTALL_SOURCES.has(value) ? value : null
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
      description: toNullableString(source.description),
      baseUrl: toNullableString(source.baseUrl ?? source.url),
      command: toNullableString(source.command),
      registryUrl: toNullableString(source.registryUrl),
      args: toNullable(source.args),
      env: toNullable(source.env),
      headers: toNullable(source.headers),
      provider: toNullableString(source.provider),
      providerUrl: toNullableString(source.providerUrl),
      logoUrl: toNullableString(source.logoUrl),
      tags: toNullable(source.tags),
      longRunning: toNullableBoolean(source.longRunning),
      timeout: toNullableInteger(source.timeout),
      dxtVersion: toNullableString(source.dxtVersion),
      dxtPath: toNullableString(source.dxtPath),
      reference: toNullableString(source.reference),
      searchKey: toNullableString(source.searchKey),
      configSample: toNullable(source.configSample),
      disabledTools: toNullable(source.disabledTools),
      disabledAutoApproveTools: toNullable(source.disabledAutoApproveTools),
      shouldConfig: toNullableBoolean(source.shouldConfig),
      sortOrder: index,
      isActive: toNullableBoolean(source.isActive) ?? false,
      installSource: toInstallSource(source.installSource),
      isTrusted: toNullableBoolean(source.isTrusted),
      trustedAt: toNullableInteger(source.trustedAt),
      installedAt: toNullableInteger(source.installedAt)
    }
  }
}
