import type { Client } from '@libsql/client'
import { createClient } from '@libsql/client'
import { loggerService } from '@logger'
import { BackupDomain } from '@shared/backup'
import { pathToFileURL } from 'url'

import type { CancellationToken } from '../CancellationToken'
import { getTablesKeepSet } from './DomainRegistry'

const logger = loggerService.withContext('DomainStripper')

interface CrossDomainFkRule {
  table: string
  column: string
  referencedDomain: BackupDomain
  action: 'SET_NULL' | 'DELETE_ROW'
}

export const CROSS_DOMAIN_FK_RULES: readonly CrossDomainFkRule[] = [
  { table: 'topic', column: 'assistant_id', referencedDomain: BackupDomain.ASSISTANTS, action: 'SET_NULL' },
  { table: 'topic', column: 'group_id', referencedDomain: BackupDomain.TAGS_GROUPS, action: 'SET_NULL' },
  { table: 'message', column: 'model_id', referencedDomain: BackupDomain.PROVIDERS, action: 'SET_NULL' },
  { table: 'assistant', column: 'model_id', referencedDomain: BackupDomain.PROVIDERS, action: 'SET_NULL' },
  {
    table: 'assistant_mcp_server',
    column: 'mcp_server_id',
    referencedDomain: BackupDomain.MCP_SERVERS,
    action: 'DELETE_ROW'
  },
  {
    table: 'assistant_knowledge_base',
    column: 'knowledge_base_id',
    referencedDomain: BackupDomain.KNOWLEDGE,
    action: 'DELETE_ROW'
  },
  {
    table: 'knowledge_base',
    column: 'embedding_model_id',
    referencedDomain: BackupDomain.PROVIDERS,
    action: 'SET_NULL'
  },
  { table: 'knowledge_base', column: 'rerank_model_id', referencedDomain: BackupDomain.PROVIDERS, action: 'SET_NULL' }
]

export async function stripUnselectedDomains(
  backupDbPath: string,
  selectedDomains: BackupDomain[],
  token: CancellationToken
): Promise<void> {
  const url = pathToFileURL(backupDbPath).href
  const client = createClient({ url })
  try {
    const keepSet = getTablesKeepSet(selectedDomains)
    const selectedSet = new Set(selectedDomains)

    await nullifyCrossDomainFks(client, keepSet, selectedSet, token)

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

async function nullifyCrossDomainFks(
  client: Client,
  keepSet: Set<string>,
  selectedDomains: Set<BackupDomain>,
  token: CancellationToken
): Promise<void> {
  let nullified = 0
  for (const rule of CROSS_DOMAIN_FK_RULES) {
    token.throwIfCancelled()
    if (selectedDomains.has(rule.referencedDomain)) continue
    if (!keepSet.has(rule.table)) continue

    if (rule.action === 'SET_NULL') {
      await client.execute(`UPDATE "${rule.table}" SET "${rule.column}" = NULL`)
    } else {
      await client.execute(`DELETE FROM "${rule.table}"`)
    }
    nullified++
  }
  if (nullified > 0) {
    logger.info('Cross-domain FK references cleaned', { rules: nullified })
  }
}
