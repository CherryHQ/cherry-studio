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
  const indexMaterial = (materialId: string, relativePath: string, text: string, vector: number[], title = '') =>
    store.rebuildMaterial(materialId, {
      material: { relativePath },
      content: { text },
      title,
      units: [{ unitType: 'chunk', unitIndex: 0, charStart: 0, charEnd: text.length }],
      embeddings: [
        { embeddingTextHash: hashEmbeddingText(text), vector },
        ...(title ? [{ embeddingTextHash: hashEmbeddingText(title), vector }] : [])
      ]
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

  describe('title (file-name) search', () => {
    it('bm25 mode finds a material by its file name even when the body does not contain the query', async () => {
      // Body text is unrelated to the file name — searching for the file name should still work.
      await indexMaterial('m1', 'chapter 1.pdf', 'The quick brown fox jumps over the lazy dog', [1, 0, 0], 'chapter 1')
      await indexMaterial('m2', 'chapter 2.pdf', 'Lorem ipsum dolor sit amet consectetur', [0, 1, 0], 'chapter 2')

      const matches = await store.search({ queryText: 'chapter 1', mode: 'bm25', topK: 10 })

      expect(matches.map((m) => m.materialId)).toEqual(['m1'])
    })

    it('vector mode finds a material by its file name embedding', async () => {
      // Title embedding is close to the query embedding; body is unrelated.
      await indexMaterial('m1', 'report.pdf', 'Some unrelated content', [1, 0, 0], 'report')
      await indexMaterial('m2', 'notes.md', 'Other unrelated content', [0, 1, 0], 'notes')

      // Query embedding close to 'report' title embedding
      const matches = await store.search({ queryText: '', queryEmbedding: [0.9, 0.1, 0], mode: 'vector', topK: 10 })

      // m1 should rank first (body + title embeddings); m2 may appear lower
      expect(matches[0].materialId).toBe('m1')
    })

    it('hybrid mode ranks a file-name match above a body-only competitor', async () => {
      // m2's body exactly matches 'chapter 1' but m1's file name matches.
      // The title boost should lift m1 above m2.
      await indexMaterial('m1', 'chapter 1.pdf', 'completely unrelated text', [0, 1, 0], 'chapter 1')
      await indexMaterial('m2', 'other.pdf', 'chapter 1 is mentioned here', [1, 0, 0])

      const matches = await store.search({
        queryText: 'chapter 1',
        queryEmbedding: [0, 1, 0],
        mode: 'hybrid',
        topK: 10
      })

      // m1 should rank first due to the title boost
      expect(matches[0].materialId).toBe('m1')
    })

    it('LIKE fallback for short CJK finds by file name', async () => {
      // '天气' is 2 chars → LIKE fallback. File name contains it but body does not.
      await indexMaterial('m1', '天气报告.pdf', 'unrelated content', [1, 0, 0], '天气报告')
      await indexMaterial('m2', 'other.pdf', 'also unrelated', [0, 1, 0], '其他文件')

      const matches = await store.search({ queryText: '天气', mode: 'bm25', topK: 10 })

      expect(matches.map((m) => m.materialId)).toEqual(['m1'])
    })

    it('backfillMissingTitleRows adds title rows for materials without them', async () => {
      // Index materials without titles (simulating pre-title-feature items)
      await store.rebuildMaterial('m1', {
        material: { relativePath: 'chapter 1.pdf' },
        content: { text: 'some content' },
        title: '',
        units: [{ unitType: 'chunk', unitIndex: 0, charStart: 0, charEnd: 12 }],
        embeddings: [{ embeddingTextHash: hashEmbeddingText('some content'), vector: [1, 0, 0] }]
      })

      // Before backfill, searching by file name should not find it
      const before = await store.search({ queryText: 'chapter 1', mode: 'bm25', topK: 10 })
      expect(before).toHaveLength(0)

      // Run backfill
      const backfilled = await store.backfillMissingTitleRows()
      expect(backfilled).toBe(1)

      // After backfill, searching by file name should find it
      const after = await store.search({ queryText: 'chapter 1', mode: 'bm25', topK: 10 })
      expect(after.map((m) => m.materialId)).toEqual(['m1'])
    })

    it('backfillMissingTitleRows is idempotent', async () => {
      await store.rebuildMaterial('m1', {
        material: { relativePath: 'test.pdf' },
        content: { text: 'content' },
        title: '',
        units: [{ unitType: 'chunk', unitIndex: 0, charStart: 0, charEnd: 7 }],
        embeddings: [{ embeddingTextHash: hashEmbeddingText('content'), vector: [1, 0, 0] }]
      })

      const first = await store.backfillMissingTitleRows()
      const second = await store.backfillMissingTitleRows()

      expect(first).toBe(1)
      expect(second).toBe(0) // Already backfilled
    })
  })
})
