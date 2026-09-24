import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { preferenceTable } from '@data/db/schemas/preference'
import { CommandShortcutPreferenceUpgradeSeeder } from '@data/db/seeding/seeders/CommandShortcutPreferenceUpgradeSeeder'
import { PreferenceSeeder } from '@data/db/seeding/seeders/preferenceSeeder'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import { resolveCommandShortcutPreference } from '@shared/utils/command'

const SIDEBAR_SHORTCUT_KEYS = ['shortcut.app.sidebar.toggle', 'shortcut.topic.sidebar.toggle'] as const

describe('CommandShortcutPreferenceUpgradeSeeder', () => {
  const dbh = setupTestDatabase()

  const readPreference = (key: (typeof SIDEBAR_SHORTCUT_KEYS)[number]) =>
    dbh.db
      .select({ value: preferenceTable.value })
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, key)))
      .get()?.value

  it('preserves edited unmarked sidebar shortcuts even when migration timestamps are equal', () => {
    dbh.db
      .insert(preferenceTable)
      .values([
        {
          createdAt: 100,
          key: SIDEBAR_SHORTCUT_KEYS[0],
          updatedAt: 100,
          value: { binding: ['CommandOrControl', 'Shift', '['], enabled: true }
        },
        {
          createdAt: 100,
          key: SIDEBAR_SHORTCUT_KEYS[1],
          updatedAt: 100,
          value: { binding: ['CommandOrControl', 'Shift', ']'], enabled: false }
        }
      ])
      .run()

    new CommandShortcutPreferenceUpgradeSeeder().run(dbh.db)

    expect(readPreference(SIDEBAR_SHORTCUT_KEYS[0])).toEqual({
      binding: ['CommandOrControl', 'Shift', '['],
      customized: true,
      enabled: true
    })
    expect(readPreference(SIDEBAR_SHORTCUT_KEYS[1])).toEqual({
      binding: ['CommandOrControl', 'Shift', ']'],
      customized: true,
      enabled: false
    })
  })

  it('maps untouched legacy defaults to the current platform shortcut', () => {
    for (const [key, binding, enabled] of [
      [SIDEBAR_SHORTCUT_KEYS[0], ['Ctrl', '['], false],
      [SIDEBAR_SHORTCUT_KEYS[1], ['Command', ']'], true]
    ] as const) {
      dbh.db.insert(preferenceTable).values({ createdAt: 100, key, updatedAt: 100, value: { binding, enabled } }).run()
    }

    new CommandShortcutPreferenceUpgradeSeeder().run(dbh.db)

    const appSidebar = readPreference(SIDEBAR_SHORTCUT_KEYS[0]) as PreferenceShortcutType
    const topicSidebar = readPreference(SIDEBAR_SHORTCUT_KEYS[1]) as PreferenceShortcutType
    expect(appSidebar).toMatchObject({ customized: false, enabled: false })
    expect(topicSidebar).toMatchObject({ customized: false, enabled: true })
    expect(resolveCommandShortcutPreference('app.sidebar.toggle', appSidebar, 'darwin')?.binding).toEqual([
      'CommandOrControl',
      'Alt',
      '['
    ])
    expect(resolveCommandShortcutPreference('topic.sidebar.toggle', topicSidebar, 'darwin')?.binding).toEqual([
      'CommandOrControl',
      'Alt',
      ']'
    ])
  })

  it('keeps an explicit re-entry of the legacy Cmd+[ / Cmd+] defaults', () => {
    for (const [key, binding] of [
      [SIDEBAR_SHORTCUT_KEYS[0], ['CommandOrControl', '[']],
      [SIDEBAR_SHORTCUT_KEYS[1], ['CommandOrControl', ']']]
    ] as const) {
      dbh.db
        .insert(preferenceTable)
        .values({ createdAt: 100, key, updatedAt: 250, value: { binding, enabled: true } })
        .run()
    }

    new CommandShortcutPreferenceUpgradeSeeder().run(dbh.db)

    const appSidebar = readPreference(SIDEBAR_SHORTCUT_KEYS[0]) as PreferenceShortcutType
    const topicSidebar = readPreference(SIDEBAR_SHORTCUT_KEYS[1]) as PreferenceShortcutType
    expect(appSidebar).toEqual({ binding: ['CommandOrControl', '['], customized: true, enabled: true })
    expect(topicSidebar).toEqual({ binding: ['CommandOrControl', ']'], customized: true, enabled: true })
    expect(resolveCommandShortcutPreference('app.sidebar.toggle', appSidebar, 'darwin')?.binding).toEqual([
      'CommandOrControl',
      '['
    ])
    expect(resolveCommandShortcutPreference('topic.sidebar.toggle', topicSidebar, 'darwin')?.binding).toEqual([
      'CommandOrControl',
      ']'
    ])
    expect(resolveCommandShortcutPreference('app.sidebar.toggle', appSidebar, 'win32')?.binding).toEqual([
      'CommandOrControl',
      '['
    ])
  })

  it('does not mark defaults inserted later for a fresh installation', () => {
    new SeedRunner(dbh.db).runAll([new CommandShortcutPreferenceUpgradeSeeder(), new PreferenceSeeder()])

    for (const key of SIDEBAR_SHORTCUT_KEYS) {
      expect(readPreference(key)).not.toHaveProperty('customized')
    }
  })

  it.each([true, false])('keeps existing customized: %s provenance', (customized) => {
    dbh.db
      .insert(preferenceTable)
      .values({
        key: SIDEBAR_SHORTCUT_KEYS[0],
        value: { binding: ['CommandOrControl', '['], customized, enabled: true }
      })
      .run()

    new CommandShortcutPreferenceUpgradeSeeder().run(dbh.db)

    expect(readPreference(SIDEBAR_SHORTCUT_KEYS[0])).toEqual({
      binding: ['CommandOrControl', '['],
      customized,
      enabled: true
    })
  })
})
