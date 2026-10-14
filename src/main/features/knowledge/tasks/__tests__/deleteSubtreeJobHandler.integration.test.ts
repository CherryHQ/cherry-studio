import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
import type { JobContext } from '@main/core/job/types'
import { BaseService } from '@main/core/lifecycle'

import { KnowledgeService } from '../../KnowledgeService'
import { createDeleteSubtreeJobHandler } from '../deleteSubtreeJobHandler'
import type { KnowledgeDeleteSubtreePayload } from '../jobTypes'

const { recoveredInputs } = vi.hoisted(() => ({ recoveredInputs: [] as KnowledgeDeleteSubtreePayload[] }))

vi.mock('@application', async () => {
  const { mockApplicationFactory, mockJobManager } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    JobManager: {
      ...mockJobManager,
      list: vi.fn(async () => []),
      enqueue: vi.fn((_type: string, input: KnowledgeDeleteSubtreePayload) => {
        recoveredInputs.push(input)
        return { id: 'delete-job', snapshot: {}, finished: Promise.resolve({}) }
      })
    }
  })
})

vi.mock('../../pipeline/vectorstore/vectorCleanup', () => ({
  deleteKnowledgeItemVectors: vi.fn(async () => {}),
  reclaimKnowledgeIndexSpace: vi.fn(async () => {})
}))

const BASE_ID = '11111111-1111-4111-8111-111111111111'
const PARENT_ID = '0198f3f2-7d1a-7abc-8def-123456789abc'
const CHILD_ID = '0198f3f2-7d1b-7abc-8def-123456789abc'
const OUTER_ID = '0198f3f2-7d19-7abc-8def-123456789abc'
const SECOND_PARENT_ID = '0198f3f2-7d1c-7abc-8def-123456789abc'
const SECOND_CHILD_ID = '0198f3f2-7d1d-7abc-8def-123456789abc'
const ROLLUP_ERROR = 'Parent rollup write failed'

