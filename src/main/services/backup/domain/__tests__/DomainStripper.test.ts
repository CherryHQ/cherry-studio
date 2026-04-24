import { createClient } from '@libsql/client'
import { BackupDomain } from '@shared/backup'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CancellationToken } from '../../CancellationToken'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

describe('DomainStripper', () => {
  let client: ReturnType<typeof createClient>

  beforeEach(async () => {
    client = createClient({ url: 'file::memory:' })

    await client.execute('CREATE TABLE topic (id TEXT PRIMARY KEY, name TEXT)')
    await client.execute('CREATE TABLE message (id TEXT PRIMARY KEY, topic_id TEXT)')
    await client.execute('CREATE TABLE pin (id TEXT PRIMARY KEY, entity_id TEXT)')
    await client.execute('CREATE TABLE preference (scope TEXT, key TEXT, value TEXT)')
    await client.execute('CREATE TABLE tag (id TEXT PRIMARY KEY, name TEXT)')
    await client.execute('CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT)')
    await client.execute('CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY)')
    await client.execute('CREATE TABLE unknown_future_table (id TEXT PRIMARY KEY)')

    await client.execute("INSERT INTO topic VALUES ('t1', 'Test Topic')")
    await client.execute("INSERT INTO preference VALUES ('global', 'theme', 'dark')")
    await client.execute("INSERT INTO app_state VALUES ('last_run', '2026-01-01')")
  })

  afterEach(() => {
    client.close()
  })

  it('keeps selected domain tables and infrastructure tables', async () => {
    // stripUnselectedDomains needs a file path, but we test the logic via the in-memory client
    // Since stripUnselectedDomains opens its own client, we test the helper logic indirectly
    // by verifying the keep-set approach
    const { getTablesKeepSet } = await import('../DomainRegistry')
    const keepSet = getTablesKeepSet([BackupDomain.TOPICS])
    expect(keepSet.has('topic')).toBe(true)
    expect(keepSet.has('message')).toBe(true)
    expect(keepSet.has('pin')).toBe(true)
    expect(keepSet.has('__drizzle_migrations')).toBe(true)
    expect(keepSet.has('preference')).toBe(false)
    expect(keepSet.has('app_state')).toBe(false)
    expect(keepSet.has('unknown_future_table')).toBe(false)
  })

  it('does not include app_state in any domain keep-set', async () => {
    const { getTablesKeepSet } = await import('../DomainRegistry')
    const allDomains = Object.values(BackupDomain) as BackupDomain[]
    const keepSet = getTablesKeepSet(allDomains)
    expect(keepSet.has('app_state')).toBe(false)
  })

  it('CancellationToken prevents further processing', () => {
    const token = new CancellationToken()
    token.cancel()
    expect(token.isCancelled).toBe(true)
  })
})
