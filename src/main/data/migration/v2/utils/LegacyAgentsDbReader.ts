import { existsSync } from 'node:fs'

import { createClient } from '@libsql/client'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { pathToFileURL } from 'url'

import { type MigrationPaths, resolveMigrationPaths } from '../core/MigrationPaths'
import { type AgentsTableRowCounts, getAgentsSourceTableNames } from '../migrators/mappings/AgentsDbMappings'

export type ResolveLegacyAgentsDbPathArgs = {
  canonicalPath: string
  fallbackPath: string
  exists: (path: string) => boolean
}

export function resolveLegacyAgentsDbPath({
  canonicalPath,
  fallbackPath,
  exists
}: ResolveLegacyAgentsDbPathArgs): string | null {
  if (exists(canonicalPath)) {
    return canonicalPath
  }

  if (exists(fallbackPath)) {
    return fallbackPath
  }

  return null
}

export class LegacyAgentsDbReader {
  private readonly paths: Pick<MigrationPaths, 'legacyAgentDbFile' | 'legacyAgentDbFallbackFile'>

  constructor(
    paths?: Pick<MigrationPaths, 'legacyAgentDbFile' | 'legacyAgentDbFallbackFile'>,
    private readonly exists = existsSync
  ) {
    this.paths = paths ?? resolveMigrationPaths().paths
  }

  getCanonicalPath(): string {
    return this.paths.legacyAgentDbFile
  }

  getFallbackPath(): string {
    return this.paths.legacyAgentDbFallbackFile
  }

  resolvePath(): string | null {
    return resolveLegacyAgentsDbPath({
      canonicalPath: this.getCanonicalPath(),
      fallbackPath: this.getFallbackPath(),
      exists: this.exists
    })
  }

  async countRows(): Promise<AgentsTableRowCounts> {
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

      for (const tableName of getAgentsSourceTableNames()) {
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
