import { agentGlobalSkillTable } from '@data/db/schemas/agentGlobalSkill'
import { setupTestDatabase } from '@test-helpers/db/testDatabase'
import { describe, expect, it } from 'vitest'

import { dbSource } from '../dbSource'

type DbHandle = ReturnType<typeof setupTestDatabase>

const insertSkill = async (dbh: DbHandle, overrides: Partial<typeof agentGlobalSkillTable.$inferInsert> = {}) => {
  const now = Date.now()
  await dbh.db.insert(agentGlobalSkillTable).values({
    name: 'code-review',
    folderName: 'code-review',
    source: 'manual',
    contentHash: 'h1',
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides
  })
}

describe('dbSource', () => {
  const dbh = setupTestDatabase()

  /**
   * Maps each enabled DB row to a Skill with `source: 'db'`. The
   * `source` tag is load-bearing: catalog dedup uses it for priority
   * resolution and `skills__load` may render it in error messages.
   */
  it('returns enabled rows as Skills tagged source: db', async () => {
    await insertSkill(dbh, { name: 'a', folderName: 'a', isEnabled: true })
    await insertSkill(dbh, { name: 'b', folderName: 'b', isEnabled: true, contentHash: 'h2' })

    const out = await dbSource()
    const names = out.map((s) => s.name).sort()
    expect(names).toEqual(['a', 'b'])
    expect(out.every((s) => s.source === 'db')).toBe(true)
  })

  /**
   * Disabled rows are user-explicit "do not load this". Leaking them
   * into the catalog is a UX bug — user disabled it in the UI, then
   * the model still sees it.
   */
  it('skips rows where isEnabled is false', async () => {
    await insertSkill(dbh, { name: 'enabled-one', folderName: 'a', isEnabled: true })
    await insertSkill(dbh, { name: 'disabled-one', folderName: 'b', isEnabled: false, contentHash: 'h2' })

    const out = await dbSource()
    expect(out.map((s) => s.name)).toEqual(['enabled-one'])
  })
})
