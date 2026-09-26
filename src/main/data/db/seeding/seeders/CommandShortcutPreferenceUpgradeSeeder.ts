import { and, eq, inArray } from 'drizzle-orm'

import { preferenceTable } from '@data/db/schemas/preference'
import { isLegacySidebarDefaultBinding } from '@shared/utils/command'
import { normalizeShortcutBinding, type ShortcutBinding } from '@shared/utils/shortcut'

import type { DbType, ISeeder } from '../../types'

const LEGACY_SIDEBAR_SHORTCUT_KEYS = ['shortcut.app.sidebar.toggle', 'shortcut.topic.sidebar.toggle'] as const

function isShortcutPreference(value: unknown): value is Record<string, unknown> & { binding: ShortcutBinding } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Array.isArray((value as Record<string, unknown>).binding) &&
    typeof (value as Record<string, unknown>).enabled === 'boolean'
  )
}

function shouldPreserveSidebarShortcut(
  value: Record<string, unknown> & { binding: ShortcutBinding },
  key: string
): boolean {
  if (value.customized === true) return false
  const binding = normalizeShortcutBinding(value.binding)
  // A reset stores the current platform chord with customized: false. A legacy
  // chord tagged the same way is an existing binding and must be kept.
  if (value.customized === false) return isLegacySidebarDefaultBinding(key, binding)
  return true
}

export class CommandShortcutPreferenceUpgradeSeeder implements ISeeder {
  readonly name = 'command-shortcut-preference-upgrade'
  readonly version = '2'
  readonly description = 'Preserve existing sidebar shortcut bindings before platform defaults change'

  run(db: DbType): void {
    const rows = db
      .select({
        key: preferenceTable.key,
        value: preferenceTable.value
      })
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), inArray(preferenceTable.key, [...LEGACY_SIDEBAR_SHORTCUT_KEYS])))
      .all()
    const updates = rows.flatMap(({ key, value }) => {
      if (!isShortcutPreference(value) || !shouldPreserveSidebarShortcut(value, key)) return []
      return [{ customized: true, key, value }]
    })

    if (!updates.length) return

    db.transaction((tx) => {
      for (const { customized, key, value } of updates) {
        tx.update(preferenceTable)
          .set({ value: { ...value, customized } })
          .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, key)))
          .run()
      }
    })
  }
}
