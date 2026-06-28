/**
 * Integration test: branch_anchor persistence round-trip against the REAL
 * service + SQLite (NOT mocked).
 *
 * Drives the unmocked handlers (DTO parse -> BranchAnchorService -> DB) and
 * ASSERTS THE READ-BACK from GET, never the POST echo. This is the exact
 * round-trip property `topic.metadata` could not satisfy (P2 doc §2 Q1):
 * write JSON-ish business data, read it back unchanged.
 *
 * Uses setupTestDatabase() (real migrations incl. the generated branch_anchor
 * table, FK enforcement ON).
 */

import { branchAnchorHandlers } from '@data/api/handlers/branchAnchors'
import { branchAnchorTable } from '@data/db/schemas/branchAnchor'
import { topicTable } from '@data/db/schemas/topic'
import type { BranchAnchor } from '@shared/data/types/branchAnchor'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

const PARENT_A = '11111111-1111-4111-8111-111111111111'
const PARENT_B = '22222222-2222-4222-8222-222222222222'
const BRANCH_1 = '33333333-3333-4333-8333-333333333333'
const BRANCH_2 = '44444444-4444-4444-8444-444444444444'
const BRANCH_3 = '55555555-5555-4555-8555-555555555555'

const post = (body: unknown): Promise<BranchAnchor> =>
  branchAnchorHandlers['/branch-anchors'].POST({ body } as never) as Promise<BranchAnchor>

const list = (id: string): Promise<BranchAnchor[]> =>
  branchAnchorHandlers['/topics/:id/branch-anchors'].GET({ params: { id } } as never) as Promise<BranchAnchor[]>

const patch = (id: string, body: unknown): Promise<BranchAnchor> =>
  branchAnchorHandlers['/branch-anchors/:id'].PATCH({ params: { id }, body } as never) as Promise<BranchAnchor>

// A complete, valid create body; override individual fields per test.
const validCreate = (over: Record<string, unknown> = {}) => ({
  parentTopicId: PARENT_A,
  branchTopicId: BRANCH_1,
  messageId: 'msg-1',
  blockId: 'block-1',
  selectedText: 'the selected passage',
  selectionStart: 8,
  selectionEnd: 24,
  ...over
})

