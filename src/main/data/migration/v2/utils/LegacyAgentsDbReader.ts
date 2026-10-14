import { existsSync } from 'node:fs'

import Database from 'better-sqlite3'

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

  inspectSchema(): AgentsSchemaInfo {
    const dbPath = this.resolvePath()

    if (!dbPath) {
      return createEmptyAgentsSchemaInfo()
    }

    const db = new Database(dbPath, { readonly: true, fileMustExist: true })

    try {
      const schemaInfo = createEmptyAgentsSchemaInfo()

      for (const tableName of getAgentsSourceTableNames()) {
        const existsRow = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName)

        if (existsRow === undefined) {
          continue
        }

        schemaInfo[tableName].exists = true

        // PRAGMA does not accept bound parameters; tableName comes from the
        // hardcoded getAgentsSourceTableNames() whitelist, so identifier
        // interpolation here is safe.
        const columnsResult = db.prepare(`PRAGMA table_info(\`${tableName}\`)`).all() as Array<{ name: unknown }>
        schemaInfo[tableName].columns = new Set(columnsResult.map((row) => String(row.name)))
      }

      return schemaInfo
    } finally {
      db.close()
    }
  }

  countRows(schemaInfo?: AgentsSchemaInfo): AgentsTableRowCounts {
    const dbPath = this.resolvePath()

    if (!dbPath) {
      return this.createEmptyCounts()
    }

    const db = new Database(dbPath, { readonly: true, fileMustExist: true })

    try {
      const counts = this.createEmptyCounts()
      const effectiveSchemaInfo = schemaInfo ?? this.inspectSchema()

      for (const tableName of getAgentsSourceTableNames()) {
        if (!effectiveSchemaInfo[tableName].exists) {
          continue
        }

        // tableName comes from the hardcoded getAgentsSourceTableNames() whitelist.
        const row = db.prepare(`SELECT COUNT(*) AS count FROM \`${tableName}\``).get() as { count?: number } | undefined
        counts[tableName] = Number(row?.count ?? 0)
      }

      return counts
    } finally {
      db.close()
    }
  }

  private createEmptyCounts(): AgentsTableRowCounts {
    return Object.fromEntries(getAgentsSourceTableNames().map((tableName) => [tableName, 0])) as AgentsTableRowCounts
  }
}
