import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { preferenceTable } from '@data/db/schemas/preference'
import { ScheduledTasksShortcutSeeder } from '@data/db/seeding/seeders/scheduledTasksShortcutSeeder'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import { createSidebarShortcutId, type SidebarShortcutTarget } from '@shared/data/preference/preferenceTypes'

describe('scheduled task shortcut upgrade', () => {
  const dbh = setupTestDatabase()
  const scope = and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, 'ui.sidebar_shortcut'))
  const shortcut = (id: string) => {
    const target: SidebarShortcutTarget = { kind: 'resource', locator: { providerId: 'core.app', resourceId: id } }
    return { type: 'shortcut', id: createSidebarShortcutId(target), target }
  }
  const read = () => dbh.db.select().from(preferenceTable).where(scope).get()?.value
  const seed = () => new SeedRunner(dbh.db).runAll([new ScheduledTasksShortcutSeeder()])

  it('inserts next to conversations without reordering user shortcuts, and respects removal after upgrade', () => {
    const original = [shortcut('notes'), shortcut('agents'), shortcut('assistants'), shortcut('files')]
    dbh.db.insert(preferenceTable).values({ scope: 'default', key: 'ui.sidebar_shortcut', value: original }).run()
    seed()
    expect(read()).toEqual([...original.slice(0, 3), shortcut('scheduled_tasks'), original[3]])
    dbh.db.update(preferenceTable).set({ value: original }).where(scope).run()
    seed()
    expect(read()).toEqual(original)
  })

  it('preserves an already pinned task entry at its existing position', () => {
    const original = [shortcut('scheduled_tasks'), shortcut('notes'), shortcut('agents')]
    dbh.db.insert(preferenceTable).values({ scope: 'default', key: 'ui.sidebar_shortcut', value: original }).run()
    seed()
    expect(read()).toEqual(original)
  })

  it('appends when neither conversation shortcut is pinned', () => {
    dbh.db
      .insert(preferenceTable)
      .values({ scope: 'default', key: 'ui.sidebar_shortcut', value: [shortcut('notes')] })
      .run()
    seed()
    expect(read()).toEqual([shortcut('notes'), shortcut('scheduled_tasks')])
  })
})
