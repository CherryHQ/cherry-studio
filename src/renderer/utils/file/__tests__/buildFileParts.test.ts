import { FILE_TYPE } from '@renderer/types/file'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildFilePartsForAttachments } from '../buildFileParts'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))

const attachment = (overrides: Partial<ComposerAttachment> = {}): ComposerAttachment => ({
  fileTokenSourceId: 'source-1',
  path: '/tmp/image.png',
  name: 'image.png',
  origin_name: 'image.png',
  ext: '.png',
  size: 1,
  type: FILE_TYPE.IMAGE,
  ...overrides
})

describe('buildFilePartsForAttachments', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          createInternalEntry: vi.fn(async () => ({ id: 'fe-1', ext: 'png' })),
          getPhysicalPath: vi.fn(async () => '/p/fe-1.png')
        }
      }
    })
    mocks.request.mockReset()
    mocks.request.mockResolvedValue({ kind: 'file', mime: 'image/png', size: 1, mtime: 0 })
  })

  it('creates the FileEntry at send time and emits a file:// url + file identities + the disk MIME', async () => {
    const [part] = await buildFilePartsForAttachments([attachment()])

    expect(window.api.file.createInternalEntry).toHaveBeenCalledWith({ source: 'path', path: '/tmp/image.png' })
    expect(window.api.file.getPhysicalPath).toHaveBeenCalledWith({ id: 'fe-1' })
    expect(mocks.request).toHaveBeenCalledWith('file.get_metadata', { kind: 'path', path: '/p/fe-1.png' })
    expect(part).toEqual({
      type: 'file',
      url: 'file:///p/fe-1.png',
      mediaType: 'image/png',
      filename: 'image.png',
      providerMetadata: { cherry: { fileEntryId: 'fe-1', fileTokenSourceId: 'source-1' } }
    })
  })

  it('uses the real MIME from getMetadata for documents (not octet-stream)', async () => {
    vi.mocked(window.api.file.createInternalEntry).mockResolvedValueOnce({ id: 'fe-3', ext: 'pdf' } as never)
    vi.mocked(window.api.file.getPhysicalPath).mockResolvedValueOnce('/p/fe-3.pdf' as never)
    mocks.request.mockResolvedValueOnce({ kind: 'file', mime: 'application/pdf', size: 1, mtime: 0 })

    const [part] = await buildFilePartsForAttachments([
      attachment({
        path: '/tmp/report.pdf',
        name: 'report.pdf',
        origin_name: 'report.pdf',
        ext: '.pdf',
        type: FILE_TYPE.DOCUMENT
      })
    ])

    expect(part.mediaType).toBe('application/pdf')
    expect(part.url).toBe('file:///p/fe-3.pdf')
  })

  it('throws when metadata is unreadable (null) for the freshly created file', async () => {
    mocks.request.mockResolvedValueOnce(null)
    await expect(buildFilePartsForAttachments([attachment()])).rejects.toThrow(/Failed to read metadata/)
  })
})
