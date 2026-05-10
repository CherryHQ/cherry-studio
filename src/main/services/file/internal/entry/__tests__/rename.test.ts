import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { FilePath } from '@shared/file/types'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { application } = await import('@application')
const { fileEntryService } = await import('@data/services/FileEntryService')
const { fileRefService } = await import('@data/services/FileRefService')
const { rename } = await import('../rename')
const { createInternal, ensureExternal } = await import('../create')

import type { FileManagerDeps } from '../../deps'

describe('internal/entry/rename', () => {
  const dbh = setupTestDatabase()
  let tmp: string
  let filesDir: string
  let deps: FileManagerDeps

  beforeEach(async () => {
    MockMainDbServiceUtils.setDb(dbh.db)
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-renametest-'))
    filesDir = path.join(tmp, 'Files')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(filesDir, { recursive: true })
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.files.data') {
        return filename ? path.join(filesDir, filename) : filesDir
      }
      return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
    })
    deps = {
      fileEntryService,
      fileRefService,
      danglingCache: { check: vi.fn(), onFsEvent: vi.fn(), subscribe: vi.fn(() => () => {}), clear: vi.fn() },
      versionCache: { get: vi.fn(), set: vi.fn(), invalidate: vi.fn(), clear: vi.fn() }
    }
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(tmp, { recursive: true, force: true })
  })

  it('updates DB name only for internal entries (physical UUID path unchanged)', async () => {
    const created = await createInternal(deps, {
      source: 'bytes',
      data: new Uint8Array([0x01]),
      name: 'old',
      ext: 'txt'
    })
    const renamed = await rename(deps, created.id, 'new')
    expect(renamed.name).toBe('new')
    expect(renamed.ext).toBe('txt')
    // physical path is still UUID-based; the file exists at the same place
    const physical = path.join(filesDir, `${created.id}.txt`)
    const buf = await readFile(physical)
    expect(buf.length).toBe(1)
  })

  it('renames external file on disk and updates DB externalPath + name', async () => {
    const original = path.join(tmp, 'before.txt')
    await writeFile(original, 'hello')
    const entry = await ensureExternal(deps, { externalPath: original as FilePath })
    const renamed = await rename(deps, entry.id, 'after')
    expect(renamed.name).toBe('after')
    const expectedPath = path.join(tmp, 'after.txt')
    expect(renamed.externalPath).toBe(expectedPath)
    expect(await readFile(expectedPath, 'utf-8')).toBe('hello')
  })

  it('throws and leaves DB unchanged when external rename target already exists', async () => {
    const original = path.join(tmp, 'a.txt')
    const collision = path.join(tmp, 'b.txt')
    await writeFile(original, 'A')
    await writeFile(collision, 'B')
    const entry = await ensureExternal(deps, { externalPath: original as FilePath })
    await expect(rename(deps, entry.id, 'b')).rejects.toThrow()
    const stored = await fileEntryService.getById(entry.id)
    expect(stored.name).toBe('a')
    expect(stored.externalPath).toBe(original)
    // Both files still exist with their original content
    expect(await readFile(original, 'utf-8')).toBe('A')
    expect(await readFile(collision, 'utf-8')).toBe('B')
  })
})
