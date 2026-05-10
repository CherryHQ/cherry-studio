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
const { withTempCopy } = await import('../tempCopy')
const { createInternal } = await import('../../entry/create')
const { exists } = await import('@main/utils/file/fs')

import type { FileManagerDeps } from '../../deps'

describe('internal/system/tempCopy', () => {
  const dbh = setupTestDatabase()
  let tmp: string
  let filesDir: string
  let deps: FileManagerDeps

  beforeEach(async () => {
    MockMainDbServiceUtils.setDb(dbh.db)
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-tempcopy-'))
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

  it('runs fn with a tmp path that contains a copy of the source content', async () => {
    const e = await createInternal(deps, { source: 'bytes', data: new Uint8Array([0x42]), name: 'a', ext: 'bin' })
    const seen: string[] = []
    const result = await withTempCopy(deps, e.id, async (tmpPath) => {
      seen.push(tmpPath)
      const buf = await readFile(tmpPath)
      expect(buf[0]).toBe(0x42)
      return tmpPath.length
    })
    expect(result).toBe(seen[0].length)
    // tmp path is cleaned up
    expect(await exists(seen[0] as FilePath)).toBe(false)
  })

  it('cleans up tmp dir even when fn throws', async () => {
    const e = await createInternal(deps, { source: 'bytes', data: new Uint8Array([0x01]), name: 'a', ext: 'bin' })
    let seenPath = ''
    await expect(
      withTempCopy(deps, e.id, async (tmpPath) => {
        seenPath = tmpPath
        throw new Error('library failed')
      })
    ).rejects.toThrow(/library failed/)
    expect(await exists(seenPath as FilePath)).toBe(false)
  })

  it('writes by the library to the tmp copy do not affect the source', async () => {
    const e = await createInternal(deps, { source: 'bytes', data: new Uint8Array([0x01]), name: 'a', ext: 'bin' })
    const sourcePhysical = path.join(filesDir, `${e.id}.bin`)
    await withTempCopy(deps, e.id, async (tmpPath) => {
      await writeFile(tmpPath, new Uint8Array([0xff, 0xff, 0xff]))
    })
    const after = await readFile(sourcePhysical)
    expect(Array.from(after)).toEqual([0x01])
  })
})
