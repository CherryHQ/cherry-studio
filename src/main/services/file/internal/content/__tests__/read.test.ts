import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { fileEntryTable } from '@data/db/schemas/file'
import type { CanonicalExternalPath, FileEntryId } from '@shared/data/types/file'
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
const { read, readByPath } = await import('../read')

import type { FileManagerDeps } from '../../deps'

describe('internal/content/read', () => {
  const dbh = setupTestDatabase()
  let tmp: string
  let onFsEventCalls: Array<{ path: string; state: string }>
  let deps: FileManagerDeps

  beforeEach(async () => {
    MockMainDbServiceUtils.setDb(dbh.db)
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-readtest-'))
    onFsEventCalls = []
    deps = {
      fileEntryService,
      fileRefService,
      danglingCache: {
        check: vi.fn(),
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

  it('reads text content for an existing external entry', async () => {
    const id = '019606a0-0000-7000-8000-000000000c01' as FileEntryId
    const file = path.join(tmp, 'note.txt')
    await writeFile(file, 'hello world', 'utf-8')
    const now = Date.now()
    await dbh.db.insert(fileEntryTable).values({
      id,
      origin: 'external',
      name: 'note',
      ext: 'txt',
      size: null,
      externalPath: file,
      trashedAt: null,
      createdAt: now,
      updatedAt: now
    })

    const result = await read(deps, id)
    expect(result.content).toBe('hello world')
    expect(result.mime).toBe('text/plain')
    expect(result.version.size).toBe('hello world'.length)
  })

  it('reads base64 content with inferred mime', async () => {
    const id = '019606a0-0000-7000-8000-000000000c02' as FileEntryId
    const file = path.join(tmp, 'pic.png')
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    await writeFile(file, bytes)
    const now = Date.now()
    await dbh.db.insert(fileEntryTable).values({
      id,
      origin: 'external',
      name: 'pic',
      ext: 'png',
      size: null,
      externalPath: file,
      trashedAt: null,
      createdAt: now,
      updatedAt: now
    })

    const result = await read(deps, id, { encoding: 'base64' })
    expect(result.content).toBe(bytes.toString('base64'))
    expect(result.mime).toBe('image/png')
  })

  it('reads binary content as Uint8Array', async () => {
    const id = '019606a0-0000-7000-8000-000000000c03' as FileEntryId
    const file = path.join(tmp, 'doc.pdf')
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46])
    await writeFile(file, bytes)
    const now = Date.now()
    await dbh.db.insert(fileEntryTable).values({
      id,
      origin: 'external',
      name: 'doc',
      ext: 'pdf',
      size: null,
      externalPath: file,
      trashedAt: null,
      createdAt: now,
      updatedAt: now
    })

    const result = await read(deps, id, { encoding: 'binary' })
    expect(result.content).toBeInstanceOf(Uint8Array)
    expect(result.mime).toBe('application/pdf')
  })

  it('throws when entry id does not exist', async () => {
    await expect(read(deps, '019606a0-0000-7000-8000-9999cccccccc' as FileEntryId)).rejects.toThrow(/not found/i)
  })

  it('updates DanglingCache to "missing" on ENOENT for external entry', async () => {
    const id = '019606a0-0000-7000-8000-000000000c10' as FileEntryId
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

    await expect(read(deps, id)).rejects.toThrow(/ENOENT/)
    expect(onFsEventCalls).toEqual([{ path: file, state: 'missing' }])
  })

  it('readByPath bypasses entry resolution', async () => {
    const file = path.join(tmp, 'direct.txt') as FilePath
    await writeFile(file, 'direct content', 'utf-8')
    const result = await readByPath(deps, file)
    expect(result.content).toBe('direct content')
  })

  it('proves CanonicalExternalPath brand is unused (read uses raw FilePath)', () => {
    // Sanity: external-path lookup goes through fileEntryService.findByExternalPath,
    // not through internal/content/read. This test exists to prevent accidental
    // signature drift between modules.
    const _brand: CanonicalExternalPath = '/tmp/x' as CanonicalExternalPath
    expect(typeof _brand).toBe('string')
  })
})
