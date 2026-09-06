import { agentTable } from '@data/db/schemas/agent'
import { assistantTable } from '@data/db/schemas/assistant'
import { miniAppTable } from '@data/db/schemas/miniApp'
import { preferenceTable } from '@data/db/schemas/preference'
import { SidebarShortcutMigrationSeeder } from '@data/db/seeding/seeders/sidebarShortcutMigrationSeeder'
import { createSidebarShortcutId, type SidebarShortcutTarget } from '@shared/data/preference/preferenceTypes'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe('SidebarShortcutMigrationSeeder', () => {
  const dbh = setupTestDatabase()

  function readFavorites(): unknown {
    return dbh.db
      .select({ value: preferenceTable.value })
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, 'ui.sidebar.favorites')))
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

    const seeder = new SidebarShortcutMigrationSeeder()
    seeder.run(dbh.db)
    const first = readFavorites()

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

    seeder.run(dbh.db)
    expect(readFavorites()).toEqual(first)
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

    expect(readFavorites()).toEqual([
      shortcut,
      expect.objectContaining({
        target: expect.objectContaining({ locator: { providerId: 'core.app', resourceId: 'agents' } })
      }),
      future
    ])
  })
})
