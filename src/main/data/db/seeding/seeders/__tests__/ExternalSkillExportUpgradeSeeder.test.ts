import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { appStateTable } from '@data/db/schemas/appState'
import { preferenceTable } from '@data/db/schemas/preference'
import { seeders } from '@data/db/seeding/seederRegistry'
import { CherryAiDefaultModelSeeder } from '@data/db/seeding/seeders/cherryaiDefaultModelSeeder'
import { ExternalSkillExportUpgradeSeeder } from '@data/db/seeding/seeders/ExternalSkillExportUpgradeSeeder'
import { PreferenceSeeder } from '@data/db/seeding/seeders/preferenceSeeder'
import { SeedRunner } from '@data/db/seeding/SeedRunner'

const key = 'agent.skills.external_export.enabled'

describe('ExternalSkillExportUpgradeSeeder', () => {
  const dbh = setupTestDatabase()
  const selected = seeders.filter(
    (seeder) =>
      seeder instanceof ExternalSkillExportUpgradeSeeder ||
      seeder instanceof CherryAiDefaultModelSeeder ||
      seeder instanceof PreferenceSeeder
  )
  const value = () =>
    dbh.db
      .select()
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, key)))
      .get()?.value

  it('runs before model and preference defaults', () => {
    expect(selected.map((seeder) => seeder.constructor.name)).toEqual([
      'ExternalSkillExportUpgradeSeeder',
      'CherryAiDefaultModelSeeder',
      'PreferenceSeeder'
    ])
  })

  it('keeps fresh installs off on restart', () => {
    const runner = new SeedRunner(dbh.db)
    runner.runAll(selected)
    expect(value()).toBe(false)
    runner.runAll(selected)
    expect(value()).toBe(false)
  })

  it('leaves an empty preference table untouched before default seeding', () => {
    new ExternalSkillExportUpgradeSeeder().run(dbh.db)
    expect(value()).toBeUndefined()
    new PreferenceSeeder().run(dbh.db)
    expect(value()).toBe(false)
  })

  it('enables exports for an existing installation without skills and preserves a later opt-out', () => {
    dbh.db.insert(preferenceTable).values({ scope: 'default', key: 'app.language', value: 'en-US' }).run()
    dbh.db
      .insert(appStateTable)
      .values({ key: 'seedRunner:bootstrapCompleted', value: { completedAt: 1 } })
      .run()
    const runner = new SeedRunner(dbh.db)
    runner.runAll(selected)
    expect(value()).toBe(true)
    dbh.db.update(preferenceTable).set({ value: false }).where(eq(preferenceTable.key, key)).run()
    runner.runAll(selected)
    expect(value()).toBe(false)
  })

  it.each([false, true])('preserves an existing %s value', (existing) => {
    dbh.db.insert(preferenceTable).values({ scope: 'default', key, value: existing }).run()
    new SeedRunner(dbh.db).runAll(selected)
    expect(value()).toBe(existing)
  })
})
