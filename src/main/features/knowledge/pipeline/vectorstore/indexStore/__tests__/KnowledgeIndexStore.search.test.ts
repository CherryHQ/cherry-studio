import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { needsLikeFallback } from '@main/utils/trigramFtsQuery'

import { type BetterSqlite3Driver, openBetterSqlite3IndexDriver } from '../BetterSqlite3Driver'
import { betterSqlite3VectorIndex } from '../BetterSqlite3VectorIndex'
import { hashEmbeddingText } from '../hashing'
import { KnowledgeIndexStore } from '../KnowledgeIndexStore'
import { createKnowledgeIndexSchema } from '../schema'

describe('KnowledgeIndexStore.search', () => {
  let tempDir: string
  let driver: BetterSqlite3Driver
  let store: KnowledgeIndexStore

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cs-knowledge-search-'))
    driver = openBetterSqlite3IndexDriver(join(tempDir, 'index.sqlite'))
    createKnowledgeIndexSchema(driver)
    store = new KnowledgeIndexStore(driver, betterSqlite3VectorIndex)
  })

  afterEach(async () => {
    store.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  /** Index a single-unit material whose body spans the whole text, with one explicit embedding. */
  const indexMaterial = (materialId: string, relativePath: string, text: string, vector: number[]) =>
    store.rebuildMaterial(materialId, {
      material: { relativePath },
      content: { text },
      units: [{ unitType: 'chunk', unitIndex: 0, charStart: 0, charEnd: text.length }],
      usesEmbeddings: true,
      embeddings: [{ embeddingTextHash: hashEmbeddingText(text), vector }]
    })

  it('vector mode ranks units by cosine similarity to the query embedding', async () => {
    indexMaterial('m1', 'a.md', 'apple pie', [1, 0, 0])
    indexMaterial('m2', 'b.md', 'banana bread', [0, 1, 0])

    const matches = store.search({ queryText: '', queryEmbedding: [0.95, 0.05, 0], mode: 'vector', topK: 10 })

    expect(matches.map((m) => m.materialId)).toEqual(['m1', 'm2'])
    expect(matches[0].score).toBeGreaterThan(matches[1].score)
  })

  it('vector mode drops a degenerate zero-norm embedding instead of ranking it first', async () => {
    indexMaterial('m1', 'a.md', 'apple pie', [1, 0, 0])
    // A zero vector has undefined cosine distance (sqlite-vec returns NaN, coerced to
    // NULL). Without the `dist IS NOT NULL` guard it sorts first under `ORDER BY dist`
    // and scores a perfect `1 - Number(null) = 1`, outranking the real hit — so it must
    // be excluded entirely.
    indexMaterial('m2', 'b.md', 'banana bread', [0, 0, 0])

    const matches = store.search({ queryText: '', queryEmbedding: [1, 1, 0], mode: 'vector', topK: 10 })

    expect(matches.map((m) => m.materialId)).toEqual(['m1'])
  })

  it('bm25 mode returns only units whose body matches the query tokens', async () => {
    indexMaterial('m1', 'a.md', 'apple pie', [1, 0, 0])
    indexMaterial('m2', 'b.md', 'banana bread', [0, 1, 0])

    const matches = store.search({ queryText: 'banana', mode: 'bm25', topK: 10 })

    expect(matches.map((m) => m.materialId)).toEqual(['m2'])
  })

  it('indexes a BM25-only material (usesEmbeddings: false, no embeddings) and finds it via bm25 search', async () => {
    // The rebuild path's false branch (no vectors written, no coverage check) has never
    // been exercised against a real store — every other test in this file goes through
    // `indexMaterial`, which always supplies a vector.
    const text = 'lexical only content with no embedding model'
    store.rebuildMaterial('m1', {
      material: { relativePath: 'a.md' },
      content: { text },
      units: [{ unitType: 'chunk', unitIndex: 0, charStart: 0, charEnd: text.length }],
      usesEmbeddings: false,
      embeddings: []
    })

    const matches = store.search({ queryText: 'lexical', mode: 'bm25', topK: 10 })

    expect(matches.map((m) => m.materialId)).toEqual(['m1'])
  })

  it('bm25 mode returns nothing when the query has no usable token', async () => {
    indexMaterial('m1', 'a.md', 'apple pie', [1, 0, 0])

    expect(store.search({ queryText: '!!!', mode: 'bm25', topK: 10 })).toEqual([])
  })

  it('bm25 mode falls back to a LIKE substring scan for short CJK queries the trigram FTS cannot index', async () => {
    indexMaterial('m1', 'a.md', '今天天气很好', [1, 0, 0])
    indexMaterial('m2', 'b.md', '我喜欢编程', [0, 1, 0])

    // '天气' is 2 characters → produces no trigram → a bare MATCH returns nothing.
    const matches = store.search({ queryText: '天气', mode: 'bm25', topK: 10 })

    expect(matches.map((m) => m.materialId)).toEqual(['m1'])
  })

  it('keeps a short CJK keyword as a LIKE filter on the ranked MATCH path', async () => {
    indexMaterial('m1', 'a.md', '系统 architecture overview', [1, 0, 0])
    indexMaterial('m2', 'b.md', '系统 design notes', [0, 1, 0])
    // Decoy: matches the MATCH term but not the short keyword. If '系统' were
    // simply dropped (instead of AND-ed as a LIKE filter), this unit would not
    // only appear — it would outrank m1.
    indexMaterial('m3', 'c.md', 'Java architecture guide', [0, 0, 1])

    // The 2-char '系统' cannot be trigram-indexed, but it must not reroute the
    // query to LIKE either: 'architecture' stays on the ranked MATCH path and
    // '系统' constrains it as a substring filter.
    expect(needsLikeFallback('系统 architecture')).toBe(false)
    const matches = store.search({ queryText: '系统 architecture', mode: 'bm25', topK: 10 })

    expect(matches.map((m) => m.materialId)).toEqual(['m1'])
  })

  it('keeps a short Latin keyword as a LIKE filter on a CJK trigram query', async () => {
    // 'Go' is the query's only mention of its actual subject; '并发编程' rides the
    // trigram MATCH path. Without the short-term filter the Java unit would tie.
    indexMaterial('m1', 'a.md', 'Go 语言并发编程指南', [1, 0, 0])
    indexMaterial('m2', 'b.md', 'Java 并发编程实战', [0, 1, 0])

    const matches = store.search({ queryText: 'Go 并发编程', mode: 'bm25', topK: 10 })

    expect(matches.map((m) => m.materialId)).toEqual(['m1'])
  })

  it('bm25 mode answers a CJK question phrased around the indexed wording', async () => {
    // Regression: the whole CJK clause was sent as one quoted token, which the trigram
    // tokenizer reads as an exact-substring demand — so a question that merely *contains*
    // the indexed words ('报销流程') matched nothing, leaving a BM25-only base unusable.
    indexMaterial('m1', 'a.md', '员工报销流程：先在系统中提交申请，财务审核后打款。', [1, 0, 0])
    indexMaterial('m2', 'b.md', '年假政策：入职满一年的员工每年享有五天带薪年假。', [0, 1, 0])

    const matches = store.search({ queryText: '公司的报销流程是什么', mode: 'bm25', topK: 10 })

    expect(matches.map((m) => m.materialId)).toEqual(['m1'])
  })

  it('bm25 mode answers a multi-word question without requiring every word in one unit', async () => {
    // Regression: the 2-char 'to' rerouted this query to the LIKE lane, which
    // AND-ed every token as a substring — m1 contains no 'how', so nothing
    // matched. Now the long terms are OR-ed on the MATCH path; and because m1
    // contains no literal 'to' either, this also pins the store relaxing a
    // short-term filter that would otherwise eliminate every candidate.
    indexMaterial('m1', 'a.md', 'The proxy timeout is set in the network settings panel.', [1, 0, 0])
    indexMaterial('m2', 'b.md', 'Keyboard shortcuts are listed under general preferences.', [0, 1, 0])

    const matches = store.search({ queryText: 'how to configure proxy timeout', mode: 'bm25', topK: 10 })

    expect(matches.map((m) => m.materialId)).toEqual(['m1'])
  })

  it('bm25 mode ranks a unit matching more query terms above one matching fewer', async () => {
    // OR-ing terms only works if bm25() then sorts by how much of the query was hit.
    indexMaterial('m1', 'a.md', 'proxy timeout configuration', [1, 0, 0])
    indexMaterial('m2', 'b.md', 'timeout values in milliseconds', [0, 1, 0])
    // The neutral units below matter: FTS5 clamps a term's IDF to 1e-6 once it
    // appears in half the corpus or more, so at 2 units every score is epsilon
    // arithmetic and the assertion would pass without measuring relevance.
    indexMaterial('m3', 'c.md', 'keyboard shortcut list', [0, 0, 1])
    indexMaterial('m4', 'd.md', 'window layout preferences', [1, 1, 0])
    indexMaterial('m5', 'e.md', 'startup performance notes', [0, 1, 1])

    const matches = store.search({ queryText: 'proxy timeout', mode: 'bm25', topK: 10 })

    expect(matches.map((m) => m.materialId)).toEqual(['m1', 'm2'])
    expect(matches[0].score).toBeGreaterThan(matches[1].score)
  })

  it('bm25 mode ranks the unit carrying the query subject above ones sharing only filler trigrams', async () => {
    indexMaterial('m1', 'a.md', '员工报销流程：先在系统中提交申请，财务审核后打款。', [1, 0, 0])
    // 「公司的」 appears in most of this corpus, so its IDF collapses — matching it
    // alone must not compete with matching the subject 「报销流程」.
    indexMaterial('m2', 'b.md', '公司的发展历程回顾。', [0, 1, 0])
    indexMaterial('m3', 'c.md', '公司的年假政策说明。', [0, 0, 1])
    indexMaterial('m4', 'd.md', '公司的办公设备申领指南。', [1, 1, 0])
    indexMaterial('m5', 'e.md', '会议室预订规则。', [0, 1, 1])

    const matches = store.search({ queryText: '公司的报销流程是什么', mode: 'bm25', topK: 10 })

    // OR recall admits the filler-only units (an accepted tradeoff — see
    // trigramFtsQuery.ts), but bm25 must put the real answer first.
    expect(matches.length).toBeGreaterThan(1)
    expect(matches[0].materialId).toBe('m1')
  })

  it('bm25 mode answers a 3+ character CJK query through the trigram MATCH path', async () => {
    // The primary lane for Chinese content: a 4-char token produces trigrams, so
    // the query takes FTS5 MATCH, not the LIKE fallback — pin the routing here so
    // the real-DB expectations below provably exercise the trigram index.
    expect(needsLikeFallback('天气预报')).toBe(false)

    indexMaterial('m1', 'a.md', '明天的天气预报说有雨', [1, 0, 0])
    indexMaterial('m2', 'b.md', '我喜欢户外编程活动', [0, 1, 0])

    const matches = store.search({ queryText: '天气预报', mode: 'bm25', topK: 10 })
    expect(matches.map((m) => m.materialId)).toEqual(['m1'])

    // A 3+ char CJK query whose trigrams appear nowhere must return empty via MATCH.
    expect(needsLikeFallback('量子计算')).toBe(false)
    expect(store.search({ queryText: '量子计算', mode: 'bm25', topK: 10 })).toEqual([])
  })

  it('bm25 mode answers a katakana query containing the prolonged sound mark via MATCH', async () => {
    // Regression: ー is Script=Common, so matching runs on plain Script= split
    // every katakana loanword at ー into fragments too short to index —
    // 'サーバーエラー' produced no term at all and fell back to an exact-substring
    // LIKE, which this phrasing does not satisfy.
    expect(needsLikeFallback('サーバーエラー')).toBe(false)

    indexMaterial('m1', 'a.md', 'サーバーのエラーログを確認する手順', [1, 0, 0])
    indexMaterial('m2', 'b.md', 'キーボード配列の変更方法', [0, 1, 0])

    const matches = store.search({ queryText: 'サーバーエラー', mode: 'bm25', topK: 10 })

    expect(matches.map((m) => m.materialId)).toEqual(['m1'])
  })

  it('LIKE fallback ANDs every token when nothing in the query is indexable', async () => {
    indexMaterial('m1', 'a.md', '今天天气很好，温度适宜', [1, 0, 0])
    indexMaterial('m2', 'b.md', '今天天气很好', [0, 1, 0])

    // Both words are below the trigram minimum, so the whole query scans via LIKE —
    // and there every token is a required substring, which m2 fails on '温度'.
    expect(needsLikeFallback('天气 温度')).toBe(true)
    const matches = store.search({ queryText: '天气 温度', mode: 'bm25', topK: 10 })

    expect(matches.map((m) => m.materialId)).toEqual(['m1'])
  })

  it('hybrid mode lifts a short-CJK LIKE-only hit above a closer vector-only competitor', async () => {
    // m2 sits exactly on the query embedding but does NOT contain '天气'; m1 is
    // orthogonal in vector space but matches '天气' via the LIKE fallback. The BM25
    // contribution must lift m1 above m2 — drop the LIKE fallback and the order
    // flips to ['m2', 'm1'], so this pins the fallback's effect on hybrid ranking.
    indexMaterial('m1', 'a.md', '今天天气', [0, 1, 0])
    indexMaterial('m2', 'b.md', 'sunny day', [1, 0, 0])

    const matches = store.search({
      queryText: '天气',
      queryEmbedding: [1, 0, 0],
      mode: 'hybrid',
      topK: 10
    })

    expect(matches.map((m) => m.materialId)).toEqual(['m1', 'm2'])
  })

  it('hybrid mode fuses a CJK trigram MATCH hit into the vector ranking', async () => {
    // The BM25 lane's MATCH path (not just the LIKE fallback above) must
    // contribute to RRF: m1 is orthogonal to the query embedding but lexically
    // contains 报销流程; m2 sits exactly on the query embedding but shares
    // nothing lexically. The BM25 contribution must lift m1 above m2.
    expect(needsLikeFallback('报销流程')).toBe(false)

    indexMaterial('m1', 'a.md', '员工报销流程说明', [0, 1, 0])
    indexMaterial('m2', 'b.md', 'sunny day', [1, 0, 0])

    const matches = store.search({
      queryText: '报销流程',
      queryEmbedding: [1, 0, 0],
      mode: 'hybrid',
      topK: 10
    })

    expect(matches.map((m) => m.materialId)).toEqual(['m1', 'm2'])
  })

  it('hybrid fusion ranks a unit hit by both lanes above one hit by a single lane', async () => {
    // Vector favors m1; BM25 favors m2. RRF should lift m2 because it appears in both lanes.
    indexMaterial('m1', 'a.md', 'apple pie', [1, 0, 0])
    indexMaterial('m2', 'b.md', 'banana bread', [0, 1, 0])

    const matches = store.search({
      queryText: 'banana',
      queryEmbedding: [0.95, 0.05, 0],
      mode: 'hybrid',
      topK: 10
    })

    expect(matches.map((m) => m.materialId)).toEqual(['m2', 'm1'])
  })

  it('honors topK', async () => {
    indexMaterial('m1', 'a.md', 'alpha text', [1, 0, 0])
    indexMaterial('m2', 'b.md', 'beta text', [0, 1, 0])
    indexMaterial('m3', 'c.md', 'gamma text', [0, 0, 1])

    expect(store.search({ queryText: '', queryEmbedding: [1, 1, 1], mode: 'vector', topK: 2 })).toHaveLength(2)
  })

  it('rejects vector and hybrid search without a query embedding', async () => {
    indexMaterial('m1', 'a.md', 'apple pie', [1, 0, 0])

    expect(() => store.search({ queryText: 'apple', mode: 'vector', topK: 5 })).toThrow(/query embedding/)
    expect(() => store.search({ queryText: 'apple', mode: 'hybrid', topK: 5 })).toThrow(/query embedding/)
  })
})
