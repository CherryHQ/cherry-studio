import { and, eq } from 'drizzle-orm'

import { preferenceTable } from '@data/db/schemas/preference'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import { SELECTION_ACTION_RUNNER } from '@shared/data/preference/preferenceTypes'
import { SELECTION_BUILTIN_ACTION_ID } from '@shared/types/selection'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

const ASK_AGENT_DEFAULT = DefaultPreferences.default['feature.selection.action_items'].find(
  (item) => item.id === SELECTION_BUILTIN_ACTION_ID.ASK_AGENT
)

export class SelectionActionItemsUpgradeSeeder implements ISeeder {
  readonly name = 'selectionActionItemsUpgrade'
  readonly description = 'Add Ask Agent and explicit runners to existing selection action lists'
  readonly version = hashObject(ASK_AGENT_DEFAULT)

  run(db: DbType): void {
    const isActionItems = and(
      eq(preferenceTable.scope, 'default'),
      eq(preferenceTable.key, 'feature.selection.action_items')
    )

    const row = db.select({ value: preferenceTable.value }).from(preferenceTable).where(isActionItems).get()

    // A fresh install has no row yet; PreferenceSeeder then writes the default list, which includes it.
    if (!row || !Array.isArray(row.value)) return

    const rawItems: unknown[] = row.value

    const items = rawItems.flatMap<object>((item) => {
      if (typeof item !== 'object' || item === null) return []

      if (('isBuiltIn' in item && item.isBuiltIn) || ('runner' in item && item.runner)) return [item]

      return [
        {
          ...item,
          runner:
            'assistantId' in item && item.assistantId
              ? SELECTION_ACTION_RUNNER.ASSISTANT
              : SELECTION_ACTION_RUNNER.DEFAULT
        }
      ]
    })

    // Existing installs get Ask Agent disabled so it does not take a toolbar slot they arranged.
    if (ASK_AGENT_DEFAULT && !items.some((item) => 'id' in item && item.id === ASK_AGENT_DEFAULT.id)) {
      items.push({ ...ASK_AGENT_DEFAULT, enabled: false })
    }

    db.update(preferenceTable).set({ value: items }).where(isActionItems).run()
  }
}
