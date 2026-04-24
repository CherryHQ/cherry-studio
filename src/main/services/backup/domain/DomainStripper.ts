import { createClient } from '@libsql/client'
import { loggerService } from '@logger'
import { BackupDomain } from '@shared/backup'
import { pathToFileURL } from 'url'

import type { CancellationToken } from '../CancellationToken'
import { getTablesKeepSet } from './DomainRegistry'

const logger = loggerService.withContext('DomainStripper')

export async function stripUnselectedDomains(
  backupDbPath: string,
  selectedDomains: BackupDomain[],
  token: CancellationToken
): Promise<void> {
  const url = pathToFileURL(backupDbPath).href
  const client = createClient({ url })
  try {
    const keepSet = getTablesKeepSet(selectedDomains)
    const allTables = await client.execute(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
    )
    const tablesToDrop = allTables.rows.map((r) => r.name as string).filter((name) => !keepSet.has(name))

    for (const table of tablesToDrop) {
      token.throwIfCancelled()
      await client.execute(`DROP TABLE IF EXISTS "${table}"`)
    }

    const allTriggers = await client.execute(`SELECT name FROM sqlite_master WHERE type = 'trigger'`)
    for (const row of allTriggers.rows) {
      await client.execute(`DROP TRIGGER IF EXISTS "${row.name as string}"`)
    }

    if (selectedDomains.includes(BackupDomain.PROVIDERS)) {
      await client.execute(`UPDATE user_provider SET api_keys = '[]', auth_config = NULL`)
      logger.info('Provider credentials sanitized')
    }

    token.throwIfCancelled()
    await client.execute('VACUUM')
    logger.info('Domain strip complete', {
      dropped: tablesToDrop.length,
      kept: keepSet.size,
      selected: selectedDomains
    })
  } finally {
    client.close()
  }
}
