import { and, eq, inArray } from 'drizzle-orm'

import { preferenceTable } from '@data/db/schemas/preference'

import type { DbType, ISeeder } from '../../types'

const LEGACY_SIDEBAR_SHORTCUT_KEYS = ['shortcut.app.sidebar.toggle', 'shortcut.topic.sidebar.toggle'] as const

function isUnmarkedShortcutPreference(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Array.isArray((value as Record<string, unknown>).binding) &&
    typeof (value as Record<string, unknown>).enabled === 'boolean' &&
    (value as Record<string, unknown>).customized === undefined
  )
}

export class CommandShortcutPreferenceUpgradeSeeder implements ISeeder {
  readonly name = 'command-shortcut-preference-upgrade'
  readonly version = '1'
  readonly description = 'Preserve existing sidebar shortcut bindings before platform defaults change'

  run(db: DbType): void {
    const rows = db
      .select({
        key: preferenceTable.key,
        value: preferenceTable.value,
        createdAt: preferenceTable.createdAt,
        updatedAt: preferenceTable.updatedAt
      })
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), inArray(preferenceTable.key, [...LEGACY_SIDEBAR_SHORTCUT_KEYS])))
      .all()
    const updates = rows.flatMap(({ key, value, createdAt, updatedAt }) =>
      updatedAt > createdAt && isUnmarkedShortcutPreference(value) ? [{ key, value }] : []
    )

    if (!updates.length) return

    db.transaction((tx) => {
      for (const { key, value } of updates) {
        tx.update(preferenceTable)
          .set({ value: { ...value, customized: true } })
          .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, key)))
          .run()
      }
    })
  }
}
