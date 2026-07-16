import type * as FileDispatchModule from '@main/services/file/internal/dispatch'
import type { FilePath } from '@shared/types/file'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  appGetMock,
  getMetadataByPathMock,
  readSnapshotByPathMock,
  safeOpenMock,
  showPathInFolderMock,
  writeSnapshotIfUnchangedByPathMock
} = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  getMetadataByPathMock: vi.fn(),
  readSnapshotByPathMock: vi.fn(),
  safeOpenMock: vi.fn(),
  showPathInFolderMock: vi.fn(),
  writeSnapshotIfUnchangedByPathMock: vi.fn()
}))
vi.mock('@application', () => ({ application: { get: appGetMock } }))
vi.mock('@main/services/file', async () => {
  // dispatchHandle is exercised for real so these tests cover handle routing.
  const { dispatchHandle } = await vi.importActual<typeof FileDispatchModule>('@main/services/file/internal/dispatch')
  return {
    dispatchHandle,
    getMetadataByPath: getMetadataByPathMock,
    readSnapshotByPath: readSnapshotByPathMock,
    safeOpen: safeOpenMock,
    showInFolder: showPathInFolderMock,
    writeSnapshotIfUnchangedByPath: writeSnapshotIfUnchangedByPathMock
  }
})

import { PathStaleVersionError } from '@main/utils/file'
import { fileErrorCodes } from '@shared/ipc/errors/file'

import { fileHandlers } from '../file'

const ids = ['019606a0-0000-7000-8000-000000000001', '019606a0-0000-7000-8000-000000000002']

const metadata = {
  kind: 'file' as const,
  type: 'other' as const,
  size: 12,
  createdAt: 1,
  modifiedAt: 2,
  mime: 'text/plain'
}

const batchResult = { succeeded: [ids[0]], failed: [{ id: ids[1], error: 'failed' }] }
const version = { mtime: 1, size: 4 }

const fileManager = {
  getMetadata: vi.fn(),
  getPhysicalPath: vi.fn(),
  batchGetDanglingStates: vi.fn(),
  batchTrash: vi.fn(),
  batchRestore: vi.fn(),
  batchPermanentDelete: vi.fn(),
  emptyTrash: vi.fn(),
  rename: vi.fn(),
  open: vi.fn(),
  showInFolder: vi.fn(),
  batchCreateInternalEntries: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'FileManager') return fileManager
    throw new Error(`Unexpected application.get(${name})`)
  })
})

const ctx = { senderId: null }

