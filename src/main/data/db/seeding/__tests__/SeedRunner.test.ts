import { resolve } from 'node:path'

import { application } from '@application'
import { appStateTable } from '@data/db/schemas/appState'
import { assistantTable } from '@data/db/schemas/assistant'
import { seeders } from '@data/db/seeding/index'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import type { ISeeder } from '@data/db/types'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const BOOTSTRAP_MARKER_KEY = 'seedRunner:bootstrapCompleted'

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

  beforeEach(() => {
    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.provider_registry.data' && filename) {
        return resolve('packages/provider-registry/data', filename)
      }

      return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
    })
  })

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

  it('runs bootstrap-only seeder during the bootstrap window and writes the completion marker', async () => {
    const seeder = createSeeder({ executionPolicy: 'bootstrap-only' })
    const runner = new SeedRunner(dbh.db)
    await runner.runAll([seeder])

    expect(seeder.run).toHaveBeenCalledTimes(1)
    const [journal] = await dbh.db.select().from(appStateTable).where(eq(appStateTable.key, 'seed:test-seed'))
    expect(journal?.value).toMatchObject({ version: '1.0' })
    const [marker] = await dbh.db.select().from(appStateTable).where(eq(appStateTable.key, BOOTSTRAP_MARKER_KEY))
    expect(marker).toBeDefined()
  })

  it('skips bootstrap-only seeder after the window closes, even when its version changed', async () => {
    const runner = new SeedRunner(dbh.db)
    await runner.runAll([createSeeder({ executionPolicy: 'bootstrap-only' })])

    const updated = createSeeder({ version: '2.0', executionPolicy: 'bootstrap-only' })
    await runner.runAll([updated])

    expect(updated.run).not.toHaveBeenCalled()
    const [journal] = await dbh.db.select().from(appStateTable).where(eq(appStateTable.key, 'seed:test-seed'))
    expect(journal?.value).toMatchObject({ version: '1.0' })
  })

  it('still re-runs run-on-change seeders after the bootstrap window closes', async () => {
    const runner = new SeedRunner(dbh.db)
    await runner.runAll([createSeeder()])

    const updated = createSeeder({ version: '2.0' })
    await runner.runAll([updated])

    expect(updated.run).toHaveBeenCalledTimes(1)
  })

  it('keeps the bootstrap window open when a pass fails partway', async () => {
    const runner = new SeedRunner(dbh.db)
    const failing = createSeeder({ name: 'failing-seed', run: vi.fn().mockRejectedValue(new Error('seed failed')) })
    await expect(runner.runAll([failing])).rejects.toThrow('seed failed')

    const markerRows = await dbh.db.select().from(appStateTable).where(eq(appStateTable.key, BOOTSTRAP_MARKER_KEY))
    expect(markerRows).toHaveLength(0)

    const bootstrapSeeder = createSeeder({ executionPolicy: 'bootstrap-only' })
    const recovered = createSeeder({ name: 'failing-seed' })
    await runner.runAll([recovered, bootstrapSeeder])

    expect(bootstrapSeeder.run).toHaveBeenCalledTimes(1)
  })

  it('writes the bootstrap marker only once across passes', async () => {
    const runner = new SeedRunner(dbh.db)
    await runner.runAll([createSeeder()])
    await runner.runAll([createSeeder()])

    const markerRows = await dbh.db.select().from(appStateTable).where(eq(appStateTable.key, BOOTSTRAP_MARKER_KEY))
    expect(markerRows).toHaveLength(1)
  })

  it('does not write a journal for a bootstrap-only seeder skipped outside the window', async () => {
    const runner = new SeedRunner(dbh.db)
    await runner.runAll([createSeeder()])

    const lateBootstrap = createSeeder({ name: 'late-bootstrap', executionPolicy: 'bootstrap-only' })
    await runner.runAll([createSeeder(), lateBootstrap])

    expect(lateBootstrap.run).not.toHaveBeenCalled()
    const journalRows = await dbh.db.select().from(appStateTable).where(eq(appStateTable.key, 'seed:late-bootstrap'))
    expect(journalRows).toHaveLength(0)
  })

  it('runs production seeders in fresh-user order without duplicating the default assistant', async () => {
    const runner = new SeedRunner(dbh.db)

    await runner.runAll(seeders)
    await runner.runAll(seeders)

    const assistants = await dbh.db.select().from(assistantTable)
    expect(assistants).toHaveLength(1)
  })
})
