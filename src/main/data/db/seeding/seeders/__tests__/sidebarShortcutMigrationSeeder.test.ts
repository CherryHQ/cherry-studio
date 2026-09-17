import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { appStateTable } from '@data/db/schemas/appState'
import { assistantTable } from '@data/db/schemas/assistant'
import { miniAppTable } from '@data/db/schemas/miniApp'
import { preferenceTable } from '@data/db/schemas/preference'
import { seeders } from '@data/db/seeding/seederRegistry'
import { SidebarShortcutMigrationSeeder } from '@data/db/seeding/seeders/sidebarShortcutMigrationSeeder'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import { createSidebarShortcutId, type SidebarShortcutTarget } from '@shared/data/preference/preferenceTypes'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

describe('SidebarShortcutMigrationSeeder', () => {
  const dbh = setupTestDatabase()

  const preferenceSeeders = seeders.filter((seeder) =>
    ['sidebar-shortcut-migration', 'preference'].includes(seeder.name)
  )

  function readPreference(key = 'ui.sidebar_shortcut'): unknown {
    return dbh.db
      .select({ value: preferenceTable.value })
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, key)))
      .get()?.value
  }

  it('preserves order, snapshots entity names, and is idempotent', () => {
    const agent = dbh.db
      .insert(agentTable)
      .values({ type: 'manual', name: 'Researcher', instructions: '', orderKey: 'a0' })
      .returning({ id: agentTable.id })
      .get()
    const assistant = dbh.db
      .insert(assistantTable)
      .values({ name: 'Writer', emoji: '✍️', settings: DEFAULT_ASSISTANT_SETTINGS, orderKey: 'a0' })
      .returning({ id: assistantTable.id })
      .get()
    dbh.db
      .insert(miniAppTable)
      .values({ appId: 'mini-1', name: 'Calendar', url: 'https://example.com', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(preferenceTable)
      .values({
        scope: 'default',
        key: 'ui.sidebar.favorites',
        value: [
          { type: 'agent', id: agent.id },
          { type: 'mini_app', id: 'mini-1' },
          { type: 'assistant', id: assistant.id },
          { type: 'app', id: 'translate' }
        ]
      })
      .run()

    const original = dbh.db.select().from(preferenceTable).all()
    const runner = new SeedRunner(dbh.db)
    runner.runAll(preferenceSeeders)
    const first = readPreference()

    expect(first).toEqual([
      expect.objectContaining({
        fallbackLabel: 'Researcher',
        target: expect.objectContaining({ locator: { providerId: 'core.agent', resourceId: agent.id } })
      }),
      expect.objectContaining({
        fallbackLabel: 'Calendar',
        target: expect.objectContaining({ locator: { providerId: 'core.mini-app', resourceId: 'mini-1' } })
      }),
      expect.objectContaining({
        fallbackLabel: 'Writer',
        target: expect.objectContaining({ locator: { providerId: 'core.assistant', resourceId: assistant.id } })
      }),
      expect.objectContaining({
        target: expect.objectContaining({ locator: { providerId: 'core.app', resourceId: 'translate' } })
      })
    ])

    runner.runAll(preferenceSeeders)
    expect(readPreference()).toEqual(first)
    expect(dbh.db.select().from(preferenceTable).where(eq(preferenceTable.key, 'ui.sidebar.favorites')).all()).toEqual(
      original
    )
  })

  it('migrates mixed values without dropping new or future items', () => {
    const target: SidebarShortcutTarget = {
      kind: 'resource',
      locator: { providerId: 'core.prompt', resourceId: 'prompt-1' },
      activationId: 'reveal'
    }
    const shortcut = { type: 'shortcut', id: createSidebarShortcutId(target), target }
    const future = { type: 'group', id: 'future-1', children: [] }
    dbh.db
      .insert(preferenceTable)
      .values({
        scope: 'default',
        key: 'ui.sidebar.favorites',
        value: [shortcut, { type: 'app', id: 'agents' }, future, { type: 'app', id: 'agents' }]
      })
      .run()

    new SidebarShortcutMigrationSeeder().run(dbh.db)

    expect(readPreference()).toEqual([
      shortcut,
      expect.objectContaining({
        target: expect.objectContaining({ locator: { providerId: 'core.app', resourceId: 'agents' } })
      }),
      future
    ])
  })

  it('preserves an intentionally empty legacy sidebar instead of seeding shortcut defaults', () => {
    dbh.db.insert(preferenceTable).values({ key: 'ui.sidebar.favorites', value: [] }).run()

    new SeedRunner(dbh.db).runAll(preferenceSeeders)

    expect(readPreference()).toEqual([])
    expect(readPreference('ui.sidebar.favorites')).toEqual([])
  })

  it('seeds independent old and new defaults on a fresh installation', () => {
    new SeedRunner(dbh.db).runAll(preferenceSeeders)

    expect(readPreference('ui.sidebar.favorites')).toEqual(DefaultPreferences.default['ui.sidebar.favorites'])
    expect(readPreference()).toEqual(DefaultPreferences.default['ui.sidebar_shortcut'])
  })

  it.each([
    { existing: [] },
    {
      existing: [
        {
          type: 'shortcut',
          id: 'sidebar-shortcut:core.app:translate',
          target: {
            kind: 'resource',
            locator: { providerId: 'core.app', resourceId: 'translate' }
          }
        }
      ]
    }
  ])('never overwrites an existing shortcut preference: $existing', ({ existing }) => {
    const legacy = [{ type: 'app', id: 'agents' }]
    dbh.db
      .insert(preferenceTable)
      .values([
        { key: 'ui.sidebar.favorites', value: legacy },
        { key: 'ui.sidebar_shortcut', value: existing }
      ])
      .run()

    new SidebarShortcutMigrationSeeder().run(dbh.db)

    expect(readPreference()).toEqual(existing)
    expect(readPreference('ui.sidebar.favorites')).toEqual(legacy)
  })

  it('copies shortcut-only data from a previous development revision without changing its source', () => {
    const target: SidebarShortcutTarget = {
      kind: 'resource',
      locator: { providerId: 'core.topic', resourceId: 'topic-1' }
    }
    const shortcuts = [{ type: 'shortcut', id: createSidebarShortcutId(target), target }]
    dbh.db.insert(preferenceTable).values({ key: 'ui.sidebar.favorites', value: shortcuts }).run()
    dbh.db
      .insert(appStateTable)
      .values({ key: 'seed:sidebar-shortcut-migration', value: { version: '1' } })
      .run()

    new SeedRunner(dbh.db).runAll(preferenceSeeders)

    expect(readPreference()).toEqual(shortcuts)
    expect(readPreference('ui.sidebar.favorites')).toEqual(shortcuts)
  })
})
