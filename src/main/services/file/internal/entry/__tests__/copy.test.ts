import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { FileEntryId } from '@shared/data/types/file'
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
const { copy } = await import('../copy')
const { createInternal, ensureExternal } = await import('../create')

import type { FileManagerDeps } from '../../deps'

describe('internal/entry/copy', () => {
  const dbh = setupTestDatabase()
  let tmp: string
  let filesDir: string
  let deps: FileManagerDeps

  beforeEach(async () => {
    MockMainDbServiceUtils.setDb(dbh.db)
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-copytest-'))
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

  it('copies an internal source into a fresh internal entry with a new UUID', async () => {
    const src = await createInternal(deps, {
      source: 'bytes',
      data: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      name: 'src',
      ext: 'bin'
    })
    const dst = await copy(deps, { id: src.id as FileEntryId })
    expect(dst.id).not.toBe(src.id)
    expect(dst.origin).toBe('internal')
    expect(dst.size).toBe(4)
    const dstPhysical = path.join(filesDir, `${dst.id}.bin`)
    const buf = await readFile(dstPhysical)
    expect(Array.from(buf)).toEqual([0xde, 0xad, 0xbe, 0xef])
  })

  it('respects newName override', async () => {
    const src = await createInternal(deps, { source: 'bytes', data: new Uint8Array([0]), name: 'orig', ext: 'txt' })
    const dst = await copy(deps, { id: src.id as FileEntryId, newName: 'renamed' })
    expect(dst.name).toBe('renamed')
  })

  it('copies an external source into a fresh internal entry', async () => {
    const ext = path.join(tmp, 'ext.txt')
    await writeFile(ext, 'external-content')
    const src = await ensureExternal(deps, { externalPath: ext as FilePath })
    const dst = await copy(deps, { id: src.id as FileEntryId })
    expect(dst.origin).toBe('internal')
    const dstPhysical = path.join(filesDir, `${dst.id}.txt`)
    expect(await readFile(dstPhysical, 'utf-8')).toBe('external-content')
  })
})
