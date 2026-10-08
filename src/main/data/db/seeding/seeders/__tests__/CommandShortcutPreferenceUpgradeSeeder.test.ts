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

  it('preserves untouched stored sidebar chords instead of adopting the macOS platform default', () => {
    for (const [key, binding, enabled] of [
      [SIDEBAR_SHORTCUT_KEYS[0], ['Ctrl', '['], false],
      [SIDEBAR_SHORTCUT_KEYS[1], ['Command', ']'], true]
    ] as const) {
      dbh.db.insert(preferenceTable).values({ createdAt: 100, key, updatedAt: 100, value: { binding, enabled } }).run()
    }

    new CommandShortcutPreferenceUpgradeSeeder().run(dbh.db)

    const appSidebar = readPreference(SIDEBAR_SHORTCUT_KEYS[0]) as PreferenceShortcutType
    const topicSidebar = readPreference(SIDEBAR_SHORTCUT_KEYS[1]) as PreferenceShortcutType
    expect(appSidebar).toEqual({ binding: ['Ctrl', '['], customized: true, enabled: false })
    expect(topicSidebar).toEqual({ binding: ['Command', ']'], customized: true, enabled: true })
    expect(resolveCommandShortcutPreference('app.sidebar.toggle', appSidebar, 'darwin')?.binding).toEqual(['Ctrl', '['])
    expect(resolveCommandShortcutPreference('topic.sidebar.toggle', topicSidebar, 'darwin')?.binding).toEqual([
      'Command',
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

  it('keeps a fresh installation row on its stored shared-default chord', () => {
    new SeedRunner(dbh.db).runAll([new CommandShortcutPreferenceUpgradeSeeder(), new PreferenceSeeder()])

    const appSidebar = readPreference(SIDEBAR_SHORTCUT_KEYS[0]) as PreferenceShortcutType
    const topicSidebar = readPreference(SIDEBAR_SHORTCUT_KEYS[1]) as PreferenceShortcutType
    expect(appSidebar).toEqual({ binding: ['CommandOrControl', '['], customized: false, enabled: true })
    expect(topicSidebar).toEqual({ binding: ['CommandOrControl', ']'], customized: false, enabled: true })
    expect(resolveCommandShortcutPreference('app.sidebar.toggle', appSidebar, 'darwin')?.binding).toEqual([
      'CommandOrControl',
      '['
    ])
    expect(resolveCommandShortcutPreference('topic.sidebar.toggle', topicSidebar, 'darwin')?.binding).toEqual([
      'CommandOrControl',
      ']'
    ])
    expect(resolveCommandShortcutPreference('topic.sidebar.toggle', topicSidebar, 'win32')?.binding).toEqual([
      'CommandOrControl',
      ']'
    ])
  })

  it('keeps an explicit customized true provenance', () => {
    dbh.db
      .insert(preferenceTable)
      .values({
        key: SIDEBAR_SHORTCUT_KEYS[0],
        value: { binding: ['CommandOrControl', '['], customized: true, enabled: true }
      })
      .run()

    new CommandShortcutPreferenceUpgradeSeeder().run(dbh.db)

    expect(readPreference(SIDEBAR_SHORTCUT_KEYS[0])).toEqual({
      binding: ['CommandOrControl', '['],
      customized: true,
      enabled: true
    })
  })

  it('promotes a legacy chord that was tagged uncustomized', () => {
    dbh.db
      .insert(preferenceTable)
      .values({
        key: SIDEBAR_SHORTCUT_KEYS[0],
        value: { binding: ['CommandOrControl', '['], customized: false, enabled: true }
      })
      .run()

    new CommandShortcutPreferenceUpgradeSeeder().run(dbh.db)

    const stored = readPreference(SIDEBAR_SHORTCUT_KEYS[0]) as PreferenceShortcutType
    expect(stored).toEqual({ binding: ['CommandOrControl', '['], customized: true, enabled: true })
    expect(resolveCommandShortcutPreference('app.sidebar.toggle', stored, 'darwin')?.binding).toEqual([
      'CommandOrControl',
      '['
    ])
  })

  it('leaves a reset platform chord tagged uncustomized without changing its effective chord', () => {
    dbh.db
      .insert(preferenceTable)
      .values({
        key: SIDEBAR_SHORTCUT_KEYS[0],
        value: { binding: ['CommandOrControl', 'Alt', '['], customized: false, enabled: true }
      })
      .run()

    new CommandShortcutPreferenceUpgradeSeeder().run(dbh.db)

    const stored = readPreference(SIDEBAR_SHORTCUT_KEYS[0]) as PreferenceShortcutType
    expect(stored).toEqual({
      binding: ['CommandOrControl', 'Alt', '['],
      customized: false,
      enabled: true
    })
    expect(resolveCommandShortcutPreference('app.sidebar.toggle', stored, 'darwin')?.binding).toEqual([
      'CommandOrControl',
      'Alt',
      '['
    ])
    expect(resolveCommandShortcutPreference('app.sidebar.toggle', stored, 'win32')?.binding).toEqual([
      'CommandOrControl',
      'Alt',
      '['
    ])
  })

  it('preserves every saved sidebar chord, including ones equal to the old default', () => {
    const saved = [
      {
        key: SIDEBAR_SHORTCUT_KEYS[0],
        command: 'app.sidebar.toggle' as const,
        binding: ['CommandOrControl', '['] as const,
        enabled: true
      },
      {
        key: SIDEBAR_SHORTCUT_KEYS[1],
        command: 'topic.sidebar.toggle' as const,
        binding: ['CommandOrControl', ']'] as const,
        enabled: false
      },
      {
        key: SIDEBAR_SHORTCUT_KEYS[0],
        command: 'app.sidebar.toggle' as const,
        binding: ['Command', '['] as const,
        enabled: true
      },
      {
        key: SIDEBAR_SHORTCUT_KEYS[1],
        command: 'topic.sidebar.toggle' as const,
        binding: ['Ctrl', ']'] as const,
        enabled: true
      },
      {
        key: SIDEBAR_SHORTCUT_KEYS[0],
        command: 'app.sidebar.toggle' as const,
        binding: ['CommandOrControl', 'Shift', '['] as const,
        enabled: false
      }
    ]

    for (const row of saved) {
      dbh.db.delete(preferenceTable).where(eq(preferenceTable.key, row.key)).run()
      dbh.db
        .insert(preferenceTable)
        .values({
          createdAt: 100,
          key: row.key,
          updatedAt: 100,
          value: { binding: [...row.binding], enabled: row.enabled }
        })
        .run()

      new CommandShortcutPreferenceUpgradeSeeder().run(dbh.db)

      const stored = readPreference(row.key) as PreferenceShortcutType
      expect(stored).toEqual({ binding: [...row.binding], customized: true, enabled: row.enabled })
      for (const platform of ['darwin', 'win32', 'linux'] as const) {
        expect(resolveCommandShortcutPreference(row.command, stored, platform)?.binding).toEqual([...row.binding])
      }
    }
  })
})
