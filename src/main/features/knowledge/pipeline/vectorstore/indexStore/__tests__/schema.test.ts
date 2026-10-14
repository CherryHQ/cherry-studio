import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type BetterSqlite3Driver, openBetterSqlite3IndexDriver } from '../BetterSqlite3Driver'
import { ensureIndexMeta, readIndexSchemaVersion } from '../indexMeta'
import {
  createKnowledgeIndexSchema,
  KNOWLEDGE_INDEX_SCHEMA_STATEMENTS,
  KNOWLEDGE_INDEX_SCHEMA_VERSION,
  resetKnowledgeIndexSchema
} from '../schema'
import { encodeVectorBlob } from '../vectorBlob'

const TS = 1_700_000_000_000

describe('knowledge index schema', () => {
  let tempDir: string
  let driver: BetterSqlite3Driver

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cs-knowledge-index-'))
    // openBetterSqlite3IndexDriver enables foreign keys per-connection (for CASCADE)
    // and loads sqlite-vec (for vec_distance_cosine).
    driver = openBetterSqlite3IndexDriver(join(tempDir, 'index.sqlite'))
    createKnowledgeIndexSchema(driver)
  })

  afterEach(() => {
    driver?.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  const insertContent = (hash: string, text: string) =>
    driver.execute(`INSERT INTO content (content_hash, text, created_at) VALUES (?, ?, ?)`, [hash, text, TS])

  const insertMaterial = (materialId: string, relativePath: string, contentHash: string | null = null) =>
    driver.execute(
      `INSERT INTO material (material_id, relative_path, current_content_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [materialId, relativePath, contentHash, TS, TS]
    )

  const insertSearchUnit = (unitId: string, materialId: string, contentHash: string) =>
    driver.execute(
      `INSERT INTO search_unit (unit_id, material_id, content_hash, unit_type, unit_index, char_start, char_end, created_at)
       VALUES (?, ?, ?, 'chunk', 0, 0, 10, ?)`,
      [unitId, materialId, contentHash, TS]
    )

  const insertSearchText = (id: string, targetId: string, text: string, embeddingHash: string) =>
    driver.execute(
      `INSERT INTO search_text (search_text_id, target_type, target_id, kind, text, embedding_text_hash, created_at)
       VALUES (?, 'search_unit', ?, 'body', ?, ?, ?)`,
      [id, targetId, text, embeddingHash, TS]
    )

  /** Every schema object (tables, triggers, indexes, FTS shadow tables), as stable `type:name` keys. */
  const listSchemaObjects = () => {
    const result = driver.execute(`SELECT type, name FROM sqlite_master ORDER BY type, name`)
    return result.rows.map((row) => `${row.type}:${row.name}`)
  }

  describe('schema creation', () => {
    it('creates all 7 schema objects', () => {
      const expected = ['meta', 'content', 'material', 'search_unit', 'search_text', 'embedding', 'search_text_fts']
      const result = driver.execute(
        `SELECT name FROM sqlite_master WHERE name IN (${expected.map(() => '?').join(', ')})`,
        expected
      )
      const names = result.rows.map((row) => row.name as string)
      for (const name of expected) {
        expect(names).toContain(name)
      }
    })

    it('is idempotent: re-applying through the driver leaves the object set unchanged', () => {
      const objectsBefore = listSchemaObjects()
      expect(createKnowledgeIndexSchema(driver)).toBeUndefined()
      expect(listSchemaObjects()).toEqual(objectsBefore)
    })

    it('exposes a static, parameterless statement list', () => {
      expect(KNOWLEDGE_INDEX_SCHEMA_STATEMENTS.length).toBeGreaterThan(0)
      for (const statement of KNOWLEDGE_INDEX_SCHEMA_STATEMENTS) {
        expect(statement).not.toMatch(/\?/)
      }
    })
  })

  describe('meta single-row enforcement', () => {
    const insertMeta = (id: number) =>
      driver.execute(
        `INSERT INTO meta (id, schema_version, base_id, created_at, updated_at)
         VALUES (?, 1, 'base-1', ?, ?)`,
        [id, TS, TS]
      )

    it('accepts the single id = 1 row', () => {
      expect(insertMeta(1)).toBeDefined()
    })

    it('rejects id != 1', () => {
      expect(() => insertMeta(2)).toThrow()
    })

    it('rejects a second row', () => {
      insertMeta(1)
      expect(() => insertMeta(1)).toThrow()
    })
  })

  describe('material constraints', () => {
    it('accepts a valid material', () => {
      expect(insertMaterial('m1', 'docs/paper.md')).toBeDefined()
    })

    it('rejects an absolute relative_path', () => {
      expect(() => insertMaterial('m1', '/abs/paper.md')).toThrow()
    })

    it('rejects a reserved .cherry relative_path', () => {
      expect(() => insertMaterial('m1', '.cherry/index.sqlite')).toThrow()
    })

    it('enforces unique relative_path', () => {
      insertMaterial('m1', 'a.md')
      expect(() => insertMaterial('m2', 'a.md')).toThrow()
    })
  })

  describe('foreign keys', () => {
    it('cascades search_unit deletion when its material is deleted', () => {
      insertContent('h1', 'hello')
      insertMaterial('m1', 'a.md', 'h1')
      insertSearchUnit('u1', 'm1', 'h1')

      driver.execute(`DELETE FROM material WHERE material_id = ?`, ['m1'])

      const remaining = driver.execute(`SELECT COUNT(*) AS n FROM search_unit`)
      expect(remaining.rows[0].n).toBe(0)
    })

    it('rejects a search_unit referencing a missing material', () => {
      insertContent('h1', 'hello')
      expect(() => insertSearchUnit('u1', 'missing-material', 'h1')).toThrow()
    })
  })

  describe('FTS5 (trigram, external content)', () => {
    const matchBody = (term: string) => {
      const result = driver.execute(
        `SELECT st.search_text_id AS id
         FROM search_text_fts
         JOIN search_text st ON st.fts_rowid = search_text_fts.rowid
         WHERE search_text_fts MATCH ?`,
        [term]
      )
      return result.rows.map((row) => row.id as string)
    }

    beforeEach(() => {
      insertContent('h1', 'body content')
      insertMaterial('m1', 'a.md', 'h1')
      insertSearchUnit('u1', 'm1', 'h1')
    })

    it('indexes inserted search_text and matches by term', () => {
      insertSearchText('st1', 'u1', 'the quick brown fox jumps over knowledge base', 'eh1')
      expect(matchBody('knowledge')).toEqual(['st1'])
    })

    it('removes the FTS entry when search_text is deleted (ad trigger)', () => {
      insertSearchText('st1', 'u1', 'the quick brown fox jumps over knowledge base', 'eh1')
      expect(matchBody('knowledge')).toEqual(['st1'])

      driver.execute(`DELETE FROM search_text WHERE search_text_id = ?`, ['st1'])
      expect(matchBody('knowledge')).toEqual([])
    })

    it('re-syncs the FTS entry when search_text.text is updated (au trigger)', () => {
      // Production rebuilds are delete + insert, so this UPDATE path has no caller
      // today; the trigger is kept defensively and this test pins its behavior.
      insertSearchText('st1', 'u1', 'alpha knowledge base', 'eh1')
      expect(matchBody('knowledge')).toEqual(['st1'])
      const ftsRowidBefore = driver.execute(`SELECT fts_rowid FROM search_text WHERE search_text_id = ?`, ['st1'])
        .rows[0].fts_rowid

      driver.execute(`UPDATE search_text SET text = ? WHERE search_text_id = ?`, ['beta wisdom corpus', 'st1'])

      expect(matchBody('knowledge')).toEqual([])
      expect(matchBody('wisdom')).toEqual(['st1'])
      // fts_rowid is stable across a text edit (the au trigger re-keys the FTS row by NEW.fts_rowid,
      // it does not reassign it) — so the external-content index stays aligned.
      const ftsRowidAfter = driver.execute(`SELECT fts_rowid FROM search_text WHERE search_text_id = ?`, ['st1'])
        .rows[0].fts_rowid
      expect(ftsRowidAfter).toBe(ftsRowidBefore)
      expect(
        driver.execute(`INSERT INTO search_text_fts(search_text_fts, rank) VALUES('integrity-check', 1)`)
      ).toBeDefined()
    })

    it('exposes a bm25 rank for matches', () => {
      insertSearchText('st1', 'u1', 'knowledge retrieval', 'eh1')
      const result = driver.execute(
        `SELECT bm25(search_text_fts) AS score
         FROM search_text_fts
         WHERE search_text_fts MATCH ?`,
        ['knowledge']
      )
      expect(result.rows).toHaveLength(1)
      expect(typeof result.rows[0].score).toBe('number')
    })
  })

  describe('embedding vector (engine-portability spike, §5.6)', () => {
    it('computes vec_distance_cosine directly over a plain BLOB column', () => {
      const vector = [0.1, 0.2, 0.3]
      driver.execute(`INSERT INTO embedding (embedding_text_hash, vector_blob, created_at) VALUES (?, ?, ?)`, [
        'eh_vec',
        encodeVectorBlob(vector),
        TS
      ])

      const result = driver.execute(
        `SELECT vec_distance_cosine(vector_blob, ?) AS dist
         FROM embedding
         WHERE embedding_text_hash = ?`,
        [encodeVectorBlob(vector), 'eh_vec']
      )

      const dist = result.rows[0].dist as number
      expect(Number.isFinite(dist)).toBe(true)
      // Identical vectors → cosine distance ≈ 0.
      expect(dist).toBeLessThan(0.001)
    })
  })

  describe('schema version & rebuild (open-time migration)', () => {
    it('reports null until a meta row exists, then the current constant', () => {
      // beforeEach created the schema (meta table exists) but no id=1 row yet.
      expect(readIndexSchemaVersion(driver)).toBeNull()
      ensureIndexMeta(driver, { baseId: 'base-1' })
      expect(readIndexSchemaVersion(driver)).toBe(KNOWLEDGE_INDEX_SCHEMA_VERSION)
    })

    it('reports null on a file with no meta table at all', () => {
      const fresh = openBetterSqlite3IndexDriver(join(tempDir, 'no-meta.sqlite'))
      try {
        expect(readIndexSchemaVersion(fresh)).toBeNull()
      } finally {
        fresh.close()
      }
    })

    it('reports null for a malformed (non-numeric) schema_version cell', () => {
      ensureIndexMeta(driver, { baseId: 'base-1' })
      // A blanked/corrupt version (stored as text under the column's INTEGER affinity) must read as
      // "unknown" → null, so the open path treats it as fresh and creates rather than silently
      // mistaking it for a real version. Covers the `typeof === 'number'` guard.
      driver.execute(`UPDATE meta SET schema_version = 'corrupt'`)
      expect(readIndexSchemaVersion(driver)).toBeNull()
    })

    it('pins the current schema version (a deliberate bump-me tripwire)', () => {
      // KNOWLEDGE_INDEX_SCHEMA_VERSION is mirrored as MOCK_SCHEMA_VERSION in
      // KnowledgeVectorStoreService.test.ts; bumping the real constant must fail here so the
      // mirror is consciously updated in lockstep.
      expect(KNOWLEDGE_INDEX_SCHEMA_VERSION).toBe(2)
    })

    it('resetKnowledgeIndexSchema wipes data, rebuilds every object, and lets meta restamp the version', () => {
      const freshObjects = listSchemaObjects()
      // Seed a populated index stamped at an older layout version.
      ensureIndexMeta(driver, { baseId: 'base-1' })
      insertContent('h1', 'hello world')
      insertMaterial('m1', 'a.md', 'h1')
      driver.execute(`UPDATE meta SET schema_version = 1`)
      expect(readIndexSchemaVersion(driver)).toBe(1)

      resetKnowledgeIndexSchema(driver)

      // Same object set as a fresh schema, but the derived data is gone (rebuildable artifact).
      expect(listSchemaObjects()).toEqual(freshObjects)
      expect(driver.execute(`SELECT COUNT(*) AS n FROM material`).rows[0].n).toBe(0)
      expect(driver.execute(`SELECT COUNT(*) AS n FROM content`).rows[0].n).toBe(0)
      // The reset drops meta too, so the version is null until the open path restamps it.
      expect(readIndexSchemaVersion(driver)).toBeNull()
      ensureIndexMeta(driver, { baseId: 'base-1' })
      expect(readIndexSchemaVersion(driver)).toBe(KNOWLEDGE_INDEX_SCHEMA_VERSION)
    })
  })
})
