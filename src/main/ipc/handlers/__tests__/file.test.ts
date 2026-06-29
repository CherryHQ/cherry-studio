import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock, getMetadataByPathMock, safeOpenMock, showPathInFolderMock } = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  getMetadataByPathMock: vi.fn(),
  safeOpenMock: vi.fn(),
  showPathInFolderMock: vi.fn()
}))
vi.mock('@application', () => ({ application: { get: appGetMock } }))
vi.mock('@main/services/file', () => ({
  safeOpen: safeOpenMock,
  showInFolder: showPathInFolderMock
}))
vi.mock('@main/services/file/utils/metadata', () => ({ getMetadataByPath: getMetadataByPathMock }))

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
    fileManager.getPhysicalPath.mockResolvedValueOnce('/tmp/a.png').mockRejectedValueOnce(new Error('ENOENT'))

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
