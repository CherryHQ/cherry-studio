import { existsSync } from 'node:fs'

import { createClient } from '@libsql/client'
import { application } from '@main/core/application'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { pathToFileURL } from 'url'

import { type AgentsTableRowCounts, getAgentsSourceTableNames } from '../migrators/mappings/AgentsDbMappings'

export type ResolveLegacyAgentsDbPathArgs = {
  canonicalPath: string
  legacyPath: string
  exists: (path: string) => boolean
}

export function resolveLegacyAgentsDbPath({
  canonicalPath,
  legacyPath,
  exists
}: ResolveLegacyAgentsDbPathArgs): string | null {
  if (exists(canonicalPath)) {
    return canonicalPath
  }

  if (exists(legacyPath)) {
    return legacyPath
  }

  return null
}

export class LegacyAgentsDbReader {
  constructor(private readonly exists = existsSync) {}

  getCanonicalPath(): string {
    return application.getPath('feature.agents.db_file')
  }

  getLegacyPath(): string {
    return application.getPath('app.userdata', 'agents.db')
  }

  resolvePath(): string | null {
    return resolveLegacyAgentsDbPath({
      canonicalPath: this.getCanonicalPath(),
      legacyPath: this.getLegacyPath(),
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
