import { describe, expect, it, vi } from 'vitest'

import { KnowledgeIndexStore } from '../KnowledgeIndexStore'
import type { SqliteDriver, SqlQueryResult, SqlValue, VectorIndex } from '../types'

const vectorIndex: VectorIndex = {
  buildDistanceExpression: (column) => `dist(${column})`,
  bindQueryVector: (values) => `[${values.join(',')}]`
}

/** A row as the vector lane query reads it back (score derived from `dist`). */
const vectorRow = (unitId: string, materialId: string, dist: number): Record<string, SqlValue> => ({
  unit_id: unitId,
  material_id: materialId,
  unit_index: 0,
  body: unitId,
  dist
})

/** A row as the bm25 lane query reads it back (score derived from `score`). */
const bm25Row = (unitId: string, materialId: string, score: number): Record<string, SqlValue> => ({
  unit_id: unitId,
  material_id: materialId,
  unit_index: 0,
  body: unitId,
  score
})

/**
 * Fake driver that routes the store's two lane queries by SQL shape and records
 * the LIMIT bound to each, so hybrid prefetch and RRF fusion can be asserted
 * without a real database. The vector and bm25 lanes are the only callers.
 */
function createFakeDriver(vectorRows: Array<Record<string, SqlValue>>, bm25Rows: Array<Record<string, SqlValue>>) {
  const limits: { vector?: number; bm25?: number } = {}
  const execute = vi.fn(async (sql: string, args: SqlValue[] = []): Promise<SqlQueryResult> => {
    const limit = Number(args[args.length - 1])
    if (sql.includes('search_text_fts MATCH')) {
      limits.bm25 = limit
      return { rows: bm25Rows }
    }
    limits.vector = limit
    return { rows: vectorRows }
  })
  const driver: SqliteDriver = {
    execute,
    transaction: async (fn) => fn({ execute }),
    isClosed: () => false,
    close: async () => undefined
  }
  return { driver, limits }
}

const RRF_K = 60

describe('KnowledgeIndexStore hybrid RRF fusion', () => {
  it('prefetches topK × 5 candidates per lane before fusing', async () => {
    const { driver, limits } = createFakeDriver([], [])
    const store = new KnowledgeIndexStore(driver, vectorIndex)

    await store.search({ queryText: 'query', queryEmbedding: [1, 0], mode: 'hybrid', topK: 4 })

    expect(limits.vector).toBe(20)
    expect(limits.bm25).toBe(20)
  })

  it('fuses lanes with reciprocal rank fusion (1-indexed rank, RRF_K) weighted by alpha', async () => {
    // Vector ranks A above B; bm25 ranks B above A.
    const { driver } = createFakeDriver(
      [vectorRow('A', 'mA', 0), vectorRow('B', 'mB', 0.5)],
      [bm25Row('B', 'mB', -1), bm25Row('A', 'mA', -2)]
    )
    const store = new KnowledgeIndexStore(driver, vectorIndex)
    const alpha = 0.75

    const results = await store.search({ queryText: 'query', queryEmbedding: [1, 0], mode: 'hybrid', topK: 10, alpha })

    // score = alpha/(RRF_K + vRank + 1) + (1 - alpha)/(RRF_K + bRank + 1), ranks 0-indexed.
    const scoreA = alpha / (RRF_K + 1) + (1 - alpha) / (RRF_K + 2)
    const scoreB = alpha / (RRF_K + 2) + (1 - alpha) / (RRF_K + 1)
    const scoreById = Object.fromEntries(results.map((match) => [match.unitId, match.score]))

    expect(scoreById.A).toBeCloseTo(scoreA, 12)
    expect(scoreById.B).toBeCloseTo(scoreB, 12)
    // alpha favors the vector lane, so A (vector rank 1) ends up on top.
    expect(results.map((match) => match.unitId)).toEqual(['A', 'B'])
  })

  it('fails loud when a lane row is missing its body text (store corruption)', async () => {
    // Unreachable through a healthy DB (the lanes INNER JOIN a NOT NULL column),
    // so corruption is simulated via the fake driver. Fabricating '' here would
    // hide the damage — toMatch must throw like listMaterialUnits does.
    const { driver } = createFakeDriver([{ unit_id: 'A', material_id: 'mA', unit_index: 0, body: null, dist: 0 }], [])
    const store = new KnowledgeIndexStore(driver, vectorIndex)

    await expect(store.search({ queryText: '', queryEmbedding: [1, 0], mode: 'vector', topK: 5 })).rejects.toThrow(
      'missing the body text for unit A'
    )
  })

  it('defaults alpha to 0.5, weighting both lanes equally', async () => {
    // Mirror-image ranks: with equal weight the two units must tie exactly.
    const { driver } = createFakeDriver(
      [vectorRow('A', 'mA', 0), vectorRow('B', 'mB', 0.5)],
      [bm25Row('B', 'mB', -1), bm25Row('A', 'mA', -2)]
    )
    const store = new KnowledgeIndexStore(driver, vectorIndex)

    const results = await store.search({ queryText: 'query', queryEmbedding: [1, 0], mode: 'hybrid', topK: 10 })

    const scoreById = Object.fromEntries(results.map((match) => [match.unitId, match.score]))
    expect(scoreById.A).toBeCloseTo(scoreById.B, 12)
  })
})
