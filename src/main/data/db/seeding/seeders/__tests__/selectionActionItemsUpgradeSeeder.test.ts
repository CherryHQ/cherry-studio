import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { preferenceTable } from '@data/db/schemas/preference'
import { seeders } from '@data/db/seeding/seederRegistry'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'

const ACTION_ITEMS_KEY = 'feature.selection.action_items'
const ACTION_ITEM_SEEDERS = seeders.filter(
  ({ name }) => name === 'selectionActionItemsUpgrade' || name === 'preference'
)

const ASK_AGENT_DISABLED: SelectionActionItem = {
  id: 'ask-agent',
  name: 'selection.action.builtin.ask_agent',
  enabled: false,
  isBuiltIn: true,
  icon: 'bot'
}

describe('SelectionActionItemsUpgradeSeeder', () => {
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

  it('appends Ask Agent disabled once and keeps existing items in order', () => {
    const existing: SelectionActionItem[] = [
      { id: 'search', name: 'selection.action.builtin.search', enabled: true, isBuiltIn: true, icon: 'search' },
      { id: 'translate', name: 'selection.action.builtin.translate', enabled: false, isBuiltIn: true }
    ]
    writeActionItems(existing)

    new SeedRunner(dbh.db).runAll(ACTION_ITEM_SEEDERS)
    new SeedRunner(dbh.db).runAll(ACTION_ITEM_SEEDERS)

    expect(readActionItems()).toEqual([...existing, ASK_AGENT_DISABLED])
  })

  it('gives legacy custom actions the runner their assistant id implied', () => {
    writeActionItems([
      { id: 'user-1', name: 'Vocabulary', enabled: true, isBuiltIn: false, prompt: 'Add {{text}}', assistantId: 'a-1' },
      { id: 'user-2', name: 'Polish', enabled: true, isBuiltIn: false, assistantId: '' },
      { id: 'user-3', name: 'Research', enabled: false, isBuiltIn: false }
    ])

    new SeedRunner(dbh.db).runAll(ACTION_ITEM_SEEDERS)

    expect(readActionItems()?.map(({ id, runner }) => ({ id, runner }))).toEqual([
      { id: 'user-1', runner: 'assistant' },
      { id: 'user-2', runner: 'default' },
      { id: 'user-3', runner: 'default' },
      { id: 'ask-agent', runner: undefined }
    ])
  })

  it('leaves an already upgraded action list unchanged', () => {
    const upgraded: SelectionActionItem[] = [
      {
        id: 'ask-agent',
        name: 'selection.action.builtin.ask_agent',
        enabled: true,
        isBuiltIn: true,
        agentId: 'agent-1'
      },
      { id: 'user-1', name: 'Research', enabled: true, isBuiltIn: false, runner: 'agent', assistantId: 'a-1' }
    ]
    writeActionItems(upgraded)

    new SeedRunner(dbh.db).runAll(ACTION_ITEM_SEEDERS)

    expect(readActionItems()).toEqual(upgraded)
  })
})
