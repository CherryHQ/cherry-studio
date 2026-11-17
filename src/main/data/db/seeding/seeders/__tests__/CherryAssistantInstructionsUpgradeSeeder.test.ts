import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { agentTable, type InsertAgentRow } from '@data/db/schemas/agent'
import { appStateTable } from '@data/db/schemas/appState'
import { seeders } from '@data/db/seeding/seederRegistry'
import { SeedRunner } from '@data/db/seeding/SeedRunner'

import stock from './fixtures/cherry-assistant-3b7a1c5ca6-parent-instructions.json'

describe('CherryAssistantInstructionsUpgradeSeeder', () => {
  const dbh = setupTestDatabase()
  const upgradeSeeders = seeders.filter((seeder) => seeder.name === 'cherryAssistantInstructionsUpgrade')

  function insertAgent(overrides: Partial<InsertAgentRow> = {}) {
    return dbh.db
      .insert(agentTable)
      .values({
        type: 'pi',
        name: 'My assistant',
        instructions: stock.instructions['en-US'],
        orderKey: 'a0',
        configuration: { builtin_role: 'assistant', permission_mode: 'default' },
        ...overrides
      })
      .returning()
      .get()
  }

  it.each(['en-US', 'zh-CN'] as const)(
    'upgrades %s stock on an existing installation and preserves other fields',
    (locale) => {
      const agent = insertAgent({ instructions: stock.instructions[locale] })
      dbh.db
        .insert(appStateTable)
        .values([
          { key: 'seedRunner:bootstrapCompleted', value: { completedAt: 1 } },
          { key: 'seed:cherryAssistant', value: { version: '2' } }
        ])
        .run()

      new SeedRunner(dbh.db).runAll(upgradeSeeders)

      expect(dbh.db.select().from(agentTable).all()).toEqual([
        { ...agent, instructions: '', updatedAt: expect.any(Number) }
      ])
    }
  )

  it('preserves custom bytes, other roles, blank instructions, and deleted assistants', () => {
    const original = [
      insertAgent({ instructions: 'Write code for me.' }),
      insertAgent({ instructions: `${stock.instructions['en-US']} ` }),
      insertAgent({ instructions: stock.instructions['en-US'].replace('advisor', 'Advisor') }),
      insertAgent({ instructions: `${stock.instructions['zh-CN'].slice(0, -1)}。` }),
      insertAgent({ instructions: '' }),
      insertAgent({ instructions: ' \n' }),
      insertAgent({ configuration: {} }),
      insertAgent({ configuration: { builtin_role: 'support' } }),
      insertAgent({ configuration: { builtin_role: 'doctor' } }),
      insertAgent({ deletedAt: 1 })
    ]

    new SeedRunner(dbh.db).runAll(upgradeSeeders)

    expect(dbh.db.select().from(agentTable).all()).toEqual(original)
  })

  it('journals the upgrade so later user choices survive subsequent startups', () => {
    const agent = insertAgent()
    const runner = new SeedRunner(dbh.db)
    runner.runAll(upgradeSeeders)
    expect(dbh.db.select().from(agentTable).get()?.instructions).toBe('')

    dbh.db
      .update(agentTable)
      .set({ instructions: stock.instructions['en-US'] })
      .where(eq(agentTable.id, agent.id))
      .run()
    runner.runAll(upgradeSeeders)

    expect(dbh.db.select().from(agentTable).get()?.instructions).toBe(stock.instructions['en-US'])
  })

  it('can safely retry without creating agents or overwriting a later customization', () => {
    for (const seeder of upgradeSeeders) seeder.run(dbh.db)
    expect(dbh.db.select().from(agentTable).all()).toEqual([])

    const agent = insertAgent()
    for (const seeder of upgradeSeeders) seeder.run(dbh.db)
    expect(dbh.db.select().from(agentTable).get()?.instructions).toBe('')
    for (const seeder of upgradeSeeders) seeder.run(dbh.db)
    expect(dbh.db.select().from(agentTable).get()?.instructions).toBe('')

    dbh.db.update(agentTable).set({ instructions: 'My new instructions' }).where(eq(agentTable.id, agent.id)).run()
    for (const seeder of upgradeSeeders) seeder.run(dbh.db)
    expect(dbh.db.select().from(agentTable).get()?.instructions).toBe('My new instructions')
  })
})
