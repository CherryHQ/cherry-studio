import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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

const mockLoggerWarn = vi.hoisted(() => vi.fn())
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: mockLoggerWarn,
      error: vi.fn()
    })
  }
}))

const { application } = await import('@application')
const { fileEntryService } = await import('@data/services/FileEntryService')
const { fileRefService } = await import('@data/services/FileRefService')
const { createDefaultOrphanCheckerRegistry } = await import('@data/services/orphan/FileRefCheckerRegistry')
const { batchPermanentDelete, batchRestore, batchTrash, permanentDelete, restore, trash } = await import('../lifecycle')
const { exists } = await import('@main/utils/file/fs')
const { createInternal, ensureExternal } = await import('../create')

import type { FileManagerDeps } from '../../deps'

describe('internal/entry/lifecycle', () => {
  const dbh = setupTestDatabase()
  let tmp: string
  let filesDir: string
  let deps: FileManagerDeps

  beforeEach(async () => {
    MockMainDbServiceUtils.setDb(dbh.db)
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-lctest-'))
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
      danglingCache: {
        check: vi.fn(),
        onFsEvent: vi.fn(),
        addEntry: vi.fn(),
        removeEntry: vi.fn(),
        initFromDb: vi.fn(),
        subscribe: vi.fn(() => () => {}),
        onDanglingStateChanged: vi.fn(() => ({ dispose: () => {} })),
        clear: vi.fn()
      },
      versionCache: { get: vi.fn(), set: vi.fn(), invalidate: vi.fn(), clear: vi.fn() },
      orphanRegistry: createDefaultOrphanCheckerRegistry()
    }
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(tmp, { recursive: true, force: true })
  })

  async function makeInternal(): Promise<FileEntryId> {
    const e = await createInternal(deps, { source: 'bytes', data: new Uint8Array([0x01]), name: 'n', ext: 'txt' })
    return e.id
  }

  async function makeExternal(): Promise<FileEntryId> {
    const file = path.join(tmp, 'ext.txt')
    await writeFile(file, 'x')
    const e = await ensureExternal(deps, { externalPath: file as FilePath })
    return e.id
  }

  describe('trash', () => {
    it('marks an internal entry as trashed', async () => {
      const id = await makeInternal()
      await trash(deps, id)
      const entry = await fileEntryService.getById(id)
      expect(entry.trashedAt).not.toBeNull()
    })

    it('throws when called on an external entry (CHECK fe_external_no_trash)', async () => {
      const id = await makeExternal()
      await expect(trash(deps, id)).rejects.toThrow()
    })
  })

  describe('restore', () => {
    it('clears trashedAt on a trashed internal entry', async () => {
      const id = await makeInternal()
      await trash(deps, id)
      await restore(deps, id)
      const entry = await fileEntryService.getById(id)
      expect(entry.trashedAt).toBeNull()
    })

    it('throws on an external entry', async () => {
      const id = await makeExternal()
      await expect(restore(deps, id)).rejects.toThrow()
    })
  })

  describe('permanentDelete', () => {
    it('removes DB row + unlinks physical for internal entries', async () => {
      const id = await makeInternal()
      const entry = await fileEntryService.getById(id)
      const physical = path.join(filesDir, `${id}.${entry.ext}`)
      expect(await exists(physical as FilePath)).toBe(true)
      await permanentDelete(deps, id)
      expect(await fileEntryService.findById(id)).toBeNull()
      expect(await exists(physical as FilePath)).toBe(false)
    })

    it('removes DB row but leaves user file untouched for external entries', async () => {
      const id = await makeExternal()
      const entry = await fileEntryService.getById(id)
      const userFile = entry.externalPath as string
      expect(await exists(userFile as FilePath)).toBe(true)
      await permanentDelete(deps, id)
      expect(await fileEntryService.findById(id)).toBeNull()
      expect(await exists(userFile as FilePath)).toBe(true)
    })

    it('still deletes the row when the internal physical file is missing', async () => {
      const id = await makeInternal()
      const entry = await fileEntryService.getById(id)
      const physical = path.join(filesDir, `${id}.${entry.ext}`)
      const { unlink } = await import('node:fs/promises')
      await unlink(physical)
      await permanentDelete(deps, id)
      expect(await fileEntryService.findById(id)).toBeNull()
    })

    it('removes the entry from DanglingCache reverse index when external', async () => {
      const id = await makeExternal()
      const entry = await fileEntryService.getById(id)
      vi.mocked(deps.danglingCache.removeEntry).mockClear()
      await permanentDelete(deps, id)
      expect(deps.danglingCache.removeEntry).toHaveBeenCalledWith(id, entry.externalPath)
    })

    it('does not call removeEntry for internal entries', async () => {
      const id = await makeInternal()
      vi.mocked(deps.danglingCache.removeEntry).mockClear()
      await permanentDelete(deps, id)
      expect(deps.danglingCache.removeEntry).not.toHaveBeenCalled()
    })
  })

  describe('batch ops', () => {
    it('batchTrash partitions internal-success / external-failure', async () => {
      const internal = await makeInternal()
      const external = await makeExternal()
      const result = await batchTrash(deps, [internal, external])
      expect(result.succeeded).toEqual([internal])
      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].id).toBe(external)
    })

    it('batchRestore restores trashed internals and fails on externals', async () => {
      const internal = await makeInternal()
      await trash(deps, internal)
      const external = await makeExternal()
      const result = await batchRestore(deps, [internal, external])
      expect(result.succeeded).toEqual([internal])
      expect(result.failed).toHaveLength(1)
    })

    it('batchPermanentDelete deletes both internal and external rows', async () => {
      const internal = await makeInternal()
      const external = await makeExternal()
      const result = await batchPermanentDelete(deps, [internal, external])
      expect(result.succeeded.sort()).toEqual([internal, external].sort())
      expect(result.failed).toEqual([])
    })

    it('side-channels the full Error object through logger.warn so the stack is preserved', async () => {
      // Regression guard for 5bcf03529: BatchOperationResult.failed[].error is
      // a string for IPC serialisation, so the wire format drops the stack.
      // The fix routes the original Error through logger.warn as { id, err };
      // a refactor to logger.warn(..., { id, msg: err.message }) would satisfy
      // toHaveBeenCalledWith on { id } but fail the `instanceof Error` +
      // non-empty `stack` assertions below — exactly the regression we want
      // to catch.
      mockLoggerWarn.mockClear()
      const internal = await makeInternal()
      const external = await makeExternal()
      const result = await batchTrash(deps, [internal, external])
      expect(result.failed).toHaveLength(1)
      const warnCalls = mockLoggerWarn.mock.calls.filter(([msg]) => msg === 'batch op item failed')
      expect(warnCalls).toHaveLength(1)
      const [, payload] = warnCalls[0]
      expect(payload.id).toBe(external)
      // The contract: payload.err must be the original Error (with stack),
      // not its `.message` projection. `toBeInstanceOf` tolerates whichever
      // Error subclass the CHECK constraint raises while still catching a
      // string downgrade.
      expect(payload.err).toBeInstanceOf(Error)
      expect(typeof payload.err.stack).toBe('string')
      expect(payload.err.stack.length).toBeGreaterThan(0)
    })
  })
})
