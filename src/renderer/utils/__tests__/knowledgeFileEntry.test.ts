import { beforeEach, describe, expect, it, vi } from 'vitest'

import { IpcError, IpcErrorCode } from '@shared/ipc/errors/IpcError'
import { FILE_TYPE } from '@shared/types/file'

import {
  KnowledgeFileNotAFileError,
  MissingKnowledgeFileError,
  resolveFileEntryDataFromFile,
  resolveKnowledgeFileBatch,
  resolveKnowledgeFileData,
  resolveKnowledgeFileMetadataEntryData,
  selectKnowledgeFileBatchOutcome
} from '../knowledgeFileEntry'

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

    await expect(resolveKnowledgeFileData('E:\\Documents\\moved.docx', 'source.docx')).rejects.toSatisfy((error) => {
      return (
        error instanceof MissingKnowledgeFileError &&
        error.path === 'E:\\Documents\\moved.docx' &&
        error.message.includes('E:\\Documents\\moved.docx')
      )
    })
    expect(mocks.request).toHaveBeenCalledWith('file.get_metadata', {
      kind: 'path',
      path: 'E:\\Documents\\moved.docx'
    })
  })

  it('treats undefined metadata as a skippable missing file', async () => {
    mocks.request.mockResolvedValue(undefined)

    await expect(resolveKnowledgeFileData('/tmp/report.pdf')).rejects.toBeInstanceOf(MissingKnowledgeFileError)
  })

  it('rejects a path that resolves to a directory instead of calling it missing', async () => {
    mocks.request.mockResolvedValue({
      kind: 'directory',
      size: 0,
      createdAt: 0,
      modifiedAt: 0
    })

    await expect(resolveKnowledgeFileData('/tmp/docs', 'docs')).rejects.toSatisfy((error) => {
      return (
        error instanceof KnowledgeFileNotAFileError &&
        error.path === '/tmp/docs' &&
        error.message.includes('/tmp/docs') &&
        !(error instanceof MissingKnowledgeFileError)
      )
    })
  })

  it('propagates IPC probe failures instead of treating them as a missing file', async () => {
    const probeError = new IpcError(IpcErrorCode.INTERNAL, 'IpcApi returned a malformed result')
    mocks.request.mockRejectedValue(probeError)

    await expect(resolveKnowledgeFileData('/tmp/report.pdf')).rejects.toBe(probeError)
  })

  it('rejects a File whose local path cannot be resolved with the knowledge error type', async () => {
    Object.assign(window, { api: { file: { getPathForFile: vi.fn(() => '') } } })

    await expect(resolveFileEntryDataFromFile(new File(['x'], 'notes.pdf'))).rejects.toThrow(
      'Failed to resolve a local path for "notes.pdf"'
    )
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('settles a mixed batch by skipping missing files and keeping present ones', async () => {
    mocks.request.mockImplementation(async (_route: string, handle?: { path?: string }) =>
      handle?.path?.includes('missing') ? null : presentFileMetadata
    )

    const files = [
      {
        id: 'ok',
        name: 'ok.pdf',
        origin_name: 'ok.pdf',
        path: '/tmp/ok.pdf',
        size: 1,
        ext: '.pdf',
        type: 'document' as const,
        created_at: '2026-05-27T00:00:00.000Z',
        count: 1
      },
      {
        id: 'missing',
        name: 'missing.pdf',
        origin_name: 'missing.pdf',
        path: '/tmp/missing.pdf',
        size: 1,
        ext: '.pdf',
        type: 'document' as const,
        created_at: '2026-05-27T00:00:00.000Z',
        count: 1
      }
    ]

    const batch = await resolveKnowledgeFileBatch(files, resolveKnowledgeFileMetadataEntryData, (file) => file.name)
    const outcome = selectKnowledgeFileBatchOutcome(batch)

    expect(outcome.fatal).toBeUndefined()
    expect(outcome.resolved).toEqual([{ source: '/tmp/ok.pdf', path: '/tmp/ok.pdf' }])
    expect(outcome.skipped).toHaveLength(1)
    expect(outcome.skipped[0]?.error).toBeInstanceOf(MissingKnowledgeFileError)
  })

  it('keeps a malformed entry skippable so a sibling file can still be saved', async () => {
    const files = [
      {
        id: 'ok',
        name: 'ok.pdf',
        origin_name: 'ok.pdf',
        path: '/tmp/ok.pdf',
        size: 1,
        ext: '.pdf',
        type: 'document' as const,
        created_at: '2026-05-27T00:00:00.000Z',
        count: 1
      },
      null
    ]

    const batch = await resolveKnowledgeFileBatch(
      files,
      (file) => resolveKnowledgeFileMetadataEntryData(file as (typeof files)[0] & object),
      (file) => file?.name
    )
    const outcome = selectKnowledgeFileBatchOutcome(batch)

    expect(outcome.fatal).toBeUndefined()
    expect(outcome.resolved).toEqual([{ source: '/tmp/ok.pdf', path: '/tmp/ok.pdf' }])
    expect(outcome.skipped[0]?.error).toBeInstanceOf(TypeError)
  })

  it('treats a transport failure as fatal even when a sibling file resolved', async () => {
    const probeError = new IpcError(IpcErrorCode.INTERNAL, 'IpcApi returned a malformed result')
    mocks.request.mockImplementation(async (_route: string, handle?: { path?: string }) => {
      if (handle?.path?.includes('probe')) {
        throw probeError
      }
      return presentFileMetadata
    })

    const files = [
      {
        id: 'ok',
        name: 'ok.pdf',
        origin_name: 'ok.pdf',
        path: '/tmp/ok.pdf',
        size: 1,
        ext: '.pdf',
        type: 'document' as const,
        created_at: '2026-05-27T00:00:00.000Z',
        count: 1
      },
      {
        id: 'probe',
        name: 'probe.pdf',
        origin_name: 'probe.pdf',
        path: '/tmp/probe.pdf',
        size: 1,
        ext: '.pdf',
        type: 'document' as const,
        created_at: '2026-05-27T00:00:00.000Z',
        count: 1
      }
    ]

    const batch = await resolveKnowledgeFileBatch(files, resolveKnowledgeFileMetadataEntryData, (file) => file.name)
    const outcome = selectKnowledgeFileBatchOutcome(batch)

    expect(outcome.fatal).toBe(probeError)
    expect(outcome.resolved).toEqual([])
    expect(outcome.skipped).toEqual([])
  })
})
