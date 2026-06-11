import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { hashChunkerConfig } from '../hashing'
import {
  CHUNKER_VERSION,
  ensureIndexMeta,
  hasAnyMaterial,
  hasLegacyVectorStoreTable,
  IGNORE_RULES_VERSION,
  NORMALIZATION_VERSION
} from '../indexMeta'
import type { LibsqlDriver } from '../LibsqlDriver'
import { openLibsqlIndexDriver } from '../LibsqlDriver'
import { createKnowledgeIndexSchema, KNOWLEDGE_INDEX_SCHEMA_VERSION } from '../schema'

const META_INPUT = {
  baseId: 'kb-1',
  embeddingModelId: 'ollama::nomic-embed-text',
  dimensions: 1024,
  chunkerConfigHash: hashChunkerConfig(512, 64)
}

describe('ensureIndexMeta', () => {
  let tempDir: string
  let driver: LibsqlDriver

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'cs-knowledge-meta-'))
    driver = await openLibsqlIndexDriver(join(tempDir, 'index.sqlite'))
    await createKnowledgeIndexSchema(driver)
  })

  afterEach(async () => {
    await driver.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('writes the single index_meta row with the schema version, base id and contract snapshot on first open', async () => {
    await ensureIndexMeta(driver, META_INPUT)

    const result = await driver.execute('SELECT * FROM index_meta')
    expect(result.rows).toHaveLength(1)
    const row = result.rows[0]
    expect(row.id).toBe(1)
    expect(row.schema_version).toBe(KNOWLEDGE_INDEX_SCHEMA_VERSION)
    expect(row.base_id).toBe('kb-1')
    expect(row.normalization_version).toBe(NORMALIZATION_VERSION)
    expect(row.chunker_version).toBe(CHUNKER_VERSION)
    expect(row.chunker_config_hash).toBe(META_INPUT.chunkerConfigHash)
    expect(row.ignore_rules_version).toBe(IGNORE_RULES_VERSION)
    expect(row.embedding_model_id_snapshot).toBe('ollama::nomic-embed-text')
    expect(row.dimensions_snapshot).toBe(1024)
  })

  it('is idempotent across re-opens: the original row is kept, not duplicated or rewritten', async () => {
    await ensureIndexMeta(driver, META_INPUT)
    const first = await driver.execute('SELECT created_at FROM index_meta WHERE id = 1')

    await ensureIndexMeta(driver, META_INPUT)
    const second = await driver.execute('SELECT created_at FROM index_meta WHERE id = 1')

    const count = await driver.execute('SELECT COUNT(*) AS n FROM index_meta')
    expect(count.rows[0].n).toBe(1)
    expect(second.rows[0].created_at).toBe(first.rows[0].created_at)
  })

  it('rejects opening an index that belongs to a different base (anti-mismount guard, §4.1)', async () => {
    await ensureIndexMeta(driver, META_INPUT)

    await expect(ensureIndexMeta(driver, { ...META_INPUT, baseId: 'kb-OTHER' })).rejects.toThrow(
      /belongs to a different base/
    )
  })

  it('keeps the original contract snapshot on re-open even if the running config differs (config is immutable per base)', async () => {
    await ensureIndexMeta(driver, META_INPUT)

    // Same base id, but a different embedding contract — INSERT OR IGNORE must
    // preserve the first-written snapshot rather than overwrite it.
    await ensureIndexMeta(driver, { ...META_INPUT, embeddingModelId: 'other::model', dimensions: 768 })

    const row = (
      await driver.execute('SELECT embedding_model_id_snapshot, dimensions_snapshot FROM index_meta WHERE id = 1')
    ).rows[0]
    expect(row.embedding_model_id_snapshot).toBe('ollama::nomic-embed-text')
    expect(row.dimensions_snapshot).toBe(1024)
  })
})

// Real-schema pins for the store-open diagnostics: the service unit tests mock
// these helpers, so a typo in the probe SQL would otherwise abort every store
// open while the suite stays green.
describe('index content diagnostics', () => {
  let tempDir: string
  let driver: LibsqlDriver

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'cs-knowledge-meta-'))
    driver = await openLibsqlIndexDriver(join(tempDir, 'index.sqlite'))
    await createKnowledgeIndexSchema(driver)
  })

  afterEach(async () => {
    await driver.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('hasAnyMaterial is false on a fresh index and true once a material row exists', async () => {
    expect(await hasAnyMaterial(driver)).toBe(false)

    await driver.execute(
      `INSERT INTO material (material_id, relative_path, status, origin, index_policy, created_at, updated_at)
       VALUES ('m1', 'doc.md', 'active', 'user', 'index', 1, 1)`
    )

    expect(await hasAnyMaterial(driver)).toBe(true)
  })

  it('hasLegacyVectorStoreTable detects the legacy single-table layout remnant', async () => {
    expect(await hasLegacyVectorStoreTable(driver)).toBe(false)

    await driver.execute(`CREATE TABLE libsql_vectorstores_embedding (id TEXT PRIMARY KEY)`)

    expect(await hasLegacyVectorStoreTable(driver)).toBe(true)
  })
})