describe('fileHandlers', () => {
  it('reads a versioned byte snapshot by path', async () => {
    const snapshot = { content: new Uint8Array([3, 4]), contentHash: '0123456789abcdef', version }
    readSnapshotByPathMock.mockResolvedValueOnce(snapshot)

    await expect(fileHandlers['file.read_snapshot']({ path: '/tmp/report.md' }, ctx)).resolves.toBe(snapshot)

    expect(readSnapshotByPathMock).toHaveBeenCalledWith('/tmp/report.md')
  })

  it('writes a path snapshot only when its version and hash are unchanged', async () => {
    const data = new Uint8Array([5, 6])
    const expectedVersion = { mtime: 1, size: 4 }
    const expectedContentHash = '0123456789abcdef'
    const nextVersion = { mtime: 2, size: 2 }
    const nextContentHash = 'fedcba9876543210'
    writeSnapshotIfUnchangedByPathMock.mockResolvedValueOnce({ contentHash: nextContentHash, version: nextVersion })

    await expect(
      fileHandlers['file.write_if_unchanged'](
        {
          path: '/tmp/report.md',
          data,
          expectedVersion,
          expectedContentHash
        },
        ctx
      )
    ).resolves.toEqual({ contentHash: nextContentHash, version: nextVersion })

    expect(writeSnapshotIfUnchangedByPathMock).toHaveBeenCalledWith(
      '/tmp/report.md',
      data,
      expectedVersion,
      expectedContentHash
    )
  })

  it('maps path version conflicts to FILE_STALE_VERSION', async () => {
    const data = new Uint8Array([5, 6])
    const expected = { mtime: 1, size: 4 }
    const current = { mtime: 2, size: 8 }
    writeSnapshotIfUnchangedByPathMock.mockRejectedValueOnce(
      new PathStaleVersionError('/tmp/report.md' as FilePath, expected, current)
    )
    await expect(
      fileHandlers['file.write_if_unchanged'](
        { path: '/tmp/report.md', data, expectedVersion: expected, expectedContentHash: '0123456789abcdef' },
        ctx
      )
    ).rejects.toMatchObject({
      code: fileErrorCodes.STALE_VERSION,
      data: { expected, current }
    })
  })

  it('batch_get_metadata dispatches FileHandle items inside the IPC adapter', async () => {
    const items = [
      { key: ids[0], handle: { kind: 'entry' as const, entryId: ids[0] } },
      { key: '/tmp/a.txt', handle: { kind: 'path' as const, path: '/tmp/a.txt' } },
      { key: ids[1], handle: { kind: 'entry' as const, entryId: ids[1] } }
    ]
    fileManager.getMetadata.mockResolvedValueOnce(metadata).mockRejectedValueOnce(new Error('ENOENT'))
    getMetadataByPathMock.mockResolvedValueOnce({ ...metadata, size: 34 })

    await expect(fileHandlers['file.batch_get_metadata']({ items }, ctx)).resolves.toEqual({
      [ids[0]]: metadata,
      '/tmp/a.txt': { ...metadata, size: 34 },
      [ids[1]]: null
    })
    expect(fileManager.getMetadata).toHaveBeenCalledWith(ids[0])
    expect(fileManager.getMetadata).toHaveBeenCalledWith(ids[1])
    expect(getMetadataByPathMock).toHaveBeenCalledWith('/tmp/a.txt')
  })

  it('batch_get_physical_paths returns null for per-entry path failures', async () => {
    fileManager.getPhysicalPath.mockReturnValueOnce('/tmp/a.png').mockImplementationOnce(() => {
      throw new Error('ENOENT')
    })

    await expect(fileHandlers['file.batch_get_physical_paths']({ ids }, ctx)).resolves.toEqual({
      [ids[0]]: '/tmp/a.png',
      [ids[1]]: null
    })
    expect(fileManager.getPhysicalPath).toHaveBeenCalledWith(ids[0])
    expect(fileManager.getPhysicalPath).toHaveBeenCalledWith(ids[1])
  })

  it('delegates batch entry operations to FileManager', async () => {
    fileManager.batchGetDanglingStates.mockResolvedValue({ [ids[0]]: 'present' })
    fileManager.batchTrash.mockResolvedValue(batchResult)
    fileManager.batchRestore.mockResolvedValue(batchResult)
    fileManager.batchPermanentDelete.mockResolvedValue(batchResult)
    fileManager.emptyTrash.mockResolvedValue(batchResult)

    await expect(fileHandlers['file.batch_get_dangling_states']({ ids }, ctx)).resolves.toEqual({
      [ids[0]]: 'present'
    })
    await expect(fileHandlers['file.batch_trash']({ ids }, ctx)).resolves.toBe(batchResult)
    await expect(fileHandlers['file.batch_restore']({ ids }, ctx)).resolves.toBe(batchResult)
    await expect(fileHandlers['file.batch_permanent_delete']({ ids }, ctx)).resolves.toBe(batchResult)
    await expect(fileHandlers['file.empty_trash'](undefined, ctx)).resolves.toBe(batchResult)

    expect(fileManager.batchGetDanglingStates).toHaveBeenCalledWith({ ids })
    expect(fileManager.batchTrash).toHaveBeenCalledWith(ids)
    expect(fileManager.batchRestore).toHaveBeenCalledWith(ids)
    expect(fileManager.batchPermanentDelete).toHaveBeenCalledWith(ids)
    expect(fileManager.emptyTrash).toHaveBeenCalled()
  })

  it('delegates single-entry commands to FileManager', async () => {
    const renamed = { id: ids[0], origin: 'internal', name: 'renamed', ext: 'txt', size: 1, createdAt: 1, updatedAt: 2 }
    fileManager.rename.mockResolvedValue(renamed)

    await expect(fileHandlers['file.rename']({ id: ids[0], newName: 'renamed' }, ctx)).resolves.toBe(renamed)
    await fileHandlers['file.open']({ kind: 'entry', entryId: ids[0] }, ctx)
    await fileHandlers['file.show_in_folder']({ kind: 'entry', entryId: ids[0] }, ctx)

    expect(fileManager.rename).toHaveBeenCalledWith(ids[0], 'renamed')
    expect(fileManager.open).toHaveBeenCalledWith(ids[0])
    expect(fileManager.showInFolder).toHaveBeenCalledWith(ids[0])
  })

  it('dispatches path system commands without FileManager entry lookup', async () => {
    await fileHandlers['file.open']({ kind: 'path', path: '/tmp/report.md' }, ctx)
    await fileHandlers['file.show_in_folder']({ kind: 'path', path: '/tmp/report.md' }, ctx)

    expect(safeOpenMock).toHaveBeenCalledWith('/tmp/report.md')
    expect(showPathInFolderMock).toHaveBeenCalledWith('/tmp/report.md')
    expect(fileManager.open).not.toHaveBeenCalled()
    expect(fileManager.showInFolder).not.toHaveBeenCalled()
  })

  it('delegates internal-entry batch create items to FileManager', async () => {
    const result = { succeeded: [{ id: ids[0], sourceRef: '/tmp/a.txt' }], failed: [] }
    const items = [
      { source: 'path' as const, path: '/tmp/a.txt' },
      { source: 'path' as const, path: '/tmp/b.txt' }
    ]
    fileManager.batchCreateInternalEntries.mockResolvedValue(result)

    await expect(fileHandlers['file.batch_create_internal_entries']({ items }, ctx)).resolves.toBe(result)
    expect(fileManager.batchCreateInternalEntries).toHaveBeenCalledWith(items)
  })
})
