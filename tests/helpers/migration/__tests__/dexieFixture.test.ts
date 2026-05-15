import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'
import { buildDexieFileRow, buildDexieFilesTable } from '../dexieFixture'

describe('buildDexieFileRow — internal', () => {
  it('produces v1 internal row with required fields', () => {
    const row = buildDexieFileRow({ kind: 'internal', id: 'abc-123', name: 'doc-stored', origin_name: 'My Doc.pdf' })
    expect(row).toMatchObject({
      id: 'abc-123',
      name: 'doc-stored',
      origin_name: 'My Doc.pdf',
      ext: '.pdf',
      size: expect.any(Number),
      type: 'document',
      count: 1
    })
    expect(typeof row.created_at).toBe('string')
    expect(row.path).toMatch(/abc-123/)
  })
})

describe('buildDexieFileRow — external', () => {
  it('produces v1 external row with absolute path', () => {
    const row = buildDexieFileRow({ kind: 'external', id: 'ext-1', path: '/Users/me/Docs/report.pdf' })
    expect(row).toMatchObject({
      id: 'ext-1',
      path: '/Users/me/Docs/report.pdf',
      ext: '.pdf'
    })
    expect(row.origin_name).toBe('report.pdf')
  })
})

describe('buildDexieFilesTable', () => {
  let root: string

  afterAll(() => {
    if (root) {
      try {
        rmSync(root, { recursive: true, force: true })
      } catch {
        // best-effort cleanup — tmpdir will be reaped by the OS
      }
    }
  })

  it('seeds files on disk under the provided physical root', async () => {
    root = mkdtempSync(join(tmpdir(), 'dexie-fixture-'))
    const table = await buildDexieFilesTable({
      physicalRoot: root,
      rows: [{ kind: 'internal', id: 'abc-123', name: 'doc', origin_name: 'doc.pdf', size: 4096 }]
    })
    expect(table).toHaveLength(1)
    const path = join(root, 'Data', 'Files', 'abc-123.pdf')
    expect(statSync(path).size).toBe(4096)
  })
})

describe('buildDexieFileRow — edge shapes', () => {
  it('preserves empty ext for extensionless files', () => {
    const row = buildDexieFileRow({ kind: 'internal', id: 'x', name: 'README', origin_name: 'README' })
    expect(row.ext).toBe('')
  })

  it('accepts created_at as number (legacy ms epoch)', () => {
    const row = buildDexieFileRow({
      kind: 'internal',
      id: 'x',
      name: 'a',
      origin_name: 'a.txt',
      created_at: '1700000000000'
    })
    expect(row.created_at).toBe('1700000000000')
  })

  it('accepts UUID v4 and v7 alike', () => {
    const v4 = buildDexieFileRow({
      kind: 'internal',
      id: '4ec8a8c0-3a3e-4d6e-9a3e-3a3e3a3e3a3e',
      name: 'a',
      origin_name: 'a.txt'
    })
    const v7 = buildDexieFileRow({
      kind: 'internal',
      id: '01900000-0000-7000-8000-000000000000',
      name: 'a',
      origin_name: 'a.txt'
    })
    expect(v4.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(v7.id).toMatch(/^[0-9a-f-]{36}$/)
  })
})
