/**
 * DB-level tests for the soft-delete (`deleted_at`) columns added to
 * `painting` and `agent_session` (archive-instead-of-delete, RFC §4.2/§4.6).
 *
 * These verify the generated migration wired the column through: it defaults
 * to NULL, persists an UPDATE, and `isNull(deletedAt)` read filters hide the
 * archived row — the exact filter every list/get query applies.
 */

import { randomUUID } from 'node:crypto'

import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { paintingTable } from '@data/db/schemas/painting'
import { setupTestDatabase } from '@test-helpers/db'
import { and, eq, isNull } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

const TS = 1700000000000
const DELETED_TS = 1700000001000

describe('paintingTable — deletedAt soft-delete column', () => {
  const dbh = setupTestDatabase()

  async function seedPainting(id = randomUUID()) {
    await dbh.db.insert(paintingTable).values({
      id,
      providerId: 'provider',
      modelId: null,
      prompt: 'prompt',
      orderKey: 'a0',
      createdAt: TS,
      updatedAt: TS
    })
    return id
  }

  it('defaults deletedAt to null on insert', async () => {
    const id = await seedPainting()
    const [row] = await dbh.db.select().from(paintingTable).where(eq(paintingTable.id, id))
    expect(row.deletedAt).toBeNull()
  })

  it('persists an UPDATE setting deletedAt', async () => {
    const id = await seedPainting()
    await dbh.db.update(paintingTable).set({ deletedAt: DELETED_TS }).where(eq(paintingTable.id, id))
    const [row] = await dbh.db.select().from(paintingTable).where(eq(paintingTable.id, id))
    expect(row.deletedAt).toBe(DELETED_TS)
  })

  it('hides the soft-deleted row from isNull(deletedAt) reads while keeping it in the table', async () => {
    const id = await seedPainting()
    await dbh.db.update(paintingTable).set({ deletedAt: DELETED_TS }).where(eq(paintingTable.id, id))

    const active = await dbh.db
      .select()
      .from(paintingTable)
      .where(and(eq(paintingTable.id, id), isNull(paintingTable.deletedAt)))
    expect(active).toHaveLength(0)

    const all = await dbh.db.select().from(paintingTable).where(eq(paintingTable.id, id))
    expect(all).toHaveLength(1)
  })
})

describe('agentSessionTable — deletedAt soft-delete column', () => {
  const dbh = setupTestDatabase()

  async function seedSession(id = randomUUID()) {
    const workspaceId = randomUUID()
    await dbh.db.insert(agentWorkspaceTable).values({
      id: workspaceId,
      name: 'workspace',
      path: `/tmp/agent-workspace-${workspaceId}`,
      orderKey: 'a0',
      createdAt: TS,
      updatedAt: TS
    })
    await dbh.db.insert(agentSessionTable).values({
      id,
      agentId: null,
      name: 'session',
      workspaceId,
      orderKey: 'a0',
      createdAt: TS,
      updatedAt: TS
    })
    return id
  }

  it('defaults deletedAt to null on insert', async () => {
    const id = await seedSession()
    const [row] = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, id))
    expect(row.deletedAt).toBeNull()
  })

  it('persists an UPDATE setting deletedAt', async () => {
    const id = await seedSession()
    await dbh.db.update(agentSessionTable).set({ deletedAt: DELETED_TS }).where(eq(agentSessionTable.id, id))
    const [row] = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, id))
    expect(row.deletedAt).toBe(DELETED_TS)
  })

  it('hides the soft-deleted row from isNull(deletedAt) reads while keeping it in the table', async () => {
    const id = await seedSession()
    await dbh.db.update(agentSessionTable).set({ deletedAt: DELETED_TS }).where(eq(agentSessionTable.id, id))

    const active = await dbh.db
      .select()
      .from(agentSessionTable)
      .where(and(eq(agentSessionTable.id, id), isNull(agentSessionTable.deletedAt)))
    expect(active).toHaveLength(0)

    const all = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, id))
    expect(all).toHaveLength(1)
  })
})
