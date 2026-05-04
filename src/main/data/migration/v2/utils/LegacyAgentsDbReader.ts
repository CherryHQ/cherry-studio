import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { createClient } from '@libsql/client'

import { type MigrationPaths, resolveMigrationPaths } from '../core/MigrationPaths'
import {
  type AgentsSchemaInfo,
  type AgentsTableRowCounts,
  createEmptyAgentsSchemaInfo,
  getAgentsSourceTableNames
} from '../migrators/mappings/AgentsDbMappings'

export class LegacyAgentsDbReader {
  private readonly paths: Pick<MigrationPaths, 'legacyAgentDbFile'>

  constructor(
    paths?: Pick<MigrationPaths, 'legacyAgentDbFile'>,
    private readonly exists = existsSync
  ) {
    this.paths = paths ?? resolveMigrationPaths().paths
  }

  resolvePath(): string | null {
    const dbPath = this.paths.legacyAgentDbFile
    return this.exists(dbPath) ? dbPath : null
  }

  async inspectSchema(): Promise<AgentsSchemaInfo> {
    const dbPath = this.resolvePath()

    if (!dbPath) {
      return createEmptyAgentsSchemaInfo()
    }

    const client = createClient({
      url: pathToFileURL(dbPath).toString(),
      intMode: 'number'
    })

    try {
      const schemaInfo = createEmptyAgentsSchemaInfo()

      for (const tableName of getAgentsSourceTableNames()) {
        const table = await client.execute({
          sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
          args: [tableName]
        })

        if (table.rows.length === 0) {
          continue
        }

        schemaInfo[tableName].exists = true

        const columns = await client.execute({
          sql: `PRAGMA table_info(\`${tableName}\`)`,
          args: []
        })
        schemaInfo[tableName].columns = new Set(
          columns.rows.map((row) => String((row as { name?: unknown }).name ?? ''))
        )
      }

      return schemaInfo
    } finally {
      client.close()
    }
  }

  async countRows(schemaInfo?: AgentsSchemaInfo): Promise<AgentsTableRowCounts> {
    const dbPath = this.resolvePath()

    if (!dbPath) {
      return this.createEmptyCounts()
    }

    const client = createClient({
      url: pathToFileURL(dbPath).toString(),
      intMode: 'number'
    })

    try {
      const counts = this.createEmptyCounts()
      const effectiveSchemaInfo = schemaInfo ?? (await this.inspectSchema())

      for (const tableName of getAgentsSourceTableNames()) {
        if (!effectiveSchemaInfo[tableName].exists) {
          continue
        }

        const result = await client.execute({
          sql: `SELECT COUNT(*) AS count FROM \`${tableName}\``,
          args: []
        })
        const row = result.rows[0] as { count?: unknown } | undefined
        counts[tableName] = Number(row?.count ?? 0)
      }

      return counts
    } finally {
      client.close()
    }
  }

  private createEmptyCounts(): AgentsTableRowCounts {
    return Object.fromEntries(getAgentsSourceTableNames().map((tableName) => [tableName, 0])) as AgentsTableRowCounts
  }
}
