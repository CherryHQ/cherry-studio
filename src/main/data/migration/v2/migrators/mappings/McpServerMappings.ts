/**
 * MCP Server migration mappings and transform functions
 *
 * Transforms legacy Redux McpServer objects to SQLite mcp_server table rows.
 */

import type { InsertMcpServerRow } from '@data/db/schemas/mcpServer'
import { resolveMcpServerConnection } from '@shared/data/presets/mcpServers'
import { v4 as uuidv4 } from 'uuid'

function toNullable<T>(value: unknown): T | null {
  return (value ?? null) as T | null
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
  warning?: string
}

export function transformMcpServer(source: Record<string, unknown>, index: number): McpServerTransformResult {
  const oldId = source.id as string
  const newId = uuidv4()
  const name = toRequiredString(source.name, newId)
  const baseUrl = source.baseUrl ?? source.url
  const connection = resolveMcpServerConnection({
    name,
    type: source.type,
    baseUrl,
    command: source.command,
    installSource: source.installSource
  })
  const preset = connection.preset
  const sourceHeaders =
    typeof source.headers === 'object' && source.headers !== null && !Array.isArray(source.headers)
      ? (source.headers as Record<string, string>)
      : undefined
  const headers = preset?.headers ? { ...sourceHeaders, ...preset.headers } : source.headers

  return {
    oldId,
    warning: connection.warning,
    row: {
      id: newId,
      name,
      type: connection.type,
      description: toNullable(source.description),
      baseUrl: toNullable(preset?.baseUrl ?? baseUrl),
      command: toNullable(preset?.command ?? source.command),
      registryUrl: toNullable(source.registryUrl),
      args: toNullable(source.args ?? preset?.args),
      env: toNullable(source.env ?? preset?.env),
      headers: toNullable(headers),
      provider: toNullable(source.provider ?? preset?.provider),
      providerUrl: toNullable(source.providerUrl),
      logoUrl: toNullable(source.logoUrl),
      tags: toNullable(source.tags),
      longRunning: toNullable(source.longRunning),
      timeout: toNullable(source.timeout),
      dxtVersion: toNullable(source.dxtVersion),
      dxtPath: toNullable(source.dxtPath),
      reference: toNullable(source.reference ?? preset?.reference),
      searchKey: toNullable(source.searchKey),
      configSample: toNullable(source.configSample),
      disabledTools: toNullable(source.disabledTools ?? preset?.disabledTools),
      disabledAutoApproveTools: toNullable(source.disabledAutoApproveTools ?? preset?.disabledAutoApproveTools),
      shouldConfig: toNullable(source.shouldConfig ?? preset?.shouldConfig),
      sortOrder: index,
      isActive: connection.disable ? false : toRequired(source.isActive, preset?.isActive ?? false),
      installSource: toNullable(source.installSource ?? preset?.installSource),
      isTrusted: toNullable(source.isTrusted ?? preset?.isTrusted),
      trustedAt: toNullable(source.trustedAt),
      installedAt: toNullable(source.installedAt)
    }
  }
}