describe('branchAnchorHandlers (real service + DB round-trip)', () => {
  const dbh = setupTestDatabase()

  // FK: parentTopicId / branchTopicId -> topic.id (CASCADE). Seed topics first.
  async function seedTopics() {
    await dbh.db.insert(topicTable).values([
      { id: PARENT_A, name: 'parent A', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
      { id: PARENT_B, name: 'parent B', orderKey: 'a1', createdAt: 1, updatedAt: 1 },
      { id: BRANCH_1, name: 'branch 1', orderKey: 'a2', createdAt: 1, updatedAt: 1 },
      { id: BRANCH_2, name: 'branch 2', orderKey: 'a3', createdAt: 1, updatedAt: 1 },
      { id: BRANCH_3, name: 'branch 3', orderKey: 'a4', createdAt: 1, updatedAt: 1 }
    ])
  }

  it('POST then GET reads back every field (asserts the read-back, not the POST echo)', async () => {
    await seedTopics()
    const input = validCreate()

    await post(input) // discard the POST result on purpose

    const rows = await list(PARENT_A)
    expect(rows).toHaveLength(1)
    const got = rows[0]
    // Every field equals what went in.
    expect(got.parentTopicId).toBe(input.parentTopicId)
    expect(got.branchTopicId).toBe(input.branchTopicId)
    expect(got.messageId).toBe(input.messageId)
    expect(got.blockId).toBe(input.blockId)
    expect(got.selectedText).toBe(input.selectedText)
    expect(got.selectionStart).toBe(input.selectionStart)
    expect(got.selectionEnd).toBe(input.selectionEnd)
    // DB defaults materialize on read-back.
    expect(got.disposition).toBe('kept')
    expect(got.summary ?? null).toBeNull()
    expect(got.summaryUpdatedAt ?? null).toBeNull()
    // Generated id + ISO timestamps.
    expect(typeof got.id).toBe('string')
    expect(got.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('PATCH summary persists and reads back (summary + summaryUpdatedAt round-trip)', async () => {
    await seedTopics()
    await post(validCreate())
    const [created] = await list(PARENT_A)

    const iso = '2026-06-25T00:00:00.000Z'
    await patch(created.id, { summary: 'a conclusion', summaryUpdatedAt: iso })

    const [after] = await list(PARENT_A)
    expect(after.summary).toBe('a conclusion')
    expect(after.summaryUpdatedAt).toBe(iso) // ISO -> ms -> ISO round-trips
  })

  it('strict DTO: rejects an unknown key (ZodError, nothing persisted)', async () => {
    await seedTopics()
    await expect(post(validCreate({ bogus: 'x' }))).rejects.toHaveProperty('name', 'ZodError')
    expect(await list(PARENT_A)).toHaveLength(0)
  })

  it('strict DTO: rejects a missing required field (ZodError)', async () => {
    // selectionEnd omitted.
    await expect(
      post({
        parentTopicId: PARENT_A,
        branchTopicId: BRANCH_1,
        messageId: 'msg-1',
        blockId: 'block-1',
        selectedText: 't',
        selectionStart: 0
      })
    ).rejects.toHaveProperty('name', 'ZodError')
  })

  it.each([
    ['negative selectionStart', { selectionStart: -1 }],
    ['negative selectionEnd', { selectionEnd: -1 }],
    ['selectionEnd equals selectionStart', { selectionStart: 8, selectionEnd: 8 }],
    ['selectionEnd before selectionStart', { selectionStart: 9, selectionEnd: 8 }],
    ['empty selectedText', { selectedText: '' }]
  ])('strict DTO: rejects invalid anchor coordinates (%s)', async (_label, override) => {
    await seedTopics()

    await expect(post(validCreate(override))).rejects.toHaveProperty('name', 'ZodError')
    expect(await list(PARENT_A)).toHaveLength(0)
  })

  it('DB uniqueness: duplicate branchTopicId cannot create two stored anchor rows', async () => {
    await seedTopics()
    await post(validCreate({ branchTopicId: BRANCH_1, messageId: 'msg-original' }))

    await expect(
      post(
        validCreate({
          branchTopicId: BRANCH_1,
          messageId: 'msg-duplicate',
          blockId: 'block-duplicate',
          selectedText: 'different selected text',
          selectionStart: 0,
          selectionEnd: 9
        })
      )
    ).rejects.toBeTruthy()

    const readBackRows = await list(PARENT_A)
    expect(readBackRows).toHaveLength(1)
    expect(readBackRows[0].branchTopicId).toBe(BRANCH_1)
    expect(readBackRows[0].messageId).toBe('msg-original')

    const rawRows = await dbh.db.select().from(branchAnchorTable).where(eq(branchAnchorTable.branchTopicId, BRANCH_1))
    expect(rawRows).toHaveLength(1)
    expect(rawRows[0].messageId).toBe('msg-original')
  })

  it('listByParent isolation: rows under A never appear under B; all rows under one parent return', async () => {
    await seedTopics()
    await post(validCreate({ branchTopicId: BRANCH_1 }))
    await post(validCreate({ branchTopicId: BRANCH_2 }))
    await post(validCreate({ parentTopicId: PARENT_B, branchTopicId: BRANCH_3 }))

    const aRows = await list(PARENT_A)
    const bRows = await list(PARENT_B)

    expect(aRows).toHaveLength(2)
    expect(aRows.every((r) => r.parentTopicId === PARENT_A)).toBe(true)
    expect(aRows.map((r) => r.branchTopicId).sort()).toEqual([BRANCH_1, BRANCH_2])
    expect(bRows).toHaveLength(1)
    expect(bRows[0].parentTopicId).toBe(PARENT_B)
    expect(bRows[0].branchTopicId).toBe(BRANCH_3)
  })

  it('FK cascade: deleting the parent topic removes its anchor rows (asserted via read-back)', async () => {
    await seedTopics()
    await post(validCreate())
    expect(await list(PARENT_A)).toHaveLength(1)

    await dbh.db.delete(topicTable).where(eq(topicTable.id, PARENT_A))

    expect(await list(PARENT_A)).toHaveLength(0)
    const all = await dbh.db.select().from(branchAnchorTable)
    expect(all).toHaveLength(0)
  })
})
