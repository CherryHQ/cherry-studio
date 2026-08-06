import type * as FileDispatchModule from '@main/services/file/internal/dispatch'
import { fileRequestSchemas } from '@shared/ipc/schemas/file'
import type { AbsoluteFilePath } from '@shared/types/file'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  appGetMock,
  assertOutsideManagedStorageMutationMock,
  getMetadataByPathMock,
  readByPathMock,
  readChunkByPathMock,
  safeOpenMock,
  showPathInFolderMock,
  writeIfUnchangedByPathMock
} = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  assertOutsideManagedStorageMutationMock: vi.fn(),
  getMetadataByPathMock: vi.fn(),
  readByPathMock: vi.fn(),
  readChunkByPathMock: vi.fn(),
  safeOpenMock: vi.fn(),
  showPathInFolderMock: vi.fn(),
  writeIfUnchangedByPathMock: vi.fn()
}))
vi.mock('@application', () => ({ application: { get: appGetMock } }))
vi.mock('@main/services/file', async () => {
  // dispatchHandle is exercised for real so these tests cover handle routing.
  const { dispatchHandle } = await vi.importActual<typeof FileDispatchModule>('@main/services/file/internal/dispatch')
  return {
    ContentCommittedMetadataPendingError: class ContentCommittedMetadataPendingError extends Error {
      constructor(
        readonly entryId: string,
        readonly version: { mtime: number; size: number }
      ) {
        super('metadata pending')
      }
    },
    StaleVersionError: class StaleVersionError extends Error {
      constructor(
        readonly expected: { mtime: number; size: number },
        readonly current: { mtime: number; size: number }
      ) {
        super('stale')
      }
    },
    DirectoryTreeStoppedError: class DirectoryTreeStoppedError extends Error {
      constructor() {
        super('DirectoryTreeManager stopped during in-flight builder creation')
      }
    },
    assertOutsideManagedStorageMutation: assertOutsideManagedStorageMutationMock,
    dispatchHandle,
    getMetadataByPath: getMetadataByPathMock,
    readByPath: readByPathMock,
    readChunkByPath: readChunkByPathMock,
    safeOpen: safeOpenMock,
    showInFolder: showPathInFolderMock,
    writeIfUnchangedByPath: writeIfUnchangedByPathMock
  }
})

import { ContentCommittedMetadataPendingError, DirectoryTreeStoppedError } from '@main/services/file'
import { PathStaleVersionError } from '@main/utils/file'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'

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
  read: vi.fn(),
  getMetadata: vi.fn(),
  getPhysicalPath: vi.fn(),
  batchGetDanglingStates: vi.fn(),
  batchTrash: vi.fn(),
  batchRestore: vi.fn(),
  batchPermanentDelete: vi.fn(),
  emptyTrash: vi.fn(),
  rename: vi.fn(),
  readChunk: vi.fn(),
  open: vi.fn(),
  showInFolder: vi.fn(),
  writeIfUnchanged: vi.fn(),
  batchCreateInternalEntries: vi.fn()
}

const directoryTreeManager = {
  create: vi.fn(),
  activateTree: vi.fn(),
  dispose: vi.fn(),
  rename: vi.fn()
}

const senderWebContents = { id: 7 }
const windowManager = { getWindow: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  windowManager.getWindow.mockImplementation((id: string) =>
    id === 'win-1' ? { webContents: senderWebContents } : undefined
  )
  appGetMock.mockImplementation((name: string) => {
    if (name === 'FileManager') return fileManager
    if (name === 'DirectoryTreeManager') return directoryTreeManager
    if (name === 'WindowManager') return windowManager
    throw new Error(`Unexpected application.get(${name})`)
  })
})

const ctx = { senderId: null }
const windowCtx = { senderId: 'win-1' }

