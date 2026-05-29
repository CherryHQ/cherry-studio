import { FileEntrySchema } from '@shared/data/types/file'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveKnowledgeFileEntryData, resolveKnowledgeFileMetadataEntryData } from '../knowledgeFileEntry'

const mockEnsureExternalEntry = vi.fn()

const createExternalEntry = (path: string) =>
  FileEntrySchema.parse({
    id: '019606a0-0000-7000-8000-000000000001',
    name: 'report',
    ext: 'pdf',
    origin: 'external',
    externalPath: path,
    createdAt: 1776948000000,
    updatedAt: 1776948000000
  })

describe('knowledgeFileEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          ensureExternalEntry: mockEnsureExternalEntry
        }
      }
    })
  })

  it('creates knowledge file item data from an external path', async () => {
    const entry = createExternalEntry('/tmp/report.pdf')
    mockEnsureExternalEntry.mockResolvedValueOnce(entry)

    await expect(resolveKnowledgeFileEntryData('/tmp/report.pdf')).resolves.toEqual({
      source: '/tmp/report.pdf',
      fileEntryId: entry.id
    })
    expect(mockEnsureExternalEntry).toHaveBeenCalledWith({ externalPath: '/tmp/report.pdf' })
  })

  it('uses the FileMetadata path when resolving legacy selected file metadata', async () => {
    const entry = createExternalEntry('/external/from-metadata.pdf')
    mockEnsureExternalEntry.mockResolvedValueOnce(entry)

    await expect(
      resolveKnowledgeFileMetadataEntryData({
        id: 'legacy-file',
        name: 'storage-name.pdf',
        origin_name: 'Original Name.pdf',
        path: '/external/from-metadata.pdf',
        size: 1024,
        ext: '.pdf',
        type: 'document',
        created_at: '2026-04-21T10:00:00+08:00',
        count: 1
      })
    ).resolves.toEqual({
      source: '/external/from-metadata.pdf',
      fileEntryId: entry.id
    })
    expect(mockEnsureExternalEntry).toHaveBeenCalledWith({ externalPath: '/external/from-metadata.pdf' })
  })

  it('rejects blank paths before creating a file entry', async () => {
    await expect(resolveKnowledgeFileEntryData('  ', 'report.pdf')).rejects.toThrow(
      'Failed to resolve a local path for "report.pdf"'
    )
    expect(mockEnsureExternalEntry).not.toHaveBeenCalled()
  })

  it('rejects relative paths before creating a file entry', async () => {
    await expect(resolveKnowledgeFileEntryData('docs/report.pdf', 'report.pdf')).rejects.toThrow(
      'Failed to resolve an absolute local path for "report.pdf"'
    )
    expect(mockEnsureExternalEntry).not.toHaveBeenCalled()
  })

  it('rejects file urls before creating a file entry', async () => {
    await expect(resolveKnowledgeFileEntryData('file:///tmp/report.pdf', 'report.pdf')).rejects.toThrow(
      'Failed to resolve an absolute local path for "report.pdf"'
    )
    expect(mockEnsureExternalEntry).not.toHaveBeenCalled()
  })
})
