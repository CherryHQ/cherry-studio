import { existsSync } from 'node:fs'

import { createClient } from '@libsql/client'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
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

    const db = drizzle(client)

    try {
      const schemaInfo = createEmptyAgentsSchemaInfo()

      for (const tableName of getAgentsSourceTableNames()) {
        const table = await db.get<{ name: string }>(
          sql.raw(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${tableName}'`)
        )

        if (!table) {
          continue
        }

        schemaInfo[tableName].exists = true

        const columns = await db.all<{ name: string }>(sql.raw(`PRAGMA table_info(${tableName})`))
        schemaInfo[tableName].columns = new Set(columns.map((column) => column.name))
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

    const db = drizzle(client)

    try {
      const counts = this.createEmptyCounts()
      const effectiveSchemaInfo = schemaInfo ?? (await this.inspectSchema())

      for (const tableName of getAgentsSourceTableNames()) {
        if (!effectiveSchemaInfo[tableName].exists) {
          continue
        }

        const result = await db.get<{ count: number }>(sql.raw(`SELECT COUNT(*) AS count FROM ${tableName}`))
        counts[tableName] = Number(result?.count ?? 0)
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