describe('fileHandlers', () => {
  it('does not expose the pure-SQL content-hash lookup through IpcApi', () => {
    expect('file.find_internal_by_content_hash' in fileRequestSchemas).toBe(false)
    expect('file.find_internal_by_content_hash' in fileHandlers).toBe(false)
  })

  it('reads binary content by path through the generic FileHandle route', async () => {
    const result = { content: new Uint8Array([3, 4]), mime: 'text/markdown', version }
    readByPathMock.mockResolvedValueOnce(result)

    await expect(
      fileHandlers['file.read'](
        {
          handle: { kind: 'path', path: '/tmp/report.md' as AbsoluteFilePath },
          options: { mode: 'full', encoding: 'binary' }
        },
        ctx
      )
    ).resolves.toBe(result)

    expect(readByPathMock).toHaveBeenCalledWith('/tmp/report.md', { encoding: 'binary' })
  })

  it('reads binary content from a managed entry through the generic FileHandle route', async () => {
    const result = { content: new Uint8Array([3, 4]), mime: 'text/markdown', version }
    fileManager.read.mockResolvedValueOnce(result)

    await expect(
      fileHandlers['file.read'](
        { handle: { kind: 'entry', entryId: ids[0] }, options: { mode: 'full', encoding: 'binary' } },
        ctx
      )
    ).resolves.toBe(result)

    expect(fileManager.read).toHaveBeenCalledWith(ids[0], { encoding: 'binary' })
  })

  it('writes a path only when its version is unchanged', async () => {
    const data = new Uint8Array([5, 6])
    const expectedVersion = { mtime: 1, size: 4 }
    const nextVersion = { mtime: 2, size: 2 }
    writeIfUnchangedByPathMock.mockResolvedValueOnce(nextVersion)

    await expect(
      fileHandlers['file.write_if_unchanged'](
        {
          handle: { kind: 'path', path: '/tmp/report.md' as AbsoluteFilePath },
          data,
          expectedVersion
        },
        ctx
      )
    ).resolves.toBe(nextVersion)

    expect(assertOutsideManagedStorageMutationMock).toHaveBeenCalledWith('/tmp/report.md')
    expect(writeIfUnchangedByPathMock).toHaveBeenCalledWith('/tmp/report.md', data, expectedVersion, undefined)
  })

  it('writes a managed entry through FileManager', async () => {
    const data = new Uint8Array([5, 6])
    const expectedVersion = { mtime: 1, size: 4 }
    const nextVersion = { mtime: 2, size: 2 }
    fileManager.writeIfUnchanged.mockResolvedValueOnce(nextVersion)

    await expect(
      fileHandlers['file.write_if_unchanged'](
        {
          handle: { kind: 'entry', entryId: ids[0] },
          data,
          expectedVersion
        },
        ctx
      )
    ).resolves.toBe(nextVersion)

    expect(fileManager.writeIfUnchanged).toHaveBeenCalledWith(ids[0], data, expectedVersion, undefined)
    expect(assertOutsideManagedStorageMutationMock).not.toHaveBeenCalled()
  })

  it('maps path version conflicts to FILE_STALE_VERSION', async () => {
    const data = new Uint8Array([5, 6])
    const expected = { mtime: 1, size: 4 }
    const current = { mtime: 2, size: 8 }
    writeIfUnchangedByPathMock.mockRejectedValueOnce(
      new PathStaleVersionError('/tmp/report.md' as AbsoluteFilePath, expected, current)
    )
    await expect(
      fileHandlers['file.write_if_unchanged'](
        {
          handle: { kind: 'path', path: '/tmp/report.md' as AbsoluteFilePath },
          data,
          expectedVersion: expected
        },
        ctx
      )
    ).rejects.toMatchObject({
      code: fileErrorCodes.STALE_VERSION,
      data: { expected, current }
    })
  })

  it('maps committed bytes with pending metadata to the stable IPC error code', async () => {
    const data = new Uint8Array([5, 6])
    const expectedVersion = { mtime: 1, size: 4 }
    const committedVersion = { mtime: 2, size: 2 }
    fileManager.writeIfUnchanged.mockRejectedValueOnce(
      new ContentCommittedMetadataPendingError(ids[0], committedVersion)
    )

    await expect(
      fileHandlers['file.write_if_unchanged'](
        {
          handle: { kind: 'entry', entryId: ids[0] },
          data,
          expectedVersion
        },
        ctx
      )
    ).rejects.toMatchObject({
      code: fileErrorCodes.COMMITTED_METADATA_PENDING,
      data: { entryId: ids[0], version: committedVersion }
    })
  })

  it('batch_get_metadata dispatches FileHandle items inside the IPC adapter', async () => {
    const items = [
      { key: ids[0], handle: { kind: 'entry' as const, entryId: ids[0] } },
      { key: '/tmp/a.txt', handle: { kind: 'path' as const, path: '/tmp/a.txt' as AbsoluteFilePath } },
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

  it('get_metadata returns file metadata for a regular file path', async () => {
    getMetadataByPathMock.mockResolvedValueOnce({ ...metadata, size: 42 })

    await expect(
      fileHandlers['file.get_metadata']({ kind: 'path', path: '/tmp/a.txt' as AbsoluteFilePath }, ctx)
    ).resolves.toEqual({
      ...metadata,
      size: 42
    })
    expect(getMetadataByPathMock).toHaveBeenCalledWith('/tmp/a.txt')
  })

  it('get_metadata returns directory metadata for a directory path', async () => {
    const directoryMetadata = { kind: 'directory' as const, size: 0, createdAt: 1, modifiedAt: 2 }
    getMetadataByPathMock.mockResolvedValueOnce(directoryMetadata)

    await expect(
      fileHandlers['file.get_metadata']({ kind: 'path', path: '/tmp/dir' as AbsoluteFilePath }, ctx)
    ).resolves.toEqual(directoryMetadata)
    expect(getMetadataByPathMock).toHaveBeenCalledWith('/tmp/dir')
  })

  it('get_metadata resolves null for a missing path instead of throwing', async () => {
    getMetadataByPathMock.mockRejectedValueOnce(new Error('ENOENT'))

    await expect(
      fileHandlers['file.get_metadata']({ kind: 'path', path: '/tmp/missing.txt' as AbsoluteFilePath }, ctx)
    ).resolves.toBeNull()
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
    await fileHandlers['file.open']({ kind: 'path', path: '/tmp/report.md' as AbsoluteFilePath }, ctx)
    await fileHandlers['file.show_in_folder']({ kind: 'path', path: '/tmp/report.md' as AbsoluteFilePath }, ctx)

    expect(safeOpenMock).toHaveBeenCalledWith('/tmp/report.md')
    expect(showPathInFolderMock).toHaveBeenCalledWith('/tmp/report.md')
    expect(fileManager.open).not.toHaveBeenCalled()
    expect(fileManager.showInFolder).not.toHaveBeenCalled()
  })

  it('dispatches range reads for entry and path handles through file.read', async () => {
    const entryResult = { content: new Uint8Array([1, 2, 3]), mime: 'application/pdf', version }
    const pathResult = { content: new Uint8Array([4, 5]), mime: 'application/pdf', version }
    fileManager.readChunk.mockResolvedValueOnce(entryResult)
    readChunkByPathMock.mockResolvedValueOnce(pathResult)

    await expect(
      fileHandlers['file.read'](
        { handle: { kind: 'entry', entryId: ids[0] }, options: { mode: 'range', offset: 10, length: 3 } },
        ctx
      )
    ).resolves.toBe(entryResult)
    await expect(
      fileHandlers['file.read'](
        {
          handle: { kind: 'path', path: '/tmp/report.pdf' as AbsoluteFilePath },
          options: { mode: 'range', offset: 20, length: 2 }
        },
        ctx
      )
    ).resolves.toBe(pathResult)

    expect(fileManager.readChunk).toHaveBeenCalledWith(ids[0], 10, 3)
    expect(readChunkByPathMock).toHaveBeenCalledWith('/tmp/report.pdf', 20, 2)
  })

  it('delegates internal-entry batch create items to FileManager', async () => {
    const result = { succeeded: [{ id: ids[0], sourceRef: '/tmp/a.txt' }], failed: [] }
    const items = [
      { source: 'path' as const, path: '/tmp/a.txt' as AbsoluteFilePath, cleanupPolicy: 'manual' as const },
      { source: 'path' as const, path: '/tmp/b.txt' as AbsoluteFilePath, cleanupPolicy: 'manual' as const }
    ]
    fileManager.batchCreateInternalEntries.mockResolvedValue(result)

    await expect(fileHandlers['file.batch_create_internal_entries']({ items }, ctx)).resolves.toBe(result)
    expect(fileManager.batchCreateInternalEntries).toHaveBeenCalledWith(items)
  })

  it('creates a directory tree addressed to the caller window WebContents', async () => {
    const created = { treeId: 't-1', revision: 0, snapshot: { kind: 'directory', path: '/tmp/ws', basename: 'ws' } }
    directoryTreeManager.create.mockResolvedValueOnce(created)

    await expect(
      fileHandlers['file.tree.create']({ rootPath: '/tmp/ws' as AbsoluteFilePath, options: { maxDepth: 1 } }, windowCtx)
    ).resolves.toBe(created)

    expect(directoryTreeManager.create).toHaveBeenCalledWith(senderWebContents, '/tmp/ws', { maxDepth: 1 })
  })

  it('refuses to create a directory tree for a sender that is not a managed window', async () => {
    await expect(
      fileHandlers['file.tree.create']({ rootPath: '/tmp/ws' as AbsoluteFilePath, options: undefined }, ctx)
    ).rejects.toThrow('managed window sender')
    expect(directoryTreeManager.create).not.toHaveBeenCalled()
  })

  it('maps a shutdown-in-flight create to the DIRECTORY_TREE_STOPPED code', async () => {
    directoryTreeManager.create.mockRejectedValueOnce(new DirectoryTreeStoppedError())

    // Without the code the router would normalize it to INTERNAL and the renderer
    // would toast a shutdown as a real failure.
    const error = await fileHandlers['file.tree.create'](
      { rootPath: '/tmp/ws' as AbsoluteFilePath, options: undefined },
      windowCtx
    ).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(IpcError)
    expect((error as IpcError).code).toBe(fileErrorCodes.DIRECTORY_TREE_STOPPED)
  })

  it('delegates activate / dispose / rename to DirectoryTreeManager', async () => {
    directoryTreeManager.activateTree.mockReturnValueOnce(true)
    directoryTreeManager.rename.mockReturnValueOnce(true)

    await expect(fileHandlers['file.tree.activate']({ treeId: 't-1', revision: 3 }, ctx)).resolves.toBe(true)
    await expect(fileHandlers['file.tree.dispose']({ treeId: 't-1' }, ctx)).resolves.toBeUndefined()
    await expect(
      fileHandlers['file.tree.rename'](
        { treeId: 't-1', oldPath: '/tmp/a.md' as AbsoluteFilePath, newName: 'b.md' },
        ctx
      )
    ).resolves.toBe(true)

    expect(directoryTreeManager.activateTree).toHaveBeenCalledWith('t-1', 3)
    expect(directoryTreeManager.dispose).toHaveBeenCalledWith('t-1')
    expect(directoryTreeManager.rename).toHaveBeenCalledWith('t-1', '/tmp/a.md', 'b.md')
  })
})
