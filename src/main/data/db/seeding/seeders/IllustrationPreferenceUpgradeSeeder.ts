import { and, eq, inArray } from 'drizzle-orm'

import { preferenceTable } from '@data/db/schemas/preference'
import { IllustrationModeSchema, normalizeIllustrationCount } from '@shared/data/types/illustration'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

const ILLUSTRATION_PREFERENCE_UPGRADE = {
  scope: 'default',
  legacyKey: 'chat.illustration.force_count',
  modeKey: 'chat.illustration.mode',
  maximumKey: 'chat.illustration.max_count',
  targetKey: 'chat.illustration.target_count'
} as const

export class IllustrationPreferenceUpgradeSeeder implements ISeeder {
  readonly name = 'illustrationPreferenceUpgrade'
  readonly description = 'Replace the exact-count switch with mode-specific illustration quantities'
  readonly version = hashObject(ILLUSTRATION_PREFERENCE_UPGRADE)

  run(db: DbType): void {
    const { scope, legacyKey, modeKey, maximumKey, targetKey } = ILLUSTRATION_PREFERENCE_UPGRADE
    const rows = db
      .select({ key: preferenceTable.key, value: preferenceTable.value })
      .from(preferenceTable)
      .where(
        and(eq(preferenceTable.scope, scope), inArray(preferenceTable.key, [legacyKey, modeKey, maximumKey, targetKey]))
      )
      .all()
    const values = new Map(rows.map(({ key, value }) => [key, value]))
    if (!values.has(legacyKey)) return

    const mode = IllustrationModeSchema.catch('off').parse(values.get(modeKey))
    const forceCount = values.get(legacyKey) === true
    const nextMode = forceCount && mode === 'auto' ? 'on' : mode
    const targetCount = forceCount
      ? normalizeIllustrationCount(values.get(targetKey), normalizeIllustrationCount(values.get(maximumKey)))
      : mode === 'on'
        ? 1
        : normalizeIllustrationCount(values.get(targetKey))

    db.transaction((tx) => {
      tx.update(preferenceTable)
        .set({ value: nextMode })
        .where(and(eq(preferenceTable.scope, scope), eq(preferenceTable.key, modeKey)))
        .run()
      tx.update(preferenceTable)
        .set({ value: targetCount })
        .where(and(eq(preferenceTable.scope, scope), eq(preferenceTable.key, targetKey)))
        .run()
      tx.delete(preferenceTable)
        .where(and(eq(preferenceTable.scope, scope), eq(preferenceTable.key, legacyKey)))
        .run()
    })
  }
}
