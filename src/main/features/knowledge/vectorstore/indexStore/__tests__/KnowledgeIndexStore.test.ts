import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { hashEmbeddingText } from '../hashing'
import { KnowledgeIndexStore } from '../KnowledgeIndexStore'
import { type LibsqlDriver, openLibsqlIndexDriver } from '../LibsqlDriver'
import { libsqlVectorIndex } from '../LibsqlVectorIndex'
import type { RebuildMaterialInput } from '../model'
import { createKnowledgeIndexSchema } from '../schema'

/** Build a rebuild input over `text`, one chunk per [start, end] range, with a vector per distinct slice. */
function buildInput(
  text: string,
  ranges: Array<[number, number]>,
  relativePath = 'doc.md',
  vector: number[] = [0.1, 0.2, 0.3]
): RebuildMaterialInput {
  const units = ranges.map(([charStart, charEnd], index) => ({
    unitType: 'chunk' as const,
    unitIndex: index,
    charStart,
    charEnd
  }))
  const hashes = [...new Set(ranges.map(([start, end]) => hashEmbeddingText(text.slice(start, end))))]
  return {
    material: { relativePath, origin: 'user', indexPolicy: 'index' },
    content: { text, textFormat: 'markdown', normalizationVersion: 1 },
    units,
    embeddings: hashes.map((embeddingTextHash) => ({ embeddingTextHash, vector }))
  }
}

