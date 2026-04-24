import type { Client } from '@libsql/client'
import { loggerService } from '@logger'
import type { BackupDomain } from '@shared/backup'
import { sql } from 'drizzle-orm'
import { v4 as uuidv4, v7 as uuidv7 } from 'uuid'

import { getTablesForDomains } from './DomainRegistry'

const logger = loggerService.withContext('IdRemapper')

const V4_TABLES = new Set([
  'topic',
  'knowledge_base',
  'tag',
  'group',
  'mcp_server',
  'pin',
  'assistant',
  'agent',
  'agent_global_skill',
  'agent_channel'
])
const V7_TABLES = new Set(['message', 'knowledge_item', 'translate_history'])

export class IdRemapper {
  private readonly idMap = new Map<string, string>()

  async buildMap(
    backupClient: Client,
    liveDb: { all(query: ReturnType<typeof sql>): Promise<unknown[]> },
    domains: BackupDomain[]
  ): Promise<void> {
    const tables = getTablesForDomains(domains)

    for (const table of tables) {
      const isV4 = V4_TABLES.has(table)
      const isV7 = V7_TABLES.has(table)
      if (!isV4 && !isV7) continue

      const backupRows = await backupClient.execute(`SELECT id FROM "${table}"`)
      if (backupRows.rows.length === 0) continue

      for (const row of backupRows.rows) {
        const oldId = row.id as string
        const existing = await liveDb.all(sql`SELECT 1 FROM ${sql.raw(`"${table}"`)} WHERE id = ${oldId}`)
        if (existing.length > 0) {
          this.idMap.set(oldId, isV7 ? uuidv7() : uuidv4())
        }
      }
    }

    logger.info('ID remap built', { remapped: this.idMap.size })
  }

  remap(id: string): string {
    return this.idMap.get(id) ?? id
  }

  getMap(): ReadonlyMap<string, string> {
    return this.idMap
  }
}
