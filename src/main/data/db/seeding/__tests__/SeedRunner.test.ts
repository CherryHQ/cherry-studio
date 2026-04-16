import { appStateTable } from '@data/db/schemas/appState'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import type { ISeeder } from '@data/db/types'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

function createSeeder(overrides: Partial<ISeeder> = {}): ISeeder {
  return {
    name: 'test-seed',
    version: '1.0',
    description: 'Test seeder',
    run: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

describe('SeedRunner', () => {
  const dbh = setupTestDatabase()

  it('should run seed and write journal on first run (no journal entry)', async () => {
    const seeder = createSeeder()
    const runner = new SeedRunner(dbh.db)
    await runner.runAll([seeder])

    expect(seeder.run).toHaveBeenCalledTimes(1)
    expect(seeder.run).toHaveBeenCalledWith(dbh.db)

    const [journal] = await dbh.db.select().from(appStateTable).where(eq(appStateTable.key, 'seed:test-seed'))
    expect(journal?.value).toMatchObject({ version: '1.0' })
  })

  it('should skip seed when version matches', async () => {
    // Pre-populate journal at the expected version
    await dbh.db.insert(appStateTable).values({
      key: 'seed:test-seed',
      value: { version: '1.0' }
    })

    const seeder = createSeeder({ version: '1.0' })
    const runner = new SeedRunner(dbh.db)
    await runner.runAll([seeder])

    expect(seeder.run).not.toHaveBeenCalled()
  })

  it('should re-run seed and update journal when version changed', async () => {
    await dbh.db.insert(appStateTable).values({
      key: 'seed:test-seed',
      value: { version: '0.9' }
    })

    const seeder = createSeeder({ version: '1.0' })
    const runner = new SeedRunner(dbh.db)
    await runner.runAll([seeder])

    expect(seeder.run).toHaveBeenCalledTimes(1)
    const [journal] = await dbh.db.select().from(appStateTable).where(eq(appStateTable.key, 'seed:test-seed'))
    expect(journal?.value).toMatchObject({ version: '1.0' })
  })

  it('should handle empty seeders array without errors', async () => {
    const runner = new SeedRunner(dbh.db)
    await expect(runner.runAll([])).resolves.toBeUndefined()

    const journalRows = await dbh.db.select().from(appStateTable)
    expect(journalRows).toHaveLength(0)
  })

  it('should not write journal when seed run() throws', async () => {
    const seeder = createSeeder({
      run: vi.fn().mockRejectedValue(new Error('seed failed'))
    })
    const runner = new SeedRunner(dbh.db)

    await expect(runner.runAll([seeder])).rejects.toThrow('seed failed')

    const journalRows = await dbh.db.select().from(appStateTable).where(eq(appStateTable.key, 'seed:test-seed'))
    expect(journalRows).toHaveLength(0)
  })
})
