import { FILE_TYPE } from '@shared/types/file'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveKnowledgeFileData, resolveKnowledgeFileMetadataEntryData } from '../knowledgeFileEntry'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))

const presentFileMetadata = {
  kind: 'file' as const,
  type: FILE_TYPE.DOCUMENT,
  mime: 'application/pdf',
  size: 1024,
  createdAt: 0,
  modifiedAt: 0
}

describe('knowledgeFileEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.request.mockResolvedValue(presentFileMetadata)
  })

  it('creates knowledge file item data from an external path', async () => {
    await expect(resolveKnowledgeFileData('/tmp/report.pdf')).resolves.toEqual({
      source: '/tmp/report.pdf',
      path: '/tmp/report.pdf'
    })
    expect(mocks.request).toHaveBeenCalledWith('file.get_metadata', { kind: 'path', path: '/tmp/report.pdf' })
  })

  it('uses the FileMetadata path when resolving legacy selected file metadata', async () => {
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
      path: '/external/from-metadata.pdf'
    })
  })

  it('rejects blank paths before creating item data', async () => {
    await expect(resolveKnowledgeFileData('  ', 'report.pdf')).rejects.toThrow(
      'Failed to resolve a local path for "report.pdf"'
    )
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('rejects relative paths before creating item data', async () => {
    await expect(resolveKnowledgeFileData('docs/report.pdf', 'report.pdf')).rejects.toThrow(
      'Failed to resolve an absolute local path for "report.pdf"'
    )
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('rejects file urls before creating item data', async () => {
    await expect(resolveKnowledgeFileData('file:///tmp/report.pdf', 'report.pdf')).rejects.toThrow(
      'Failed to resolve an absolute local path for "report.pdf"'
    )
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('rejects an absolute path when the file is missing on disk', async () => {
    mocks.request.mockResolvedValue(null)

    await expect(resolveKnowledgeFileData('E:\\Documents\\moved.docx', 'source.docx')).rejects.toThrow(
      'Failed to read a local file for "source.docx"'
    )
    expect(mocks.request).toHaveBeenCalledWith('file.get_metadata', {
      kind: 'path',
      path: 'E:\\Documents\\moved.docx'
    })
  })
})
