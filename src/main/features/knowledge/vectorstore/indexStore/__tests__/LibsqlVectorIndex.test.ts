import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type LibsqlDriver, openLibsqlIndexDriver } from '../LibsqlDriver'
import { LibsqlVectorIndex } from '../LibsqlVectorIndex'
import { createKnowledgeIndexSchema } from '../schema'
import { encodeVectorBlob } from '../vectorBlob'

describe('LibsqlVectorIndex', () => {
  let tempDir: string
  let driver: LibsqlDriver
  const vectorIndex = new LibsqlVectorIndex()

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'cs-knowledge-vindex-'))
    driver = await openLibsqlIndexDriver(join(tempDir, 'index.sqlite'))
    await createKnowledgeIndexSchema(driver)
  })

  afterEach(async () => {
    await driver.close()
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

  it('brute-force ranks nearest vectors first over a plain-BLOB column', async () => {
    await insertEmbedding('near', [1, 0, 0])
    await insertEmbedding('mid', [0.7, 0.7, 0])
    await insertEmbedding('far', [0, 0, 1])

    const result = await topK([1, 0, 0], 3)

    expect(result.rows.map((row) => row.h)).toEqual(['near', 'mid', 'far'])
    expect(result.rows[0].dist as number).toBeLessThan(0.001)
    expect(result.rows[2].dist as number).toBeGreaterThan(0.9)
  })

  it('respects the LIMIT k bound', async () => {
    await insertEmbedding('a', [1, 0, 0])
    await insertEmbedding('b', [0, 1, 0])

    const result = await topK([1, 0, 0], 1)

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].h).toBe('a')
  })
})
