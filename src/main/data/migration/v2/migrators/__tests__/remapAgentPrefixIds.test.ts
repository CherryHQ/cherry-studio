import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { setupTestDatabase } from '@test-helpers/db'
import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { remapAgentPrefixIds } from '../remapAgentPrefixIds'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

async function insertAgent(db: ReturnType<typeof setupTestDatabase>['db'], id: string) {
  await db.insert(agentTable).values({
    id,
    type: 'claude-code',
    name: 'Test Agent',
    instructions: 'You are a helpful assistant.',
    model: null,
    orderKey: 'a0'
  })
}

async function insertSession(db: ReturnType<typeof setupTestDatabase>['db'], sessionId: string, agentId: string) {
  const workspaceId = `workspace-${sessionId}`
  await db.insert(agentWorkspaceTable).values({
    id: workspaceId,
    name: workspaceId,
    path: `/tmp/${workspaceId}`,
    type: 'user',
    orderKey: 'a0'
  })
  await db.insert(agentSessionTable).values({
    id: sessionId,
    agentId,
    name: 'Test Session',
    workspaceId,
    orderKey: 'a0'
  })
}

describe('remapAgentPrefixIds', () => {
  const dbh = setupTestDatabase()

  beforeEach(async () => {
    // remapAgentPrefixIds no longer toggles FK itself — it runs inside the engine's
    // migration-wide FK=OFF window (MigrationDbService). Mirror that here so the id-remap
    // UPDATEs don't trip FK enforcement during the transient parent/child id mismatch.
    await dbh.db.run(sql`PRAGMA foreign_keys = OFF`)
  })

  it('migrates agent_* prefix IDs to UUIDs and updates FK references', async () => {
    const agentId = 'agent_1234567890_abc123'
    await insertAgent(dbh.db, agentId)
    await insertSession(dbh.db, 'session_111_aaa', agentId)

    await remapAgentPrefixIds(dbh.db)

    const agents = await dbh.db.select().from(agentTable)
    expect(agents).toHaveLength(1)
    expect(agents[0].id).toMatch(UUID_PATTERN)
    expect(agents[0].id).not.toBe(agentId)

    const sessions = await dbh.db.select().from(agentSessionTable)
    expect(sessions[0].agentId).toBe(agents[0].id)
  })

  it('migrates session_* prefix IDs and updates child FK references', async () => {
    const agentId = 'agent_2345678901_bcd234'
    const sessionId = 'session_2345678901_bcd234'
    await insertAgent(dbh.db, agentId)
    await insertSession(dbh.db, sessionId, agentId)
    await dbh.db.insert(agentSessionMessageTable).values({
      sessionId,
      status: 'success',
      role: 'user',
      data: { parts: [{ type: 'text', text: 'hello' }] } as never
    })

    await remapAgentPrefixIds(dbh.db)

    const sessions = await dbh.db.select().from(agentSessionTable)
    const newSession = sessions.find((s) => s.id !== sessionId)!
    expect(newSession.id).toMatch(UUID_PATTERN)

    const messages = await dbh.db.select().from(agentSessionMessageTable)
    expect(messages[0].sessionId).toBe(newSession.id)
  })

  // Note: task_* prefix-id remap was removed when agent.task tasks migrated
  // out of `agent_task` into `job_schedule`. The migrator now writes fresh
  // UUIDs into job_schedule directly — no in-place rewrite is needed.

  it('migrates hardcoded builtin agent IDs to UUIDs', async () => {
    await insertAgent(dbh.db, 'cherry-claw-default')
    await insertAgent(dbh.db, 'cherry-assistant-default')

    await remapAgentPrefixIds(dbh.db)

    const agents = await dbh.db.select().from(agentTable)
    const ids = agents.map((a) => a.id)
    expect(ids).not.toContain('cherry-claw-default')
    expect(ids).not.toContain('cherry-assistant-default')
    for (const id of ids) {
      expect(id).toMatch(UUID_PATTERN)
    }
  })

  it('leaves rows that already have UUID IDs untouched', async () => {
    const uuidId = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789'
    await insertAgent(dbh.db, uuidId)

    const before = await dbh.db.select({ id: agentTable.id }).from(agentTable)
    await remapAgentPrefixIds(dbh.db)
    const after = await dbh.db.select({ id: agentTable.id }).from(agentTable)

    expect(after.map((r) => r.id)).toContain(uuidId)
    expect(after.length).toBe(before.length)
  })

  it('passes PRAGMA foreign_key_check after remapping', async () => {
    const agentId = 'agent_9999999999_zzz'
    const sessionId = 'session_9999999999_zzz'
    await insertAgent(dbh.db, agentId)
    await insertSession(dbh.db, sessionId, agentId)

    await remapAgentPrefixIds(dbh.db)

    const violations = await dbh.db.all(sql`PRAGMA foreign_key_check`)
    expect(violations).toHaveLength(0)
  })
})
