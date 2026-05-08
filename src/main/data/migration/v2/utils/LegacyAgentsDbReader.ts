import { existsSync } from 'node:fs'

import { createClient } from '@libsql/client'
import { pathToFileURL } from 'url'

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
      url: pathToFileURL(dbPath).href,
      intMode: 'number'
    })

    try {
      const schemaInfo = createEmptyAgentsSchemaInfo()

      for (const tableName of getAgentsSourceTableNames()) {
        const existsResult = await client.execute({
          sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
          args: [tableName]
        })

        if (existsResult.rows.length === 0) {
          continue
        }

        schemaInfo[tableName].exists = true

        // PRAGMA does not accept bound parameters; tableName comes from the
        // hardcoded getAgentsSourceTableNames() whitelist, so identifier
        // interpolation here is safe.
        const columnsResult = await client.execute(`PRAGMA table_info(\`${tableName}\`)`)
        schemaInfo[tableName].columns = new Set(columnsResult.rows.map((row) => String(row.name)))
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
      url: pathToFileURL(dbPath).href,
      intMode: 'number'
    })

    try {
      const counts = this.createEmptyCounts()
      const effectiveSchemaInfo = schemaInfo ?? (await this.inspectSchema())

      for (const tableName of getAgentsSourceTableNames()) {
        if (!effectiveSchemaInfo[tableName].exists) {
          continue
        }

        // tableName comes from the hardcoded getAgentsSourceTableNames() whitelist.
        const result = await client.execute(`SELECT COUNT(*) AS count FROM \`${tableName}\``)
        counts[tableName] = Number(result.rows[0]?.count ?? 0)
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
