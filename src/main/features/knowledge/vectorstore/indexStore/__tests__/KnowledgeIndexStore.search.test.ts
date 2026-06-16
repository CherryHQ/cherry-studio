import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { needsLikeFallback } from '../ftsQuery'
import { hashEmbeddingText } from '../hashing'
import { KnowledgeIndexStore } from '../KnowledgeIndexStore'
import { type LibsqlDriver, openLibsqlIndexDriver } from '../LibsqlDriver'
import { libsqlVectorIndex } from '../LibsqlVectorIndex'
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
  const indexMaterial = (materialId: string, relativePath: string, text: string, vector: number[]) =>
    store.rebuildMaterial(materialId, {
      material: { relativePath },
      content: { text },
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

  it('vector mode drops a degenerate zero-norm embedding instead of ranking it first', async () => {
    await indexMaterial('m1', 'a.md', 'apple pie', [1, 0, 0])
    // A zero vector has undefined cosine distance (libsql returns NULL). Without the
    // `dist IS NOT NULL` guard it sorts first under `ORDER BY dist` and scores a perfect
    // `1 - Number(null) = 1`, outranking the real hit — so it must be excluded entirely.
    await indexMaterial('m2', 'b.md', 'banana bread', [0, 0, 0])

    const matches = await store.search({ queryText: '', queryEmbedding: [1, 1, 0], mode: 'vector', topK: 10 })

    expect(matches.map((m) => m.materialId)).toEqual(['m1'])
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

  it('bm25 mode falls back to a LIKE substring scan for short CJK queries the trigram FTS cannot index', async () => {
    await indexMaterial('m1', 'a.md', '今天天气很好', [1, 0, 0])
    await indexMaterial('m2', 'b.md', '我喜欢编程', [0, 1, 0])

    // '天气' is 2 characters → produces no trigram → a bare MATCH returns nothing.
    const matches = await store.search({ queryText: '天气', mode: 'bm25', topK: 10 })

    expect(matches.map((m) => m.materialId)).toEqual(['m1'])
  })

  it('LIKE fallback ANDs every token, so a mixed short+long query still filters correctly', async () => {
    await indexMaterial('m1', 'a.md', '系统 architecture overview', [1, 0, 0])
    await indexMaterial('m2', 'b.md', '系统 design notes', [0, 1, 0])

    // The 2-char '系统' routes the whole query to LIKE; 'architecture' must still constrain it.
    const matches = await store.search({ queryText: '系统 architecture', mode: 'bm25', topK: 10 })

    expect(matches.map((m) => m.materialId)).toEqual(['m1'])
  })

  it('bm25 mode answers a 3+ character CJK query through the trigram MATCH path', async () => {
    // The primary lane for Chinese content: a 4-char token produces trigrams, so
    // the query takes FTS5 MATCH, not the LIKE fallback — pin the routing here so
    // the real-DB expectations below provably exercise the trigram index.
    expect(needsLikeFallback('天气预报')).toBe(false)

    await indexMaterial('m1', 'a.md', '明天的天气预报说有雨', [1, 0, 0])
    await indexMaterial('m2', 'b.md', '我喜欢户外编程活动', [0, 1, 0])

    const matches = await store.search({ queryText: '天气预报', mode: 'bm25', topK: 10 })
    expect(matches.map((m) => m.materialId)).toEqual(['m1'])

    // A 3+ char CJK query whose trigrams appear nowhere must return empty via MATCH.
    expect(needsLikeFallback('量子计算')).toBe(false)
    expect(await store.search({ queryText: '量子计算', mode: 'bm25', topK: 10 })).toEqual([])
  })

  it('hybrid mode lifts a short-CJK LIKE-only hit above a closer vector-only competitor', async () => {
    // m2 sits exactly on the query embedding but does NOT contain '天气'; m1 is
    // orthogonal in vector space but matches '天气' via the LIKE fallback. The BM25
    // contribution must lift m1 above m2 — drop the LIKE fallback and the order
    // flips to ['m2', 'm1'], so this pins the fallback's effect on hybrid ranking.
    await indexMaterial('m1', 'a.md', '今天天气', [0, 1, 0])
    await indexMaterial('m2', 'b.md', 'sunny day', [1, 0, 0])

    const matches = await store.search({
      queryText: '天气',
      queryEmbedding: [1, 0, 0],
      mode: 'hybrid',
      topK: 10
    })

    expect(matches.map((m) => m.materialId)).toEqual(['m1', 'm2'])
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
