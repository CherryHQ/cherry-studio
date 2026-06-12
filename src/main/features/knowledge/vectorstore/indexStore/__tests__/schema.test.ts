import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { type Client, createClient } from '@libsql/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { LibsqlDriver } from '../LibsqlDriver'
import { createKnowledgeIndexSchema, KNOWLEDGE_INDEX_SCHEMA_STATEMENTS } from '../schema'

const TS = 1_700_000_000_000

/** Encode numbers as raw little-endian float32 bytes — the canonical embedding blob format. */
function toFloat32LeBlob(values: number[]): Uint8Array {
  const buffer = new ArrayBuffer(values.length * 4)
  const view = new DataView(buffer)
  values.forEach((value, index) => view.setFloat32(index * 4, value, true))
  return new Uint8Array(buffer)
}

describe('knowledge index schema', () => {
  let tempDir: string
  let client: Client

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'cs-knowledge-index-'))
    client = createClient({ url: pathToFileURL(join(tempDir, 'index.sqlite')).href })
    // Foreign keys must be enabled per-connection, outside any transaction, for CASCADE to work.
    await client.execute('PRAGMA foreign_keys = ON')
    await createKnowledgeIndexSchema(new LibsqlDriver(client))
  })

  afterEach(() => {
    client?.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  const insertContent = (hash: string, text: string) =>
    client.execute({
      sql: `INSERT INTO content (content_hash, text, created_at) VALUES (?, ?, ?)`,
      args: [hash, text, TS]
    })

  const insertMaterial = (materialId: string, relativePath: string, contentHash: string | null = null) =>
    client.execute({
      sql: `INSERT INTO material (material_id, relative_path, current_content_hash, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [materialId, relativePath, contentHash, TS, TS]
    })

  const insertSearchUnit = (unitId: string, materialId: string, contentHash: string) =>
    client.execute({
      sql: `INSERT INTO search_unit (unit_id, material_id, content_hash, unit_type, unit_index, char_start, char_end, created_at)
            VALUES (?, ?, ?, 'chunk', 0, 0, 10, ?)`,
      args: [unitId, materialId, contentHash, TS]
    })

  const insertSearchText = (id: string, targetId: string, text: string, embeddingHash: string) =>
    client.execute({
      sql: `INSERT INTO search_text (search_text_id, target_type, target_id, kind, text, embedding_text_hash, created_at)
            VALUES (?, 'search_unit', ?, 'body', ?, ?, ?)`,
      args: [id, targetId, text, embeddingHash, TS]
    })

  /** Every schema object (tables, triggers, indexes, FTS shadow tables), as stable `type:name` keys. */
  const listSchemaObjects = async () => {
    const result = await client.execute(`SELECT type, name FROM sqlite_master ORDER BY type, name`)
    return result.rows.map((row) => `${row.type}:${row.name}`)
  }

  describe('schema creation', () => {
    it('creates all 7 schema objects', async () => {
      const expected = ['meta', 'content', 'material', 'search_unit', 'search_text', 'embedding', 'search_text_fts']
      const result = await client.execute({
        sql: `SELECT name FROM sqlite_master WHERE name IN (${expected.map(() => '?').join(', ')})`,
        args: expected
      })
      const names = result.rows.map((row) => row.name as string)
      for (const name of expected) {
        expect(names).toContain(name)
      }
    })

    it('is idempotent: re-applying through the driver leaves the object set unchanged', async () => {
      const objectsBefore = await listSchemaObjects()
      await expect(createKnowledgeIndexSchema(new LibsqlDriver(client))).resolves.toBeUndefined()
      expect(await listSchemaObjects()).toEqual(objectsBefore)
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
      client.execute({
        sql: `INSERT INTO meta (id, schema_version, base_id, created_at, updated_at)
              VALUES (?, 1, 'base-1', ?, ?)`,
        args: [id, TS, TS]
      })

    it('accepts the single id = 1 row', async () => {
      await expect(insertMeta(1)).resolves.toBeDefined()
    })

    it('rejects id != 1', async () => {
      await expect(insertMeta(2)).rejects.toThrow()
    })

    it('rejects a second row', async () => {
      await insertMeta(1)
      await expect(insertMeta(1)).rejects.toThrow()
    })
  })

  describe('material constraints', () => {
    it('accepts a valid material', async () => {
      await expect(insertMaterial('m1', 'docs/paper.md')).resolves.toBeDefined()
    })

    it('rejects an absolute relative_path', async () => {
      await expect(insertMaterial('m1', '/abs/paper.md')).rejects.toThrow()
    })

    it('rejects a reserved .cherry relative_path', async () => {
      await expect(insertMaterial('m1', '.cherry/index.sqlite')).rejects.toThrow()
    })

    it('enforces unique relative_path', async () => {
      await insertMaterial('m1', 'a.md')
      await expect(insertMaterial('m2', 'a.md')).rejects.toThrow()
    })
  })

  describe('foreign keys', () => {
    it('cascades search_unit deletion when its material is deleted', async () => {
      await insertContent('h1', 'hello')
      await insertMaterial('m1', 'a.md', 'h1')
      await insertSearchUnit('u1', 'm1', 'h1')

      await client.execute({ sql: `DELETE FROM material WHERE material_id = ?`, args: ['m1'] })

      const remaining = await client.execute(`SELECT COUNT(*) AS n FROM search_unit`)
      expect(remaining.rows[0].n).toBe(0)
    })

    it('rejects a search_unit referencing a missing material', async () => {
      await insertContent('h1', 'hello')
      await expect(insertSearchUnit('u1', 'missing-material', 'h1')).rejects.toThrow()
    })
  })

  describe('FTS5 (trigram, external content)', () => {
    const matchBody = async (term: string) => {
      const result = await client.execute({
        sql: `SELECT st.search_text_id AS id
              FROM search_text_fts
              JOIN search_text st ON st.rowid = search_text_fts.rowid
              WHERE search_text_fts MATCH ?`,
        args: [term]
      })
      return result.rows.map((row) => row.id as string)
    }

    beforeEach(async () => {
      await insertContent('h1', 'body content')
      await insertMaterial('m1', 'a.md', 'h1')
      await insertSearchUnit('u1', 'm1', 'h1')
    })

    it('indexes inserted search_text and matches by term', async () => {
      await insertSearchText('st1', 'u1', 'the quick brown fox jumps over knowledge base', 'eh1')
      expect(await matchBody('knowledge')).toEqual(['st1'])
    })

    it('removes the FTS entry when search_text is deleted (ad trigger)', async () => {
      await insertSearchText('st1', 'u1', 'the quick brown fox jumps over knowledge base', 'eh1')
      expect(await matchBody('knowledge')).toEqual(['st1'])

      await client.execute({ sql: `DELETE FROM search_text WHERE search_text_id = ?`, args: ['st1'] })
      expect(await matchBody('knowledge')).toEqual([])
    })

    it('re-syncs the FTS entry when search_text.text is updated (au trigger)', async () => {
      // Production rebuilds are delete + insert, so this UPDATE path has no caller
      // today; the trigger is kept defensively and this test pins its behavior.
      await insertSearchText('st1', 'u1', 'alpha knowledge base', 'eh1')
      expect(await matchBody('knowledge')).toEqual(['st1'])

      await client.execute({
        sql: `UPDATE search_text SET text = ? WHERE search_text_id = ?`,
        args: ['beta wisdom corpus', 'st1']
      })

      expect(await matchBody('knowledge')).toEqual([])
      expect(await matchBody('wisdom')).toEqual(['st1'])
    })

    it('exposes a bm25 rank for matches', async () => {
      await insertSearchText('st1', 'u1', 'knowledge retrieval', 'eh1')
      const result = await client.execute({
        sql: `SELECT bm25(search_text_fts) AS score
              FROM search_text_fts
              WHERE search_text_fts MATCH ?`,
        args: ['knowledge']
      })
      expect(result.rows).toHaveLength(1)
      expect(typeof result.rows[0].score).toBe('number')
    })
  })

  describe('embedding vector (engine-portability spike, §5.6)', () => {
    it('computes vector_distance_cos directly over a plain BLOB column', async () => {
      const vector = [0.1, 0.2, 0.3]
      await client.execute({
        sql: `INSERT INTO embedding (embedding_text_hash, vector_blob, created_at) VALUES (?, ?, ?)`,
        args: ['eh_vec', toFloat32LeBlob(vector), TS]
      })

      const result = await client.execute({
        sql: `SELECT vector_distance_cos(vector_blob, vector32(?)) AS dist
              FROM embedding
              WHERE embedding_text_hash = ?`,
        args: [`[${vector.join(',')}]`, 'eh_vec']
      })

      const dist = result.rows[0].dist as number
      expect(Number.isFinite(dist)).toBe(true)
      // Identical vectors → cosine distance ≈ 0.
      expect(dist).toBeLessThan(0.001)
    })
  })
})