describe('knowledge deletion transaction and job retry', () => {
  const dbh = setupTestDatabase()

  function seedItem(values: Partial<typeof knowledgeItemTable.$inferInsert> & { id: string }) {
    dbh.db
      .insert(knowledgeItemTable)
      .values({
        baseId: BASE_ID,
        type: 'note',
        data: { source: 'note', content: 'content' },
        status: 'deleting',
        ...values
      })
      .run()
  }

  beforeEach(() => {
    BaseService.resetInstances()
    recoveredInputs.length = 0
    dbh.db
      .insert(knowledgeBaseTable)
      .values({
        id: BASE_ID,
        name: 'KB',
        status: 'completed',
        chunkSize: 1024,
        chunkOverlap: 200
      })
      .run()
    seedItem({ id: PARENT_ID, type: 'directory', data: { source: '/fixture' }, status: 'processing' })
    seedItem({ id: CHILD_ID, groupId: PARENT_ID })
  })

  afterEach(() => dbh.sqlite.exec('DROP TRIGGER IF EXISTS deletion_rollup_failure'))

  function failRollup(containerId = PARENT_ID) {
    dbh.sqlite.exec(`CREATE TEMP TRIGGER deletion_rollup_failure BEFORE UPDATE OF status ON knowledge_item
      WHEN OLD.id = '${containerId}' BEGIN SELECT RAISE(ABORT, '${ROLLUP_ERROR}'); END`)
  }

  function clearFault() {
    dbh.sqlite.exec('DROP TRIGGER deletion_rollup_failure')
  }

  function row(id: string) {
    return dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, id)).get()
  }

  function deleteItem(method: 'single' | 'batch', id = CHILD_ID) {
    if (method === 'single') knowledgeItemService.delete(id)
    else knowledgeItemService.deleteItemsByIds(BASE_ID, [id])
  }

  function setParentFailed() {
    dbh.db
      .update(knowledgeItemTable)
      .set({ status: 'failed', error: 'One or more child items failed' })
      .where(eq(knowledgeItemTable.id, PARENT_ID))
      .run()
  }

  function createContext(
    attempt: number,
    input: KnowledgeDeleteSubtreePayload = { baseId: BASE_ID, rootItemIds: [CHILD_ID] }
  ): JobContext<KnowledgeDeleteSubtreePayload> {
    return {
      jobId: 'delete-job',
      input,
      attempt,
      parentId: null,
      signal: new AbortController().signal,
      metadata: {},
      patchMetadata: async () => {},
      reportProgress: () => {},
      logger: loggerService.withContext('KnowledgeDeletionTest')
    }
  }

  for (const method of ['single', 'batch'] as const) {
    for (const parentStatus of ['processing', 'failed'] as const) {
      it(`${method}: preserves deletion rows and the ${parentStatus} parent on rollup failure, then retries`, () => {
        if (parentStatus === 'failed') setParentFailed()
        const parentBefore = row(PARENT_ID)
        const childBefore = row(CHILD_ID)
        failRollup()

        expect(() => deleteItem(method)).toThrow(ROLLUP_ERROR)
        expect(row(CHILD_ID)).toEqual(childBefore)
        expect(row(PARENT_ID)).toEqual(parentBefore)

        clearFault()
        deleteItem(method)
        expect(row(CHILD_ID)).toBeUndefined()
        expect(row(PARENT_ID)).toMatchObject({ status: 'completed', error: null })
      })
    }

    it(`${method}: rolls back earlier ancestor updates when a later ancestor fails`, () => {
      seedItem({ id: OUTER_ID, type: 'directory', data: { source: '/outer' }, status: 'processing' })
      dbh.db.update(knowledgeItemTable).set({ groupId: OUTER_ID }).where(eq(knowledgeItemTable.id, PARENT_ID)).run()
      const parentBefore = row(PARENT_ID)
      const outerBefore = row(OUTER_ID)
      failRollup(OUTER_ID)

      expect(() => deleteItem(method)).toThrow(ROLLUP_ERROR)
      expect(row(CHILD_ID)).toMatchObject({ groupId: PARENT_ID, status: 'deleting' })
      expect(row(PARENT_ID)).toEqual(parentBefore)
      expect(row(OUTER_ID)).toEqual(outerBefore)

      clearFault()
      deleteItem(method)
      expect(row(CHILD_ID)).toBeUndefined()
      expect(row(PARENT_ID)).toMatchObject({ status: 'completed', error: null })
      expect(row(OUTER_ID)).toMatchObject({ status: 'completed', error: null })
    })

    it(`${method}: rolls back cascaded descendants with their deleted directory owner`, () => {
      seedItem({ id: OUTER_ID, type: 'directory', data: { source: '/outer' }, status: 'processing' })
      dbh.db
        .update(knowledgeItemTable)
        .set({ groupId: OUTER_ID, status: 'deleting' })
        .where(eq(knowledgeItemTable.id, PARENT_ID))
        .run()
      const parentBefore = row(PARENT_ID)
      const childBefore = row(CHILD_ID)
      failRollup(OUTER_ID)

      expect(() => deleteItem(method, PARENT_ID)).toThrow(ROLLUP_ERROR)
      expect(row(PARENT_ID)).toEqual(parentBefore)
      expect(row(CHILD_ID)).toEqual(childBefore)

      clearFault()
      deleteItem(method, PARENT_ID)
      expect(row(PARENT_ID)).toBeUndefined()
      expect(row(CHILD_ID)).toBeUndefined()
      expect(row(OUTER_ID)).toMatchObject({ status: 'completed', error: null })
    })
  }

  it('rolls back the entire batch when the second independent parent update fails', () => {
    seedItem({ id: SECOND_PARENT_ID, type: 'directory', data: { source: '/second' }, status: 'processing' })
    seedItem({ id: SECOND_CHILD_ID, groupId: SECOND_PARENT_ID })
    failRollup(SECOND_PARENT_ID)

    expect(() => knowledgeItemService.deleteItemsByIds(BASE_ID, [CHILD_ID, SECOND_CHILD_ID, CHILD_ID])).toThrow(
      ROLLUP_ERROR
    )
    expect(row(CHILD_ID)).toMatchObject({ status: 'deleting' })
    expect(row(SECOND_CHILD_ID)).toMatchObject({ status: 'deleting' })
    expect(row(PARENT_ID)).toMatchObject({ status: 'processing', error: null })
    expect(row(SECOND_PARENT_ID)).toMatchObject({ status: 'processing', error: null })

    clearFault()
    knowledgeItemService.deleteItemsByIds(BASE_ID, [CHILD_ID, SECOND_CHILD_ID, CHILD_ID])
    expect(row(CHILD_ID)).toBeUndefined()
    expect(row(SECOND_CHILD_ID)).toBeUndefined()
    expect(row(PARENT_ID)).toMatchObject({ status: 'completed', error: null })
    expect(row(SECOND_PARENT_ID)).toMatchObject({ status: 'completed', error: null })
  })

  for (const parentStatus of ['processing', 'failed'] as const) {
    it(`retries the actual delete-subtree handler and completes its ${parentStatus} parent`, async () => {
      if (parentStatus === 'failed') setParentFailed()
      const handler = createDeleteSubtreeJobHandler(new KeyedMutex())
      failRollup()

      await expect(handler.execute(createContext(1))).rejects.toThrow(ROLLUP_ERROR)
      expect(row(CHILD_ID)).toMatchObject({ groupId: PARENT_ID, status: 'deleting' })

      clearFault()
      await handler.execute(createContext(2))
      expect(row(CHILD_ID)).toBeUndefined()
      expect(row(PARENT_ID)).toMatchObject({ status: 'completed', error: null })
    })
  }

  it('keeps deleting rows discoverable by startup recovery and completes the recovered job', async () => {
    const handler = createDeleteSubtreeJobHandler(new KeyedMutex())
    failRollup()
    await expect(handler.execute(createContext(1))).rejects.toThrow(ROLLUP_ERROR)
    clearFault()

    const runtime = new KnowledgeService()
    await (runtime as unknown as { onAllReady(): Promise<void> }).onAllReady()
    expect(recoveredInputs).toEqual([{ baseId: BASE_ID, rootItemIds: [CHILD_ID] }])
    await handler.execute(createContext(2, recoveredInputs[0]))
    expect(row(CHILD_ID)).toBeUndefined()
    expect(row(PARENT_ID)).toMatchObject({ status: 'completed', error: null })
  })
})
