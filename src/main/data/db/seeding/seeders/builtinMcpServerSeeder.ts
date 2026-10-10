import { and, eq } from 'drizzle-orm'

import { type McpServerRow, mcpServerTable } from '@data/db/schemas/mcpServer'
import { PRESET_MCP_SERVERS } from '@shared/data/presets/mcpServers'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

const legacyMcpAutoInstallArgs = ['-y', '@mcpmarket/mcp-auto-install', 'connect', '--json']

function isLegacyMcpAutoInstall(row: McpServerRow): boolean {
  return (
    row.installSource === null &&
    row.name === BuiltinMcpServerNames.mcpAutoInstall &&
    row.type === 'inMemory' &&
    row.reference === 'https://docs.cherry-ai.com/advanced-basic/mcp/auto-install' &&
    row.baseUrl === null &&
    row.command === 'npx' &&
    row.registryUrl === null &&
    JSON.stringify(row.args) === JSON.stringify(legacyMcpAutoInstallArgs) &&
    row.env === null &&
    row.headers === null &&
    row.provider === 'CherryAI'
  )
}

/**
 * Adopt the transport a builtin MCP server preset declares for rows that were installed
 * while it was still started in-process (`@cherry/flomo` and `@cherry/nowledge-mem` are HTTP
 * endpoints, `@cherry/mcp-auto-install` is an npx child process).
 *
 * Only explicit builtin rows or the exact legacy mcp-auto-install default are rewritten. Ambiguous
 * rows without ownership, already-migrated rows, and deleted builtins stay untouched.
 *
 * A rewritten row adopts the preset's connection wholesale — an edit to the retired transport's
 * command or args does not survive, because it describes a way of running the server that no
 * longer exists. Everything else the user owns (env, isActive, timeout, disabled tools) is kept.
 */
export class BuiltinMcpServerSeeder implements ISeeder {
  readonly name = 'builtinMcpServer'
  readonly description = 'Repoint installed builtin MCP servers that still use the retired in-memory transport'
  readonly version: string

  constructor() {
    this.version = hashObject(PRESET_MCP_SERVERS)
  }

  run(db: DbType): void {
    // One transaction for the whole catalog: a half-migrated set would leave some servers
    // pointing at a transport the runtime no longer implements.
    db.transaction((tx) => {
      for (const preset of PRESET_MCP_SERVERS) {
        if (preset.type === 'inMemory' || preset.type === undefined) continue

        const rows = tx
          .select()
          .from(mcpServerTable)
          .where(and(eq(mcpServerTable.name, preset.name), eq(mcpServerTable.type, 'inMemory')))
          .all()

        for (const row of rows) {
          if (row.installSource !== 'builtin' && !isLegacyMcpAutoInstall(row)) continue

          const transportFields =
            preset.type === 'stdio'
              ? {
                  baseUrl: null,
                  command: preset.command ?? null,
                  args: preset.args ?? null,
                  headers: null
                }
              : {
                  baseUrl: preset.baseUrl ?? null,
                  command: null,
                  registryUrl: null,
                  args: null,
                  headers: preset.headers ?? null
                }

          tx.update(mcpServerTable)
            .set({ type: preset.type, installSource: 'builtin', ...transportFields })
            .where(eq(mcpServerTable.id, row.id))
            .run()
        }
      }
    })
  }
}
