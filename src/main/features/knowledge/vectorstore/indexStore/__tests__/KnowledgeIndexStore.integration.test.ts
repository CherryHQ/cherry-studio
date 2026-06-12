import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { splitTextWithOffsets } from '../../../utils/indexing/splitter'
import { hashEmbeddingText } from '../hashing'
import { KnowledgeIndexStore } from '../KnowledgeIndexStore'
import { openLibsqlIndexDriver } from '../LibsqlDriver'
import { libsqlVectorIndex } from '../LibsqlVectorIndex'
import type { RebuildMaterialInput } from '../model'
import { createKnowledgeIndexSchema } from '../schema'

/**
 * End-to-end store round-trip over a real libsql database: take real text, chunk
 * it with the production splitter (so units carry real offsets), then rebuild →
 * list → search. This ties the splitter and store together — the unit tests
 * hand-pick offset ranges, so this is the only check that the §5.3 slice invariant
 * survives the actual chunker and that all three search modes return the
 * material's indexed units.
 */
describe('KnowledgeIndexStore integration (real libsql)', () => {
  let tempDir: string
  let store: KnowledgeIndexStore

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'cs-knowledge-integration-'))
    const driver = await openLibsqlIndexDriver(join(tempDir, 'index.sqlite'))
    await createKnowledgeIndexSchema(driver)
    store = new KnowledgeIndexStore(driver, libsqlVectorIndex)
  })

  afterEach(async () => {
    await store.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('round-trips a chunked document: rebuild → list (slice invariant) → search across all modes', async () => {
    const text =
      '# Vector search\n\n' +
      'Cherry Studio builds a per-base index for retrieval. '.repeat(4) +
      '\n\n## Embeddings\n\n' +
      'Each chunk maps to one embedding vector for cosine search. '.repeat(4)

    const chunks = splitTextWithOffsets(text, { chunkSize: 32, chunkOverlap: 8 })
    expect(chunks.length).toBeGreaterThan(1)

    const input: RebuildMaterialInput = {
      material: { relativePath: 'doc.md' },
      content: { text },
      units: chunks.map((chunk, index) => ({
        unitType: 'chunk' as const,
        unitIndex: index,
        charStart: chunk.start,
        charEnd: chunk.end
      })),
      // One embedding per distinct body hash; deterministic vectors keep the cosine
      // scan stable. Each unit's body hash matches its embedding via the §5.3 slice.
      embeddings: [...new Set(chunks.map((chunk) => hashEmbeddingText(text.slice(chunk.start, chunk.end))))].map(
        (embeddingTextHash, index) => ({ embeddingTextHash, vector: [index + 1, 1, 0] })
      )
    }

    await store.rebuildMaterial('m1', input)

    const units = await store.listMaterialUnits('m1')
    expect(units).toHaveLength(chunks.length)
    units.forEach((unit, index) => {
      // §5.3: a unit's stored body is the exact content slice, never a rewritten copy.
      expect(unit.text).toBe(text.slice(unit.charStart, unit.charEnd))
      expect(unit.text).toBe(chunks[index].text)
      expect(unit.unitIndex).toBe(index)
    })

    const bm25Hits = await store.search({ queryText: 'embedding', mode: 'bm25', topK: 5 })
    expect(bm25Hits.length).toBeGreaterThan(0)
    expect(bm25Hits.every((hit) => hit.materialId === 'm1')).toBe(true)

    const vectorHits = await store.search({ queryText: '', queryEmbedding: [1, 1, 0], mode: 'vector', topK: 5 })
    expect(vectorHits.length).toBeGreaterThan(0)
    expect(vectorHits.every((hit) => hit.materialId === 'm1')).toBe(true)

    const hybridHits = await store.search({
      queryText: 'embedding',
      queryEmbedding: [1, 1, 0],
      mode: 'hybrid',
      topK: 5
    })
    expect(hybridHits.length).toBeGreaterThan(0)
    expect(hybridHits.every((hit) => hit.materialId === 'm1')).toBe(true)
  })
})
