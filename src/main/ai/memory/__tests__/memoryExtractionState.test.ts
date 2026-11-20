import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { appStateTable } from '@data/db/schemas/appState'

import type { ExtractionTicket } from '../memoryExtraction'
import {
  completeExtraction,
  deferExtraction,
  enqueueExtraction,
  extractionBoundary,
  invalidateExtractions,
  readExtractionState,
  recordExtractionSubmission,
  readyExtraction,
  skipExtractionTurn,
  skipExtractionTurns,
  writeExtractionState
} from '../memoryExtractionState'

describe('durable extraction scheduling', () => {
  setupTestDatabase()
  const key = 'memory:extraction:assistant/topic'
  let now: number
  const ticket = (id: string, createdAt = now): ExtractionTicket => {
    recordExtractionSubmission(key, 'assistant/owner', id, id, 0)
    return {
      inputHash: id,
      input: { kind: 'assistant', topicId: 'topic', responseId: `reply-${id}` },
      entityKey: 'assistant/owner',
      key,
      messageId: id,
      createdAt,
      hash: `version-${id}`
    }
  }
  beforeEach(() => {
    now = new Date(2030, 0, 1, 10).getTime()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
  })
  afterEach(() => vi.restoreAllMocks())

  it('discards tickets from a restored database before admitting new work', () => {
    enqueueExtraction(ticket('from-backup'), 0, new Set(['from-backup']))
    const boundary = extractionBoundary()
    expect(readExtractionState(key)?.pending).toEqual([])
    expect(enqueueExtraction(ticket('from-backup'), boundary, new Set(['from-backup']))).toBe(false)
    now += 100
    expect(enqueueExtraction(ticket('fresh'), boundary, new Set(['fresh']))).toBe(true)
  })

  it('retains a revocation boundary even when no task existed before restart', () => {
    const source = ticket('old')
    now += 100
    invalidateExtractions(key)
    expect(readExtractionState(key)?.submitted).toEqual({})
    expect(extractionBoundary(key)).toBe(now)
    expect(enqueueExtraction(source, 0, new Set(['old']))).toBe(false)
    now += 100
    expect(enqueueExtraction(ticket('new'), 0, new Set(['new']))).toBe(true)
  })

  it('does not spend failure attempts on foreground interruption', () => {
    const ids = Array.from({ length: 8 }, (_, i) => String(i))
    for (const id of ids) enqueueExtraction(ticket(id), 0, new Set(ids))
    expect(readyExtraction()?.state.batchEnd).toBe('7')
    deferExtraction(key, 0, true)
    expect(readExtractionState(key)).toMatchObject({ attempts: 0, retryAt: now + 60_000 })
    now += 60_000
    expect(readyExtraction()?.state.batchEnd).toBe('7')
    deferExtraction(key, 0, false)
    expect(readExtractionState(key)).toMatchObject({ attempts: 1, retryAt: now + 600_000 })
  })

  it('starts a fresh batch after revocation despite a delayed failure from the old worker', () => {
    const old = ticket('old')
    enqueueExtraction(old, 0, new Set(['old']))
    deferExtraction(key, 0, false)
    invalidateExtractions(key)
    now += 100
    const ids = Array.from({ length: 8 }, (_, i) => String(i))
    for (const id of ids) enqueueExtraction(ticket(id), 0, new Set(ids))
    deferExtraction(key, 0, false)
    expect(readyExtraction()?.state).toMatchObject({ generation: 1, attempts: 0, retryAt: 0, batchEnd: '7' })
  })

  it('reads old v2 admissions and clears backoff left on an old empty queue', () => {
    const old = ticket('old')
    enqueueExtraction(old, 0, new Set(['old']))
    const state = readExtractionState(key)!
    const legacy = { ...state, recent: undefined, generation: undefined }
    const db = application.get('DbService').getDb()
    db.update(appStateTable).set({ value: legacy }).where(eq(appStateTable.key, key)).run()
    expect(readExtractionState(key)).toMatchObject({ recent: [], generation: 0, pending: [{ hash: old.hash }] })
    db.update(appStateTable)
      .set({ value: { ...legacy, pending: [], outcome: 'cancelled', retryAt: now + 3600000, attempts: 2 } })
      .where(eq(appStateTable.key, key))
      .run()
    const ids = Array.from({ length: 8 }, (_, i) => String(i))
    for (const id of ids) enqueueExtraction(ticket(id), 0, new Set(ids))
    expect(readyExtraction()?.state).toMatchObject({ attempts: 0, retryAt: 0, batchEnd: '7' })
  })

  it('freezes the overdue daily batch before turns received after the cutoff', () => {
    const ids = Array.from({ length: 8 }, (_, i) => String(i))
    for (const id of ids.slice(0, 3)) enqueueExtraction(ticket(id), 0, new Set(ids))
    now = new Date(2030, 0, 1, 22).getTime()
    for (const id of ids.slice(3)) enqueueExtraction(ticket(id), 0, new Set(ids))
    expect(readyExtraction()?.state.batchEnd).toBe('2')
  })

  it('compacts completed IDs while rejecting old duplicates and accepting same-time new turns', () => {
    const old = ticket('old')
    enqueueExtraction(old, 0, new Set(['old']))
    completeExtraction(key, 'old')
    now += 100
    enqueueExtraction(ticket('latest'), 0, new Set(['latest']))
    completeExtraction(key, 'latest')
    expect(readExtractionState(key)?.settled).toEqual(['latest'])
    expect(enqueueExtraction(old, 0, new Set(['old']))).toBe(false)
    expect(enqueueExtraction(ticket('latest'), 0, new Set(['latest']))).toBe(false)
    expect(enqueueExtraction(ticket('same-time'), 0, new Set(['same-time']))).toBe(true)
  })

  it('keeps uncertain save evidence when an invalid endpoint is retired', () => {
    const ids = Array.from({ length: 8 }, (_, i) => String(i))
    for (const id of ids) enqueueExtraction(ticket(id), 0, new Set(ids))
    const state = readyExtraction()!.state
    state.prepared = { end: '7', sourceHash: 'source', before: 'old', after: 'new' }
    writeExtractionState(key, state)
    skipExtractionTurns(key, ['7'], 'source')
    expect(readExtractionState(key)).toMatchObject({
      batchEnd: '6',
      skippedSource: 1,
      prepared: state.prepared
    })
    expect(readExtractionState(key)?.completed).toBeUndefined()
    skipExtractionTurns(key, ids.slice(0, 7), 'conflict')
    expect(readExtractionState(key)?.excludedThrough?.messageIds).toEqual(expect.arrayContaining(ids))
  })

  it('keeps earlier pending turns editable after a later oversized turn was skipped', () => {
    const first = ticket('first')
    enqueueExtraction(first, 0, new Set(['first']))
    now += 100
    enqueueExtraction(ticket('oversized'), 0, new Set(['first', 'oversized']))
    skipExtractionTurn(key, 'oversized')
    expect(enqueueExtraction({ ...first, hash: 'edited' }, 0, new Set(['first']))).toBe(false)
    expect(
      enqueueExtraction(
        { ...first, input: { ...first.input, responseId: 'new-reply' }, hash: 'edited' },
        0,
        new Set(['first'])
      )
    ).toBe(true)
    expect(readExtractionState(key)?.pending).toMatchObject([{ messageId: 'first', hash: 'edited' }])
    expect(readExtractionState(key)?.skippedBudget).toBe(1)
  })
})
