import { and, eq } from 'drizzle-orm'

import { preferenceTable } from '@data/db/schemas/preference'

import type { DbType, ISeeder } from '../../types'

export class MessageNavigationUpgradeSeeder implements ISeeder {
  readonly name = 'messageNavigationUpgrade'
  readonly description = 'Replace retired navigation buttons with conversation anchors'
  readonly version = '1'

  run(db: DbType): void {
    db.update(preferenceTable)
      .set({ value: 'anchor' })
      .where(
        and(
          eq(preferenceTable.scope, 'default'),
          eq(preferenceTable.key, 'chat.message.navigation_mode'),
          eq(preferenceTable.value, 'buttons')
        )
      )
      .run()
  }
}