describe('KnowledgeIndexStore', () => {
  let tempDir: string
  let driver: LibsqlDriver
  let store: KnowledgeIndexStore

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'cs-knowledge-store-'))
    driver = await openLibsqlIndexDriver(join(tempDir, 'index.sqlite'))
    await createKnowledgeIndexSchema(driver)
    store = new KnowledgeIndexStore(driver, libsqlVectorIndex)
  })

  afterEach(async () => {
    await store.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  const count = async (table: string) => Number((await driver.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n)

  const ftsMatchCount = async (term: string) =>
    (
      await driver.execute(
        `SELECT st.search_text_id AS id
         FROM search_text_fts JOIN search_text st ON st.rowid = search_text_fts.rowid
         WHERE search_text_fts MATCH ?`,
        [term]
      )
    ).rows.length

  it('persists material, content, units, search_text and embeddings, then lists units in order', async () => {
    await store.rebuildMaterial(
      'm1',
      buildInput('hello world wide', [
        [0, 5],
        [6, 16]
      ])
    )

    const units = await store.listMaterialUnits('m1')
    expect(units.map((u) => u.text)).toEqual(['hello', 'world wide'])
    expect(units.map((u) => u.unitIndex)).toEqual([0, 1])

    expect(await count('material')).toBe(1)
    expect(await count('content')).toBe(1)
    expect(await count('search_unit')).toBe(2)
    expect(await count('search_text')).toBe(2)

    const material = await driver.execute(
      `SELECT current_content_hash, last_indexed_at FROM material WHERE material_id = ?`,
      ['m1']
    )
    expect(material.rows[0].current_content_hash).not.toBeNull()
    expect(material.rows[0].last_indexed_at).not.toBeNull()
  })

  it('keeps body text equal to the content slice (search §5.3 invariant)', async () => {
    const text = 'alpha beta gamma'
    await store.rebuildMaterial(
      'm1',
      buildInput(text, [
        [0, 5],
        [6, 10],
        [11, 16]
      ])
    )

    for (const unit of await store.listMaterialUnits('m1')) {
      expect(unit.text).toBe(text.slice(unit.charStart, unit.charEnd))
    }
  })

  it('throws on a unit whose body row is missing instead of fabricating an empty chunk', async () => {
    await store.rebuildMaterial('m1', buildInput('alpha beta', [[0, 5]]))

    // Corrupt the store: drop the body row out from under the unit. The same
    // damage silently excludes the unit from search (INNER JOIN); the list lane
    // must fail loudly rather than add a third symptom (existing-but-empty chunk).
    await driver.execute(`DELETE FROM search_text WHERE target_type = 'search_unit' AND kind = 'body'`)

    await expect(store.listMaterialUnits('m1')).rejects.toThrow('missing the body text for unit')
  })

  it('atomically replaces all prior units on rebuild (no old/new mix)', async () => {
    await store.rebuildMaterial(
      'm1',
      buildInput('one two three', [
        [0, 3],
        [4, 7],
        [8, 13]
      ])
    )
    expect(await count('search_unit')).toBe(3)

    await store.rebuildMaterial('m1', buildInput('solo', [[0, 4]]))
    const units = await store.listMaterialUnits('m1')
    expect(units).toHaveLength(1)
    expect(units[0].text).toBe('solo')
    expect(await count('search_unit')).toBe(1)
    expect(await count('search_text')).toBe(1)
  })

  it('reuses one embedding row for units sharing identical body text', async () => {
    // Two units with the same slice → same embedding_text_hash → one embedding row.
    await store.rebuildMaterial(
      'm1',
      buildInput('dup', [
        [0, 3],
        [0, 3]
      ])
    )

    expect(await count('search_unit')).toBe(2)
    expect(await count('embedding')).toBe(1)
  })

  it('keeps the FTS index in sync across rebuilds', async () => {
    await store.rebuildMaterial('m1', buildInput('the knowledge base', [[0, 18]]))
    expect(await ftsMatchCount('knowledge')).toBe(1)

    await store.rebuildMaterial('m1', buildInput('a different subject', [[0, 19]]))
    expect(await ftsMatchCount('knowledge')).toBe(0)
    expect(await ftsMatchCount('different')).toBe(1)
  })

  it('rolls back the whole rebuild on a mid-transaction failure', async () => {
    await store.rebuildMaterial(
      'm1',
      buildInput('keep this safe', [
        [0, 4],
        [5, 9]
      ])
    )

    // Two units sharing unit_index 0 violate UNIQUE(material_id, unit_type, unit_index)
    // on the second insert — the transaction must roll back, preserving the prior index.
    const broken: RebuildMaterialInput = {
      material: { relativePath: 'doc.md', origin: 'user', indexPolicy: 'index' },
      content: { text: 'broken input here', textFormat: 'markdown', normalizationVersion: 1 },
      units: [
        { unitType: 'chunk', unitIndex: 0, charStart: 0, charEnd: 6 },
        { unitType: 'chunk', unitIndex: 0, charStart: 7, charEnd: 12 }
      ],
      embeddings: [{ embeddingTextHash: hashEmbeddingText('broken'), vector: [0.1, 0.2, 0.3] }]
    }
    await expect(store.rebuildMaterial('m1', broken)).rejects.toThrow()

    const units = await store.listMaterialUnits('m1')
    expect(units.map((u) => u.text)).toEqual(['keep', 'this'])
    expect(await count('search_unit')).toBe(2)
  })

  it('deletes a material and its derived rows, leaving embeddings for GC', async () => {
    await store.rebuildMaterial('m1', buildInput('the knowledge base', [[0, 18]]))
    expect(await ftsMatchCount('knowledge')).toBe(1)

    await store.deleteMaterial('m1')

    expect(await store.listMaterialUnits('m1')).toEqual([])
    expect(await count('material')).toBe(0)
    expect(await count('search_unit')).toBe(0)
    expect(await count('search_text')).toBe(0)
    expect(await ftsMatchCount('knowledge')).toBe(0)
    // Orphaned embedding is intentionally left for a later GC pass (§10).
    expect(await count('embedding')).toBe(1)
  })

  it('shares one content row across materials with identical content', async () => {
    await store.rebuildMaterial('m1', buildInput('shared content', [[0, 14]], 'a.md'))
    await store.rebuildMaterial('m2', buildInput('shared content', [[0, 14]], 'b.md'))

    expect(await count('material')).toBe(2)
    expect(await count('content')).toBe(1)
    expect(await count('search_unit')).toBe(2)
  })

  it('keeps a shared embedding reachable for the remaining material after deleting one sharer', async () => {
    // m1 and m2 index the identical body → one embedding row, referenced by both.
    await store.rebuildMaterial('m1', buildInput('shared body text', [[0, 16]], 'a.md'))
    await store.rebuildMaterial('m2', buildInput('shared body text', [[0, 16]], 'b.md'))
    expect(await count('embedding')).toBe(1)

    await store.deleteMaterial('m1')

    // The shared embedding must survive (m2 still references it) and m2 must stay
    // reachable by vector search. A future inline GC that dropped a still-referenced
    // embedding when m1 was deleted (§16) would fail this behavioral assertion —
    // the bare row count in the GC test above cannot catch that.
    expect(await count('embedding')).toBe(1)
    const matches = await store.search({ queryText: '', queryEmbedding: [0.1, 0.2, 0.3], mode: 'vector', topK: 10 })
    expect(matches.map((m) => m.materialId)).toEqual(['m2'])
  })

  it('keeps a shared embedding reachable for the other material after rebuilding the one that introduced it', async () => {
    // m1 and m2 index the identical body → one shared embedding row, referenced by both.
    await store.rebuildMaterial('m1', buildInput('shared body text', [[0, 16]], 'a.md'))
    await store.rebuildMaterial('m2', buildInput('shared body text', [[0, 16]], 'b.md'))
    expect(await count('embedding')).toBe(1)

    // Rebuild m1 with unrelated content carrying a distinct vector, so m1 no longer
    // references the shared embedding — only m2 does now.
    await store.rebuildMaterial('m1', buildInput('rebuilt unrelated body', [[0, 22]], 'a.md', [0.9, 0.8, 0.7]))

    // The shared embedding must survive (m2 still references it), alongside m1's new
    // one → 2 rows. A future inline GC that dropped the now-singly-referenced shared
    // embedding on rebuild (§16) would unjoin m2 from vector search below — the bare
    // row count cannot catch that, but searching the shared vector can.
    expect(await count('embedding')).toBe(2)
    const matches = await store.search({ queryText: '', queryEmbedding: [0.1, 0.2, 0.3], mode: 'vector', topK: 10 })
    expect(matches.map((m) => m.materialId)).toContain('m2')
  })

  it('listExistingEmbeddingHashes reports only the hashes already stored', async () => {
    await store.rebuildMaterial(
      'm1',
      buildInput('alpha bravo', [
        [0, 5],
        [6, 11]
      ])
    )
    const stored = hashEmbeddingText('alpha')
    const absent = hashEmbeddingText('charlie')

    const existing = await store.listExistingEmbeddingHashes([stored, absent])

    expect(existing.has(stored)).toBe(true)
    expect(existing.has(absent)).toBe(false)
    expect(existing.size).toBe(1)
  })

  it('listExistingEmbeddingHashes returns an empty set for empty input', async () => {
    expect((await store.listExistingEmbeddingHashes([])).size).toBe(0)
  })
})
