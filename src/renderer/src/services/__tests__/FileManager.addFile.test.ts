/**
 * FileManager.addFile v2 cutover tests.
 *
 * Asserts that after the cutover:
 * - addFile routes to window.api.file.createInternalEntry (v2 IPC)
 * - addFile does NOT call the legacy window.api.file.upload
 * - addFile does NOT call db.files.add / db.files.update
 * - The returned value is a FileMetadata-shaped object
 *
 * Mirrors FileManager.uploadFile.test.ts — addFile and uploadFile share the
 * cutover path; both routes need explicit coverage so a future refactor that
 * diverges them can't quietly miss one side.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/databases', () => ({
  default: {
    files: {
      hook: vi.fn(),
      get: vi.fn().mockResolvedValue(null),
      add: vi.fn(),
      update: vi.fn()
    }
  }
}))

const mockEntry = {
  id: '018f1234-5678-7000-8000-000000000020',
  origin: 'internal' as const,
  name: 'add-file',
  ext: 'txt',
  size: 11,
  createdAt: 1700000000000,
  updatedAt: 1700000000000
}

const mockCreateInternalEntry = vi.fn().mockResolvedValue(mockEntry)
const mockGetPhysicalPath = vi.fn().mockResolvedValue('/userData/Data/Files/018f1234.txt')
const mockLegacyUpload = vi.fn()

vi.stubGlobal('api', {
  file: {
    createInternalEntry: mockCreateInternalEntry,
    getPhysicalPath: mockGetPhysicalPath,
    upload: mockLegacyUpload
  }
})

const FileManager = (await import('../FileManager')).default
const db = (await import('@renderer/databases')).default

describe('FileManager.addFile — v2 cutover', () => {
  beforeEach(() => {
    mockCreateInternalEntry.mockClear()
    mockGetPhysicalPath.mockClear()
    mockLegacyUpload.mockClear()
    vi.mocked(db.files.add).mockClear()
    vi.mocked(db.files.update).mockClear()
  })

  const makeFileMetadata = () => ({
    id: 'orig-id',
    name: 'add-file',
    origin_name: 'add-file.txt',
    path: '/Users/user/add-file.txt',
    size: 11,
    ext: '.txt',
    type: 'text' as const,
    created_at: new Date().toISOString(),
    count: 1
  })

  it('calls window.api.file.createInternalEntry (v2 IPC)', async () => {
    const file = makeFileMetadata()
    await FileManager.addFile(file)
    expect(mockCreateInternalEntry).toHaveBeenCalledOnce()
    expect(mockCreateInternalEntry).toHaveBeenCalledWith(expect.objectContaining({ source: 'path', path: file.path }))
  })

  it('does NOT call legacy window.api.file.upload', async () => {
    const file = makeFileMetadata()
    await FileManager.addFile(file)
    expect(mockLegacyUpload).not.toHaveBeenCalled()
  })

  it('does NOT touch db.files write path', async () => {
    const file = makeFileMetadata()
    await FileManager.addFile(file)
    expect(db.files.add).not.toHaveBeenCalled()
    expect(db.files.update).not.toHaveBeenCalled()
  })

  it('calls getPhysicalPath to resolve the stored path', async () => {
    const file = makeFileMetadata()
    await FileManager.addFile(file)
    expect(mockGetPhysicalPath).toHaveBeenCalledOnce()
    expect(mockGetPhysicalPath).toHaveBeenCalledWith({ id: mockEntry.id })
  })

  it('returns a FileMetadata-shaped object from toFileMetadata', async () => {
    const file = makeFileMetadata()
    const result = await FileManager.addFile(file)

    expect(result).toMatchObject({
      id: mockEntry.id,
      name: mockEntry.name,
      ext: '.txt',
      type: 'text',
      size: mockEntry.size,
      count: 1
    })
    expect(typeof result.created_at).toBe('string')
    expect(result.path).toBe('/userData/Data/Files/018f1234.txt')
  })
})
