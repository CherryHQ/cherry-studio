import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ensureIndexMeta, hasAnyMaterial } from '../indexMeta'
import type { LibsqlDriver } from '../LibsqlDriver'
import { openLibsqlIndexDriver } from '../LibsqlDriver'
import { createKnowledgeIndexSchema, KNOWLEDGE_INDEX_SCHEMA_VERSION } from '../schema'

const META_INPUT = {
  baseId: 'kb-1'
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

  it('writes the single meta identity row with the schema version and base id on first open', async () => {
    await ensureIndexMeta(driver, META_INPUT)

    const result = await driver.execute('SELECT * FROM meta')
    expect(result.rows).toHaveLength(1)
    const row = result.rows[0]
    expect(row.id).toBe(1)
    expect(row.schema_version).toBe(KNOWLEDGE_INDEX_SCHEMA_VERSION)
    expect(row.base_id).toBe('kb-1')
  })

  it('is idempotent across re-opens: the original row is kept, not duplicated or rewritten', async () => {
    await ensureIndexMeta(driver, META_INPUT)
    const first = await driver.execute('SELECT created_at FROM meta WHERE id = 1')

    await ensureIndexMeta(driver, META_INPUT)
    const second = await driver.execute('SELECT created_at FROM meta WHERE id = 1')

    const count = await driver.execute('SELECT COUNT(*) AS n FROM meta')
    expect(count.rows[0].n).toBe(1)
    expect(second.rows[0].created_at).toBe(first.rows[0].created_at)
  })

  it('rejects opening an index that belongs to a different base (anti-mismount guard, §4.1)', async () => {
    await ensureIndexMeta(driver, META_INPUT)

    await expect(ensureIndexMeta(driver, { ...META_INPUT, baseId: 'kb-OTHER' })).rejects.toThrow(
      /belongs to a different base/
    )
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
      `INSERT INTO material (material_id, relative_path, created_at, updated_at)
       VALUES ('m1', 'doc.md', 1, 1)`
    )

    expect(await hasAnyMaterial(driver)).toBe(true)
  })
})
