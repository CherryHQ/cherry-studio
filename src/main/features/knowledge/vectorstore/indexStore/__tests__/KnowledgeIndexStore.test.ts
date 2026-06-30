import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
    material: { relativePath },
    content: { text },
    units,
    usesEmbeddings: true,
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
         FROM search_text_fts JOIN search_text st ON st.fts_rowid = search_text_fts.rowid
         WHERE search_text_fts MATCH ?`,
        [term]
      )
    ).rows.length

  // The reliable external-content desync detector: the default `integrity-check` does NOT compare
  // the index against the content table, so a rowid desync passes it silently (see
  // database-construction.md §4). `integrity-check, 1` does the cross-check and throws on a mismatch.
  const ftsIntegrityCheck = () =>
    driver.execute(`INSERT INTO search_text_fts(search_text_fts, rank) VALUES('integrity-check', 1)`)

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

    const material = await driver.execute(`SELECT current_content_hash FROM material WHERE material_id = ?`, ['m1'])
    expect(material.rows[0].current_content_hash).not.toBeNull()
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
      material: { relativePath: 'doc.md' },
      content: { text: 'broken input here' },
      units: [
        { unitType: 'chunk', unitIndex: 0, charStart: 0, charEnd: 6 },
        { unitType: 'chunk', unitIndex: 0, charStart: 7, charEnd: 12 }
      ],
      usesEmbeddings: true,
      embeddings: [{ embeddingTextHash: hashEmbeddingText('broken'), vector: [0.1, 0.2, 0.3] }]
    }
    await expect(store.rebuildMaterial('m1', broken)).rejects.toThrow()

    const units = await store.listMaterialUnits('m1')
    expect(units.map((u) => u.text)).toEqual(['keep', 'this'])
    expect(await count('search_unit')).toBe(2)
  })

  it('rebuilding the same material with identical content is idempotent', async () => {
    // The most common reindex scenario. Unit/search_text ids are deterministic
    // (same material + content + offsets → same ids), so this only passes while
    // the rebuild transaction deletes the old rows unconditionally — a future
    // "skip when content unchanged" short-circuit that forgot the delete would
    // explode here with PK/UNIQUE violations.
    const input = buildInput('hello world wide', [
      [0, 5],
      [6, 16]
    ])
    await store.rebuildMaterial('m1', input)
    await expect(store.rebuildMaterial('m1', input)).resolves.toBeUndefined()

    const units = await store.listMaterialUnits('m1')
    expect(units.map((u) => u.text)).toEqual(['hello', 'world wide'])
    expect(await count('search_unit')).toBe(2)
    expect(await count('search_text')).toBe(2)
    expect(await count('content')).toBe(1)
    expect(await count('embedding')).toBe(2)
    expect(await ftsMatchCount('world')).toBe(1)
  })

  it('rejects a unit whose charEnd lies beyond the content text', async () => {
    // slice() would clamp silently and persist the lying offset — the store must
    // fail loud at write time instead of corrupting offset-based readers later.
    await expect(store.rebuildMaterial('m1', buildInput('short', [[0, 99]]))).rejects.toThrow(
      'beyond the content length'
    )

    expect(await count('material')).toBe(0)
    expect(await count('search_unit')).toBe(0)
  })

  it('rolls back a rebuild that leaves a unit embedding hash without a vector', async () => {
    await store.rebuildMaterial('m1', buildInput('keep this safe', [[0, 4]]))

    // A caller that hashes different text than the store re-slices (offset/hash
    // drift) supplies no vector for the unit's body — the coverage check must
    // fail the transaction instead of leaving the unit invisible to vector search.
    const drifted: RebuildMaterialInput = {
      material: { relativePath: 'doc.md' },
      content: { text: 'drifted body text' },
      units: [{ unitType: 'chunk', unitIndex: 0, charStart: 0, charEnd: 7 }],
      usesEmbeddings: true,
      embeddings: [{ embeddingTextHash: hashEmbeddingText('not the sliced body'), vector: [0.1, 0.2, 0.3] }]
    }
    await expect(store.rebuildMaterial('m1', drifted)).rejects.toThrow('without a vector')

    // Prior index intact (transaction rolled back).
    const units = await store.listMaterialUnits('m1')
    expect(units.map((u) => u.text)).toEqual(['keep'])
  })

  it('checks embedding coverage across query batches (>500 distinct hashes)', async () => {
    // 501 distinct unit bodies cross the EMBEDDING_HASH_QUERY_BATCH (500)
    // boundary, so a slice off-by-one in the batched coverage query would either
    // falsely throw (a supplied hash dropped from a query) or falsely pass (a
    // missing hash never checked). Pin both directions on a real database.
    const words = Array.from({ length: 501 }, (_, i) => `w${String(i).padStart(3, '0')}`)
    const text = words.join(' ')
    const ranges: Array<[number, number]> = []
    let offset = 0
    for (const word of words) {
      ranges.push([offset, offset + word.length])
      offset += word.length + 1
    }

    // The 501st hash lands in the second batch; dropping its vector must fail.
    const missingOne = buildInput(text, ranges)
    missingOne.embeddings = missingOne.embeddings.filter(
      (embedding) => embedding.embeddingTextHash !== hashEmbeddingText(words[500])
    )
    await expect(store.rebuildMaterial('m1', missingOne)).rejects.toThrow('without a vector')
    expect(await count('material')).toBe(0)

    await expect(store.rebuildMaterial('m1', buildInput(text, ranges))).resolves.toBeUndefined()
    expect(await count('search_unit')).toBe(501)
    expect(await count('embedding')).toBe(501)
  })

  it('deletes a material and its derived rows, sweeping the now-orphaned embedding and content', async () => {
    await store.rebuildMaterial('m1', buildInput('the knowledge base', [[0, 18]]))
    expect(await ftsMatchCount('knowledge')).toBe(1)

    await store.deleteMaterials(['m1'])

    expect(await store.listMaterialUnits('m1')).toEqual([])
    expect(await count('material')).toBe(0)
    expect(await count('search_unit')).toBe(0)
    expect(await count('search_text')).toBe(0)
    expect(await ftsMatchCount('knowledge')).toBe(0)
    // GC sweeps the embedding and content rows nothing references any more.
    expect(await count('embedding')).toBe(0)
    expect(await count('content')).toBe(0)
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

    await store.deleteMaterials(['m1'])

    // GC must keep the shared embedding (m2 still references it via its search_text)
    // and m2 must stay reachable by vector search. A GC that dropped a still-referenced
    // embedding when m1 was deleted would fail this behavioral assertion — the bare row
    // count in the delete test above cannot catch that.
    expect(await count('embedding')).toBe(1)
    const matches = await store.search({ queryText: '', queryEmbedding: [0.1, 0.2, 0.3], mode: 'vector', topK: 10 })
    expect(matches.map((m) => m.materialId)).toEqual(['m2'])
  })

  it('deleteMaterials removes the whole batch in one pass, sweeps only true orphans, and keeps the survivor searchable', async () => {
    // m1, m2 will be deleted; m3 survives. m1 and m3 index the IDENTICAL body, so they
    // share one content row and one embedding row; m2 has its own unique body.
    await store.rebuildMaterial('m1', buildInput('shared knowledge body', [[0, 21]], 'a.md', [0.1, 0.2, 0.3]))
    await store.rebuildMaterial('m2', buildInput('unique orphan body', [[0, 18]], 'b.md', [0.4, 0.5, 0.6]))
    await store.rebuildMaterial('m3', buildInput('shared knowledge body', [[0, 21]], 'c.md', [0.1, 0.2, 0.3]))
    expect(await count('material')).toBe(3)
    expect(await count('content')).toBe(2) // shared (m1+m3) + unique (m2)
    expect(await count('embedding')).toBe(2)

    // Duplicate id must be de-duped; the whole batch deletes in one transaction with a
    // single GC pass — the path a folder delete takes (one deleteMaterials over N files).
    await store.deleteMaterials(['m1', 'm2', 'm1'])

    expect((await driver.execute(`SELECT material_id FROM material`)).rows.map((r) => r.material_id)).toEqual(['m3'])
    expect(await store.listMaterialUnits('m1')).toEqual([])
    expect(await store.listMaterialUnits('m2')).toEqual([])
    // The single end-of-batch GC must sweep m2's now-orphaned body/embedding/content while
    // keeping the body m3 still references — i.e. the same end state N per-material GCs gave.
    expect(await count('content')).toBe(1)
    expect(await count('embedding')).toBe(1)

    // The FTS-rowid hazard guard: deleting m1/m2 fires the external-content FTS delete
    // trigger for their rows. If the batch delete desynced the FTS rowids (or over-swept),
    // the survivor m3 — whose search_text row is untouched — would drop out of keyword
    // search even though it is still present. It must stay both bm25- and vector-reachable.
    expect(await ftsMatchCount('knowledge')).toBe(1)
    expect((await store.search({ queryText: 'knowledge', mode: 'bm25', topK: 10 })).map((h) => h.materialId)).toEqual([
      'm3'
    ])
    expect(
      (await store.search({ queryText: '', queryEmbedding: [0.1, 0.2, 0.3], mode: 'vector', topK: 10 })).map(
        (h) => h.materialId
      )
    ).toEqual(['m3'])
  })

  it('deleteMaterials is a no-op for an empty batch', async () => {
    await store.rebuildMaterial('m1', buildInput('keep me', [[0, 7]]))
    await expect(store.deleteMaterials([])).resolves.toBeUndefined()
    expect(await count('material')).toBe(1)
  })

  it('yields the main-process event loop between materials during a batch delete', async () => {
    // Each search_text delete fires the trigram FTS delete trigger synchronously, so a
    // large folder delete would block the main process (the macOS beachball) without
    // periodic yields. Prove the loop hands control back: drive the MONOTONIC performance.now()
    // past the time budget on every read (deterministic — no real-clock dependency) and confirm
    // the loop schedules a macrotask (setImmediate) per material while still deleting correctly.
    await store.rebuildMaterial('m1', buildInput('alpha body one', [[0, 14]], 'a.md'))
    await store.rebuildMaterial('m2', buildInput('bravo body two', [[0, 14]], 'b.md'))
    await store.rebuildMaterial('m3', buildInput('gamma body six', [[0, 14]], 'c.md'))

    // setImmediate is spied (call-through), not stubbed, so the yields still resolve.
    let clock = 0
    const perfNow = vi.spyOn(performance, 'now').mockImplementation(() => (clock += 100))
    const immediate = vi.spyOn(global, 'setImmediate')
    let yields = 0
    try {
      await store.deleteMaterials(['m1', 'm2', 'm3'])
      yields = immediate.mock.calls.length
    } finally {
      perfNow.mockRestore()
      immediate.mockRestore()
    }

    expect(yields).toBeGreaterThanOrEqual(3) // one yield per material under the forced clock
    expect(await count('material')).toBe(0)
    expect(await count('search_text')).toBe(0)
    expect(await count('embedding')).toBe(0)
  })

  it('does not yield when a small batch stays within the time budget', async () => {
    // The yield is gated on ELAPSED TIME, not row count: a fast batch that never crosses
    // DELETE_YIELD_BUDGET_MS must schedule zero macrotasks. Freezing the monotonic clock keeps
    // every delta at 0 — so this fails if the gate is ever replaced by an unconditional
    // yield-per-row (the exact regression the test above cannot, on its own, rule out).
    await store.rebuildMaterial('m1', buildInput('alpha body one', [[0, 14]], 'a.md'))
    await store.rebuildMaterial('m2', buildInput('bravo body two', [[0, 14]], 'b.md'))
    await store.rebuildMaterial('m3', buildInput('gamma body six', [[0, 14]], 'c.md'))

    const perfNow = vi.spyOn(performance, 'now').mockReturnValue(1000)
    const immediate = vi.spyOn(global, 'setImmediate')
    let yields = 0
    try {
      await store.deleteMaterials(['m1', 'm2', 'm3'])
      yields = immediate.mock.calls.length
    } finally {
      perfNow.mockRestore()
      immediate.mockRestore()
    }

    expect(yields).toBe(0)
    expect(await count('material')).toBe(0)
  })

  it('reclaimSpace VACUUMs a large delete and keeps the survivor FTS-searchable (issue #16132 guard)', async () => {
    // A ~13 MB content row whose delete frees enough pages to cross the VACUUM threshold,
    // plus a small survivor m2. VACUUM rewrites the whole file and renumbers implicit rowids;
    // because search_text_fts keys on the stable fts_rowid (not the implicit rowid), m2 — whose
    // search_text is untouched — stays aligned. It must remain reachable, and the index intact.
    const hugeText = 'knowledge body filler '.repeat(600_000)
    await store.rebuildMaterial('m1', buildInput(hugeText, [[0, 20]], 'big.md'))
    await store.rebuildMaterial('m2', buildInput('shared knowledge body', [[0, 21]], 'keep.md'))

    await store.deleteMaterials(['m1'])
    const outcome = await store.reclaimSpace()

    expect(outcome.vacuumed).toBe(true)
    expect(outcome.reclaimedBytes).toBeGreaterThan(0)
    await expect(ftsIntegrityCheck()).resolves.toBeDefined()
    // The survivor stays both keyword- and vector-reachable after the rewrite.
    expect(await ftsMatchCount('knowledge')).toBe(1)
    expect((await store.search({ queryText: 'knowledge', mode: 'bm25', topK: 10 })).map((h) => h.materialId)).toEqual([
      'm2'
    ])
    expect(
      (await store.search({ queryText: '', queryEmbedding: [0.1, 0.2, 0.3], mode: 'vector', topK: 10 })).map(
        (h) => h.materialId
      )
    ).toEqual(['m2'])
  })

  it('reclaimSpace skips the VACUUM (truncates the WAL only) when the freelist is below the threshold', async () => {
    // A tiny delete frees far less than the absolute floor, so the whole-file-rewrite block
    // is not worth it — reclaim just checkpoints and reports nothing reclaimed.
    await store.rebuildMaterial('m1', buildInput('small knowledge body', [[0, 20]], 'a.md'))
    await store.deleteMaterials(['m1'])

    const outcome = await store.reclaimSpace()

    expect(outcome).toEqual({ vacuumed: false, reclaimedBytes: 0 })
  })

  it('reclaimSpace compacts the FTS shadow table, not just the freelist', async () => {
    // A material with a large searchable BODY: deleting it only TOMBSTONES its trigram
    // entries via the FTS delete trigger — the segment blobs linger as live rows in the
    // search_text_fts_data shadow table, which VACUUM alone cannot reclaim. Without the FTS
    // 'optimize' in reclaim, a whole-folder delete leaves the index nearly as large as
    // before. content stays 13 MB so the freelist clears the VACUUM threshold; the 2 MB
    // body makes the shadow segments measurable.
    const hugeText = 'knowledge body filler '.repeat(600_000)
    await store.rebuildMaterial('m1', buildInput(hugeText, [[0, 2_000_000]], 'big.md'))
    await store.rebuildMaterial('m2', buildInput('shared knowledge body', [[0, 21]], 'keep.md'))
    const ftsSegmentsBefore = await count('search_text_fts_data')

    await store.deleteMaterials(['m1'])
    const outcome = await store.reclaimSpace()

    expect(outcome.vacuumed).toBe(true)
    // optimize merged and dropped m1's dead segments instead of leaving them behind.
    expect(await count('search_text_fts_data')).toBeLessThan(ftsSegmentsBefore)
    // The survivor is still keyword-searchable after the optimize + VACUUM.
    expect((await store.search({ queryText: 'shared', mode: 'bm25', topK: 10 })).map((h) => h.materialId)).toEqual([
      'm2'
    ])
    // VACUUM renumbers implicit rowids; assert the external-content FTS did NOT desync. Keyed on the
    // stable fts_rowid it stays aligned by construction — verified with the reliable integrity check
    // (the default integrity-check would pass even on a desync).
    await expect(ftsIntegrityCheck()).resolves.toBeDefined()
  })

  it('keeps search_text_fts aligned after a rowid-reshuffling rebuild (fts_rowid keying)', async () => {
    // Regression guard for the desync the reviewer flagged: VACUUM and table rebuilds renumber
    // search_text's implicit rowid, and an external-content FTS keyed on that rowid would then
    // silently point at the wrong rows. search_text_fts keys on the stable fts_rowid column instead.
    // The index MUST be populated before the reshuffle, or it cannot expose the bug.
    await store.rebuildMaterial('m1', buildInput('alpha apple body', [[0, 16]], 'a.md'))
    await store.rebuildMaterial('m2', buildInput('bravo banana body', [[0, 17]], 'b.md'))
    await store.rebuildMaterial('m3', buildInput('charlie cherry body', [[0, 19]], 'c.md'))
    await store.rebuildMaterial('m4', buildInput('delta date body', [[0, 15]], 'd.md'))
    // Delete a middle material to leave a rowid hole — the precondition the reshuffle needs.
    await store.deleteMaterials(['m2'])
    expect(await ftsMatchCount('cherry')).toBe(1)

    // Reshuffle the implicit rowid exactly as a table rebuild / VACUUM does: copy the table (new
    // contiguous rowids, dropping the hole) while carrying fts_rowid verbatim, then re-assert the
    // dropped indexes + triggers. The FTS vtable is untouched, so it stays keyed by fts_rowid.
    await driver.execute('PRAGMA foreign_keys=OFF')
    await driver.execute('CREATE TABLE __new_search_text AS SELECT * FROM search_text')
    await driver.execute('DROP TABLE search_text')
    await driver.execute('ALTER TABLE __new_search_text RENAME TO search_text')
    await driver.execute('PRAGMA foreign_keys=ON')
    await createKnowledgeIndexSchema(driver)

    // fts_rowid was copied through the rebuild, so the index stays aligned: the reliable check passes
    // and the survivors resolve to the right materials (a rowid-keyed index would return wrong/empty).
    await expect(ftsIntegrityCheck()).resolves.toBeDefined()
    expect((await store.search({ queryText: 'cherry', mode: 'bm25', topK: 10 })).map((h) => h.materialId)).toEqual([
      'm3'
    ])
    expect((await store.search({ queryText: 'date', mode: 'bm25', topK: 10 })).map((h) => h.materialId)).toEqual(['m4'])
    // The reshuffle reassigned implicit rowids while leaving fts_rowid untouched and unique.
    expect(await count('search_text')).toBe(3)
    expect(Number((await driver.execute(`SELECT COUNT(DISTINCT fts_rowid) AS n FROM search_text`)).rows[0].n)).toBe(3)
  })

  it('integrity-check,1 catches a NULL fts_rowid desync (and proves the detector is live)', async () => {
    await store.rebuildMaterial('m1', buildInput('orphan searchable body', [[0, 22]], 'a.md'))
    expect(await ftsMatchCount('searchable')).toBe(1)

    // Simulate a future bulk-insert / restore path that bypassed the AFTER INSERT trigger and left
    // fts_rowid NULL (the nullable-window hazard the schema comment + docs warn about): the FTS entry
    // now references a key the content row no longer carries. This both guards that hazard AND is the
    // positive control that ftsIntegrityCheck() really throws on a desync — every other use of it in
    // this suite asserts it resolves, so without this case those assertions could pass vacuously.
    await driver.execute(`UPDATE search_text SET fts_rowid = NULL`)
    await expect(ftsIntegrityCheck()).rejects.toThrow()
  })

  it('reuses a freed fts_rowid without leaving a stale FTS entry', async () => {
    // The AFTER INSERT trigger assigns MAX(fts_rowid)+1, so deleting the row that holds the
    // current MAX and then inserting REUSES that just-freed rowid — the highest-risk path for a
    // stale external-content entry: the new row lands on the exact key the deleted row had, so a
    // delete trigger that failed to tombstone it would surface the old content under the new row.
    await store.rebuildMaterial('m1', buildInput('alpha apple body', [[0, 16]], 'a.md'))
    await store.rebuildMaterial('m2', buildInput('bravo banana body', [[0, 17]], 'b.md'))
    await store.rebuildMaterial('m3', buildInput('charlie cherry body', [[0, 19]], 'c.md'))

    // m3 holds the current MAX fts_rowid. Delete it to free that rowid.
    const maxBefore = Number((await driver.execute(`SELECT MAX(fts_rowid) AS m FROM search_text`)).rows[0].m)
    await store.deleteMaterials(['m3'])
    expect(await ftsMatchCount('cherry')).toBe(0)

    // The next insert's MAX(fts_rowid)+1 reuses the value m3 just vacated.
    await store.rebuildMaterial('m4', buildInput('delta dragon body', [[0, 17]], 'd.md'))
    const reused = Number(
      (await driver.execute(`SELECT fts_rowid FROM search_text WHERE text LIKE 'delta%'`)).rows[0].fts_rowid
    )
    expect(reused).toBe(maxBefore) // landed on the exact physical rowid m3 had held

    // The reused rowid resolves to m4 (not stale m3 content), the deleted term stays gone, and the
    // external-content index is consistent under the reliable detector.
    expect((await store.search({ queryText: 'dragon', mode: 'bm25', topK: 10 })).map((h) => h.materialId)).toEqual([
      'm4'
    ])
    expect(await ftsMatchCount('cherry')).toBe(0)
    await expect(ftsIntegrityCheck()).resolves.toBeDefined()
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
    // one → 2 rows. GC dropping the now-singly-referenced shared embedding on rebuild
    // would unjoin m2 from vector search below — the bare row count cannot catch that,
    // but searching the shared vector can.
    expect(await count('embedding')).toBe(2)
    const matches = await store.search({ queryText: '', queryEmbedding: [0.1, 0.2, 0.3], mode: 'vector', topK: 10 })
    expect(matches.map((m) => m.materialId)).toContain('m2')
  })

  it('sweeps the orphaned embedding and content when a material is rebuilt with new content', async () => {
    await store.rebuildMaterial('m1', buildInput('original body', [[0, 13]], 'a.md', [0.1, 0.2, 0.3]))
    expect(await count('embedding')).toBe(1)
    expect(await count('content')).toBe(1)

    // Rebuild with unrelated content + a distinct vector; nothing else references the
    // old embedding or old content, so GC must remove both, leaving only the new ones.
    await store.rebuildMaterial('m1', buildInput('replacement body', [[0, 16]], 'a.md', [0.9, 0.8, 0.7]))

    expect(await count('embedding')).toBe(1)
    expect(await count('content')).toBe(1)
    const units = await store.listMaterialUnits('m1')
    expect(units.map((u) => u.text)).toEqual(['replacement body'])
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

  describe('deep-read lookups', () => {
    it('resolves a material by its relative path (the Concept ID) and returns null for an unknown path', async () => {
      await store.rebuildMaterial('m1', buildInput('hello world', [[0, 11]], 'docs/intro.md'))

      const ref = await store.getMaterialByRelativePath('docs/intro.md')
      expect(ref).not.toBeNull()
      expect(ref?.materialId).toBe('m1')
      expect(ref?.relativePath).toBe('docs/intro.md')

      expect(await store.getMaterialByRelativePath('docs/missing.md')).toBeNull()
    })

    it('reads back the full content text a material was indexed from', async () => {
      const text = 'the quick brown fox jumps over the lazy dog'
      await store.rebuildMaterial(
        'm1',
        buildInput(text, [
          [0, 19],
          [20, text.length]
        ])
      )

      expect(await store.readMaterialContent('m1')).toBe(text)
    })

    it('keeps content readable as the exact source the units were sliced from', async () => {
      const text = 'alpha beta gamma'
      await store.rebuildMaterial(
        'm1',
        buildInput(text, [
          [0, 5],
          [6, 10]
        ])
      )

      const content = await store.readMaterialContent('m1')
      for (const unit of await store.listMaterialUnits('m1')) {
        expect(content?.slice(unit.charStart, unit.charEnd)).toBe(unit.text)
      }
    })

    it('returns null content for an unknown material', async () => {
      expect(await store.readMaterialContent('nope')).toBeNull()
    })
  })
})
