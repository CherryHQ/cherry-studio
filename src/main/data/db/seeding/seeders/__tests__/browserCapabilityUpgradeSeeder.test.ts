import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { assistantTable } from '@data/db/schemas/assistant'
import { assistantMcpServerTable, agentMcpServerTable } from '@data/db/schemas/assistantRelations'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

import { BrowserCapabilityUpgradeSeeder } from '../browserCapabilityUpgradeSeeder'

describe('browser capability upgrade', () => {
  const dbh = setupTestDatabase()
  it('preserves old restrictions and external MCP bindings across repeated upgrades', () => {
    const db = dbh.db
    db.insert(mcpServerTable)
      .values([
        {
          id: 'builtin',
          name: '@cherry/browser',
          type: 'inMemory',
          isActive: true,
          disabledAutoApproveTools: ['click']
        },
        { id: 'remote', name: '@cherry/browser', type: 'streamableHttp', isActive: true }
      ])
      .run()
    db.insert(assistantTable)
      .values({ id: 'assistant', name: 'Assistant', emoji: '', orderKey: 'a0', settings: DEFAULT_ASSISTANT_SETTINGS })
      .run()
    db.insert(agentTable)
      .values({ id: 'agent', type: 'pi', name: 'Agent', instructions: '', orderKey: 'a0', disabledTools: ['Bash'] })
      .run()
    db.insert(assistantMcpServerTable)
      .values(['builtin', 'remote'].map((mcpServerId) => ({ assistantId: 'assistant', mcpServerId })))
      .run()
    db.insert(agentMcpServerTable)
      .values(['builtin', 'remote'].map((mcpServerId) => ({ agentId: 'agent', mcpServerId })))
      .run()
    const upgrade = new BrowserCapabilityUpgradeSeeder()
    upgrade.run(db)
    expect(db.select().from(assistantTable).get()?.settings.enableBrowser).toBe(false)
    expect(db.select().from(agentTable).get()?.disabledTools).toEqual(['Bash', 'mcp__browser'])
    expect(
      db
        .select()
        .from(assistantMcpServerTable)
        .all()
        .map((row) => row.mcpServerId)
    ).toEqual(['remote'])
    expect(
      db
        .select()
        .from(agentMcpServerTable)
        .all()
        .map((row) => row.mcpServerId)
    ).toEqual(['remote'])
    expect(db.select().from(mcpServerTable).where(eq(mcpServerTable.id, 'remote')).get()?.isActive).toBe(true)
    db.update(assistantTable)
      .set({ settings: { ...DEFAULT_ASSISTANT_SETTINGS, enableBrowser: true } })
      .run()
    db.update(agentTable)
      .set({ disabledTools: ['Bash'] })
      .run()
    upgrade.run(db)
    expect(db.select().from(assistantTable).get()?.settings.enableBrowser).toBe(true)
    expect(db.select().from(agentTable).get()?.disabledTools).toEqual(['Bash'])
  })
})
