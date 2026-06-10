import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { hashEmbeddingText } from '../hashing'
import { KnowledgeIndexStore } from '../KnowledgeIndexStore'
import { type LibsqlDriver, openLibsqlIndexDriver } from '../LibsqlDriver'
import { libsqlVectorIndex } from '../LibsqlVectorIndex'
import type { MaterialIndexPolicy } from '../model'
import { createKnowledgeIndexSchema } from '../schema'

describe('KnowledgeIndexStore.search', () => {
  let tempDir: string
  let driver: LibsqlDriver
  let store: KnowledgeIndexStore

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'cs-knowledge-search-'))
    driver = await openLibsqlIndexDriver(join(tempDir, 'index.sqlite'))
    await createKnowledgeIndexSchema(driver)
    store = new KnowledgeIndexStore(driver, libsqlVectorIndex)
  })

  afterEach(async () => {
    await store.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  /** Index a single-unit material whose body spans the whole text, with one explicit embedding. */
  const indexMaterial = (
    materialId: string,
    relativePath: string,
    text: string,
    vector: number[],
    indexPolicy: MaterialIndexPolicy = 'index'
  ) =>
    store.rebuildMaterial(materialId, {
      material: { relativePath, origin: 'user', indexPolicy },
      content: { text, textFormat: 'markdown', normalizationVersion: 1 },
      units: [{ unitType: 'chunk', unitIndex: 0, charStart: 0, charEnd: text.length }],
      embeddings: [{ embeddingTextHash: hashEmbeddingText(text), vector }]
    })

  it('vector mode ranks units by cosine similarity to the query embedding', async () => {
    await indexMaterial('m1', 'a.md', 'apple pie', [1, 0, 0])
    await indexMaterial('m2', 'b.md', 'banana bread', [0, 1, 0])

    const matches = await store.search({ queryText: '', queryEmbedding: [0.95, 0.05, 0], mode: 'vector', topK: 10 })

    expect(matches.map((m) => m.materialId)).toEqual(['m1', 'm2'])
    expect(matches[0].score).toBeGreaterThan(matches[1].score)
  })

  it('bm25 mode returns only units whose body matches the query tokens', async () => {
    await indexMaterial('m1', 'a.md', 'apple pie', [1, 0, 0])
    await indexMaterial('m2', 'b.md', 'banana bread', [0, 1, 0])

    const matches = await store.search({ queryText: 'banana', mode: 'bm25', topK: 10 })

    expect(matches.map((m) => m.materialId)).toEqual(['m2'])
  })

  it('bm25 mode returns nothing when the query has no usable token', async () => {
    await indexMaterial('m1', 'a.md', 'apple pie', [1, 0, 0])

    expect(await store.search({ queryText: '!!!', mode: 'bm25', topK: 10 })).toEqual([])
  })

  it('hybrid fusion ranks a unit hit by both lanes above one hit by a single lane', async () => {
    // Vector favors m1; BM25 favors m2. RRF should lift m2 because it appears in both lanes.
    await indexMaterial('m1', 'a.md', 'apple pie', [1, 0, 0])
    await indexMaterial('m2', 'b.md', 'banana bread', [0, 1, 0])

    const matches = await store.search({
      queryText: 'banana',
      queryEmbedding: [0.95, 0.05, 0],
      mode: 'hybrid',
      topK: 10
    })

    expect(matches.map((m) => m.materialId)).toEqual(['m2', 'm1'])
  })

  it('excludes materials that are not indexable from every lane', async () => {
    await indexMaterial('m1', 'a.md', 'secret data', [1, 0, 0], 'index')
    await indexMaterial('m2', 'b.md', 'secret data', [1, 0, 0], 'suppress')

    expect((await store.search({ queryText: 'secret', mode: 'bm25', topK: 10 })).map((m) => m.materialId)).toEqual([
      'm1'
    ])
    expect(
      (await store.search({ queryText: '', queryEmbedding: [1, 0, 0], mode: 'vector', topK: 10 })).map(
        (m) => m.materialId
      )
    ).toEqual(['m1'])
  })

  it('honors topK', async () => {
    await indexMaterial('m1', 'a.md', 'alpha text', [1, 0, 0])
    await indexMaterial('m2', 'b.md', 'beta text', [0, 1, 0])
    await indexMaterial('m3', 'c.md', 'gamma text', [0, 0, 1])

    expect(await store.search({ queryText: '', queryEmbedding: [1, 1, 1], mode: 'vector', topK: 2 })).toHaveLength(2)
  })

  it('rejects vector and hybrid search without a query embedding', async () => {
    await indexMaterial('m1', 'a.md', 'apple pie', [1, 0, 0])

    await expect(store.search({ queryText: 'apple', mode: 'vector', topK: 5 })).rejects.toThrow(/query embedding/)
    await expect(store.search({ queryText: 'apple', mode: 'hybrid', topK: 5 })).rejects.toThrow(/query embedding/)
  })
})
