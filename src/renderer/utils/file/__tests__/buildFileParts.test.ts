import { FILE_TYPE } from '@renderer/types'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildFilePartsForAttachments } from '../buildFileParts'

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
          getPhysicalPath: vi.fn(async () => '/p/fe-1.png'),
          getMetadata: vi.fn(async () => ({ kind: 'file', mime: 'image/png', size: 1, mtime: 0 }))
        }
      }
    })
  })

  it('creates the FileEntry at send time and emits a file:// url + fileEntryId + the disk MIME', async () => {
    const [part] = await buildFilePartsForAttachments([attachment()])

    expect(window.api.file.createInternalEntry).toHaveBeenCalledWith({ source: 'path', path: '/tmp/image.png' })
    expect(window.api.file.getPhysicalPath).toHaveBeenCalledWith({ id: 'fe-1' })
    expect(window.api.file.getMetadata).toHaveBeenCalledWith({ kind: 'entry', entryId: 'fe-1' })
    expect(part).toEqual({
      type: 'file',
      url: 'file:///p/fe-1.png',
      mediaType: 'image/png',
      filename: 'image.png',
      providerMetadata: { cherry: { fileEntryId: 'fe-1' } }
    })
  })

  it('uses the real MIME from getMetadata for documents (not octet-stream)', async () => {
    vi.mocked(window.api.file.createInternalEntry).mockResolvedValueOnce({ id: 'fe-3', ext: 'pdf' } as never)
    vi.mocked(window.api.file.getPhysicalPath).mockResolvedValueOnce('/p/fe-3.pdf' as never)
    vi.mocked(window.api.file.getMetadata).mockResolvedValueOnce({
      kind: 'file',
      mime: 'application/pdf',
      size: 1,
      mtime: 0
    } as never)

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
})
