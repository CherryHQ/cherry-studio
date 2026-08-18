import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { PRESET_MCP_SERVERS } from '@shared/data/presets/mcpServers'
import { and, eq, sql } from 'drizzle-orm'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

/**
 * Adopt the transport a builtin MCP server preset declares for rows that were installed
 * while it was still started in-process (`@cherry/flomo` and `@cherry/nowledge-mem` are HTTP
 * endpoints, `@cherry/mcp-auto-install` is an npx child process).
 *
 * Only rows still stored as `inMemory` are rewritten, so re-running is a no-op and a row the
 * user has since edited keeps its own settings. Nothing is inserted — a builtin the user never
 * installed, or deleted, stays absent.
 */
export class BuiltinMcpServerSeeder implements ISeeder {
  readonly name = 'builtinMcpServer'
  readonly description = 'Repoint installed builtin MCP servers that still use the retired in-memory transport'
  readonly version: string

  constructor() {
    this.version = hashObject(PRESET_MCP_SERVERS)
  }

  run(db: DbType): void {
    for (const preset of PRESET_MCP_SERVERS) {
      if (preset.type === 'inMemory' || preset.type === undefined) continue

      db.update(mcpServerTable)
        .set({
          type: preset.type,
          // Older builtin rows carry no installSource and were recognised by their `inMemory`
          // type alone; once that changes, Settings would treat them as manual servers and
          // unlock their name and transport. An explicit source is left as the user set it.
          installSource: sql`COALESCE(${mcpServerTable.installSource}, 'builtin')`,
          ...(preset.baseUrl !== undefined ? { baseUrl: preset.baseUrl } : {}),
          ...(preset.command !== undefined ? { command: preset.command } : {}),
          ...(preset.args !== undefined ? { args: preset.args } : {}),
          ...(preset.headers !== undefined ? { headers: preset.headers } : {})
        })
        .where(and(eq(mcpServerTable.name, preset.name), eq(mcpServerTable.type, 'inMemory')))
        .run()
    }
  }
}
