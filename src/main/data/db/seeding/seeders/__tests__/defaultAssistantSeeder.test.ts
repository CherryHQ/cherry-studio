import { assistantTable } from '@data/db/schemas/assistant'
import { DefaultAssistantSeeder } from '@data/db/seeding/seeders/defaultAssistantSeeder'
import { DEFAULT_ASSISTANT_ID, DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe('DefaultAssistantSeeder', () => {
  const dbh = setupTestDatabase()

  it('inserts the default assistant row when DB is empty', async () => {
    const seed = new DefaultAssistantSeeder()
    await seed.run(dbh.db)

    const [row] = await dbh.db.select().from(assistantTable).where(eq(assistantTable.id, DEFAULT_ASSISTANT_ID)).limit(1)

    expect(row).toBeDefined()
    expect(row.id).toBe(DEFAULT_ASSISTANT_ID)
    expect(row.name).toBe('Default Assistant')
    expect(row.emoji).toBe('🌟')
    expect(row.settings).toEqual(DEFAULT_ASSISTANT_SETTINGS)
  })

  it('is a no-op when the default assistant already exists', async () => {
    await dbh.db.insert(assistantTable).values({
      id: DEFAULT_ASSISTANT_ID,
      name: 'Custom Name',
      emoji: '🌟',
      settings: DEFAULT_ASSISTANT_SETTINGS
    })

    const seed = new DefaultAssistantSeeder()
    await seed.run(dbh.db)

    const [row] = await dbh.db.select().from(assistantTable).where(eq(assistantTable.id, DEFAULT_ASSISTANT_ID)).limit(1)

    expect(row.name).toBe('Custom Name')
  })

  it('does not affect unrelated assistant rows', async () => {
    await dbh.db.insert(assistantTable).values({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Other',
      emoji: '🤖',
      settings: DEFAULT_ASSISTANT_SETTINGS
    })

    const seed = new DefaultAssistantSeeder()
    await seed.run(dbh.db)

    const rows = await dbh.db.select().from(assistantTable)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.id).sort()).toEqual(['11111111-1111-4111-8111-111111111111', DEFAULT_ASSISTANT_ID].sort())
  })
})
