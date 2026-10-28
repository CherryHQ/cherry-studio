import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { preferenceTable } from '@data/db/schemas/preference'
import { seeders } from '@data/db/seeding/seederRegistry'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'

const ACTION_ITEMS_KEY = 'feature.selection.action_items'
const ACTION_ITEM_SEEDERS = seeders.filter(({ name }) => name === 'selectionAskAgentUpgrade' || name === 'preference')

const EXISTING_ITEMS: SelectionActionItem[] = [
  { id: 'search', name: 'selection.action.builtin.search', enabled: true, isBuiltIn: true, icon: 'search' },
  { id: 'user-1', name: 'Vocabulary', enabled: true, isBuiltIn: false, prompt: 'Add {{text}}', assistantId: 'a-1' },
  { id: 'translate', name: 'selection.action.builtin.translate', enabled: false, isBuiltIn: true, icon: 'languages' }
]

describe('SelectionAskAgentUpgradeSeeder', () => {
  const dbh = setupTestDatabase()

  const readActionItems = () =>
    dbh.db
      .select({ value: preferenceTable.value })
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, ACTION_ITEMS_KEY)))
      .get()?.value as SelectionActionItem[] | undefined

  const writeActionItems = (value: SelectionActionItem[]) => {
    dbh.db.insert(preferenceTable).values({ scope: 'default', key: ACTION_ITEMS_KEY, value }).run()
  }

  it('lists Ask Agent enabled on a new installation', () => {
    new SeedRunner(dbh.db).runAll(ACTION_ITEM_SEEDERS)

    const askAgent = readActionItems()?.filter((item) => item.id === 'ask-agent')
    expect(askAgent).toEqual([expect.objectContaining({ enabled: true, isBuiltIn: true, icon: 'bot' })])
  })

  it('appends Ask Agent disabled once without touching the existing items', () => {
    writeActionItems(EXISTING_ITEMS)

    new SeedRunner(dbh.db).runAll(ACTION_ITEM_SEEDERS)
    new SeedRunner(dbh.db).runAll(ACTION_ITEM_SEEDERS)

    expect(readActionItems()).toEqual([
      ...EXISTING_ITEMS,
      {
        id: 'ask-agent',
        name: 'selection.action.builtin.ask_agent',
        enabled: false,
        isBuiltIn: true,
        icon: 'bot'
      }
    ])
  })

  it('leaves an action list that already has Ask Agent alone', () => {
    const arranged: SelectionActionItem[] = [
      {
        id: 'ask-agent',
        name: 'selection.action.builtin.ask_agent',
        enabled: true,
        isBuiltIn: true,
        agentId: 'agent-1'
      },
      ...EXISTING_ITEMS
    ]
    writeActionItems(arranged)

    new SeedRunner(dbh.db).runAll(ACTION_ITEM_SEEDERS)

    expect(readActionItems()).toEqual(arranged)
  })
})
