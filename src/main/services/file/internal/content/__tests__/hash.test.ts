import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { fileEntryTable } from '@data/db/schemas/file'
import type { FileEntryId } from '@shared/data/types/file'
import type { FilePath } from '@shared/file/types'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { fileEntryService } = await import('@data/services/FileEntryService')
const { fileRefService } = await import('@data/services/FileRefService')
const { createDefaultOrphanCheckerRegistry } = await import('@data/services/orphan/FileRefCheckerRegistry')
const { hash, hashByPath } = await import('../hash')

import type { FileManagerDeps } from '../../deps'

describe('internal/content/hash', () => {
  const dbh = setupTestDatabase()
  let tmp: string
  let onFsEventCalls: Array<{ path: string; state: string }>
  let deps: FileManagerDeps

  beforeEach(async () => {
    MockMainDbServiceUtils.setDb(dbh.db)
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-hashtest-'))
    onFsEventCalls = []
    deps = {
      fileEntryService,
      fileRefService,
      danglingCache: {
        check: vi.fn(),
        forceRecheck: vi.fn(),
        onFsEvent: vi.fn((p: FilePath, state: 'present' | 'missing') => {
          onFsEventCalls.push({ path: p, state })
        }),
        addEntry: vi.fn(),
        removeEntry: vi.fn(),
        initFromDb: vi.fn(),
        subscribe: vi.fn(() => () => {}),
        onDanglingStateChanged: vi.fn(() => ({ dispose: () => {} })),
        clear: vi.fn()
      },
      versionCache: {
        get: vi.fn(),
        set: vi.fn(),
        invalidate: vi.fn(),
        clear: vi.fn()
      },
      orphanRegistry: createDefaultOrphanCheckerRegistry()
    }
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('returns deterministic hash for an existing entry', async () => {
    const id = '019606a0-0000-7000-8000-000000000d01' as FileEntryId
    const file = path.join(tmp, 'a.txt')
    await writeFile(file, 'hello')
    const now = Date.now()
    await dbh.db.insert(fileEntryTable).values({
      id,
      origin: 'external',
      name: 'a',
      ext: 'txt',
      size: null,
      externalPath: file,
      trashedAt: null,
      createdAt: now,
      updatedAt: now
    })

    const h1 = await hash(deps, id)
    const h2 = await hash(deps, id)
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]+$/)
  })

  it('returns different hashes for different content', async () => {
    const idA = '019606a0-0000-7000-8000-000000000d02' as FileEntryId
    const idB = '019606a0-0000-7000-8000-000000000d03' as FileEntryId
    const fileA = path.join(tmp, 'a.txt')
    const fileB = path.join(tmp, 'b.txt')
    await writeFile(fileA, 'hello')
    await writeFile(fileB, 'goodbye')
    const now = Date.now()
    await dbh.db.insert(fileEntryTable).values([
      {
        id: idA,
        origin: 'external',
        name: 'a',
        ext: 'txt',
        size: null,
        externalPath: fileA,
        trashedAt: null,
        createdAt: now,
        updatedAt: now
      },
      {
        id: idB,
        origin: 'external',
        name: 'b',
        ext: 'txt',
        size: null,
        externalPath: fileB,
        trashedAt: null,
        createdAt: now,
        updatedAt: now
      }
    ])

    expect(await hash(deps, idA)).not.toBe(await hash(deps, idB))
  })

  it('updates DanglingCache on ENOENT for external entry', async () => {
    const id = '019606a0-0000-7000-8000-000000000d10' as FileEntryId
    const file = path.join(tmp, 'gone.txt')
    const now = Date.now()
    await dbh.db.insert(fileEntryTable).values({
      id,
      origin: 'external',
      name: 'gone',
      ext: 'txt',
      size: null,
      externalPath: file,
      trashedAt: null,
      createdAt: now,
      updatedAt: now
    })

    await expect(hash(deps, id)).rejects.toThrow(/ENOENT/)
    expect(onFsEventCalls).toEqual([{ path: file, state: 'missing' }])
  })

  it('hashByPath bypasses entry resolution', async () => {
    const file = path.join(tmp, 'direct.txt') as FilePath
    await writeFile(file, 'direct')
    const result = await hashByPath(deps, file)
    expect(result).toMatch(/^[0-9a-f]+$/)
  })
})
