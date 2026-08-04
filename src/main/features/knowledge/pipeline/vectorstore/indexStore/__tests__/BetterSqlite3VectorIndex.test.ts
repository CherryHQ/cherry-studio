import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type BetterSqlite3Driver, openBetterSqlite3IndexDriver } from '../BetterSqlite3Driver'
import { BetterSqlite3VectorIndex } from '../BetterSqlite3VectorIndex'
import { createKnowledgeIndexSchema } from '../schema'
import { encodeVectorBlob } from '../vectorBlob'

describe('BetterSqlite3VectorIndex', () => {
  let tempDir: string
  let driver: BetterSqlite3Driver
  const vectorIndex = new BetterSqlite3VectorIndex()

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cs-knowledge-vindex-'))
    driver = openBetterSqlite3IndexDriver(join(tempDir, 'index.sqlite'))
    createKnowledgeIndexSchema(driver)
  })

  afterEach(() => {
    driver.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  const insertEmbedding = (hash: string, vector: number[]) =>
    driver.execute('INSERT INTO embedding (embedding_text_hash, vector_blob, created_at) VALUES (?, ?, ?)', [
      hash,
      encodeVectorBlob(vector),
      1_700_000_000_000
    ])

  const topK = (query: number[], k: number) =>
    driver.execute(
      `SELECT embedding_text_hash AS h, ${vectorIndex.buildDistanceExpression('vector_blob')} AS dist
       FROM embedding ORDER BY dist LIMIT ?`,
      [vectorIndex.bindQueryVector(query), k]
    )

  it('brute-force ranks nearest vectors first over a plain-BLOB column', () => {
    insertEmbedding('near', [1, 0, 0])
    insertEmbedding('mid', [0.7, 0.7, 0])
    insertEmbedding('far', [0, 0, 1])

    const result = topK([1, 0, 0], 3)

    expect(result.rows.map((row) => row.h)).toEqual(['near', 'mid', 'far'])
    expect(result.rows[0].dist as number).toBeLessThan(0.001)
    expect(result.rows[2].dist as number).toBeGreaterThan(0.9)
  })

  it('respects the LIMIT k bound', () => {
    insertEmbedding('a', [1, 0, 0])
    insertEmbedding('b', [0, 1, 0])

    const result = topK([1, 0, 0], 1)

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].h).toBe('a')
  })
})
