import { and, eq } from 'drizzle-orm'

import { preferenceTable } from '@data/db/schemas/preference'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

const MESSAGE_TOOL_DENSITY_UPGRADE = {
  scope: 'default',
  legacyKey: 'chat.message.thought.auto_collapse',
  nextKey: 'chat.message.density'
} as const

export class MessageToolDensityUpgradeSeeder implements ISeeder {
  readonly name = 'messageToolDensityUpgrade'
  readonly description = 'Fold the retired thought auto-collapse boolean into the tool-call density enum'
  readonly version = hashObject(MESSAGE_TOOL_DENSITY_UPGRADE)

  run(db: DbType): void {
    const legacyPreference = db
      .select({ value: preferenceTable.value })
      .from(preferenceTable)
      .where(
        and(
          eq(preferenceTable.scope, MESSAGE_TOOL_DENSITY_UPGRADE.scope),
          eq(preferenceTable.key, MESSAGE_TOOL_DENSITY_UPGRADE.legacyKey)
        )
      )
      .get()
    if (!legacyPreference) return

    db.transaction((tx) => {
      tx.insert(preferenceTable)
        .values({
          scope: MESSAGE_TOOL_DENSITY_UPGRADE.scope,
          key: MESSAGE_TOOL_DENSITY_UPGRADE.nextKey,
          value: legacyPreference.value === false ? 'detailed' : 'compact'
        })
        // A returning user who already picked a density keeps it — the seeder
        // only fills the gap for databases that still hold the legacy key.
        .onConflictDoNothing({ target: [preferenceTable.scope, preferenceTable.key] })
        .run()
      tx.delete(preferenceTable)
        .where(
          and(
            eq(preferenceTable.scope, MESSAGE_TOOL_DENSITY_UPGRADE.scope),
            eq(preferenceTable.key, MESSAGE_TOOL_DENSITY_UPGRADE.legacyKey)
          )
        )
        .run()
    })
  }
}
