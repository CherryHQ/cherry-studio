import { and, eq } from 'drizzle-orm'

import { preferenceTable } from '@data/db/schemas/preference'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

// Existing installs get the action disabled so it does not take a toolbar slot they arranged.
const ASK_AGENT_ITEM: SelectionActionItem = {
  enabled: false,
  icon: 'bot',
  id: 'ask-agent',
  isBuiltIn: true,
  name: 'selection.action.builtin.ask_agent'
}

export class SelectionAskAgentUpgradeSeeder implements ISeeder {
  readonly name = 'selectionAskAgentUpgrade'
  readonly description = 'Append the Ask Agent selection action to existing action lists'
  readonly version = hashObject(ASK_AGENT_ITEM)

  run(db: DbType): void {
    const isActionItems = and(
      eq(preferenceTable.scope, 'default'),
      eq(preferenceTable.key, 'feature.selection.action_items')
    )
    const row = db.select({ value: preferenceTable.value }).from(preferenceTable).where(isActionItems).get()
    // A fresh install has no row yet; PreferenceSeeder then writes the default list, which includes it.
    if (!row || !Array.isArray(row.value)) return

    const items = row.value as SelectionActionItem[]
    if (items.some((item) => item.id === ASK_AGENT_ITEM.id)) return

    db.update(preferenceTable)
      .set({ value: [...items, ASK_AGENT_ITEM] })
      .where(isActionItems)
      .run()
  }
}
