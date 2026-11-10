import { MockMainFileManagerExport } from '@test-mocks/main/FileManager'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CherryMessagePart, FileUIPart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'

const { createInternalEntry: createInternalEntryMock, getUrl: getUrlMock } = MockMainFileManagerExport.fileManager

const { relocateInlineImages } = await import('../relocateInlineImages')

const INLINE_PNG = 'data:image/png;base64,iVBORw0KGgo='
const FILE_URL = 'file:///data/files/entry-1.png' as const
const filePart = (url: string, mediaType = 'image/png', filename?: string): CherryMessagePart =>
  ({ type: 'file', mediaType, url, ...(filename && { filename }) }) as unknown as CherryMessagePart

beforeEach(() => {
  vi.clearAllMocks()
  createInternalEntryMock.mockResolvedValue({ id: 'entry-1' })
  getUrlMock.mockReturnValue(FILE_URL)
})

describe('relocateInlineImages', () => {
  it('stores a generated image and links it back to the FileEntry', async () => {
    const [part] = await relocateInlineImages([filePart(INLINE_PNG)])

    expect(createInternalEntryMock).toHaveBeenCalledWith({
      source: 'base64',
      data: INLINE_PNG,
      cleanupPolicy: 'delete_when_unreferenced',
      name: 'Generated image'
    })
    expect(part).toMatchObject({ type: 'file', mediaType: 'image/png', url: FILE_URL })
    expect(readCherryMeta(part as FileUIPart)?.fileEntryId).toBe('entry-1')
  })

  it('keeps the generated filename instead of the FileManager paste default', async () => {
    await relocateInlineImages([filePart(INLINE_PNG, 'image/png', 'fox.png')])

    expect(createInternalEntryMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'fox' }))
  })

  it('leaves stored files and non-image data parts on their existing paths', async () => {
    const parts = [
      { type: 'text', text: 'hi' } as unknown as CherryMessagePart,
      filePart('file:///already/stored.png'),
      filePart('data:application/pdf;base64,JVBERi0=', 'application/pdf')
    ]

    await expect(relocateInlineImages(parts)).resolves.toBe(parts)
    expect(createInternalEntryMock).not.toHaveBeenCalled()
  })

  it('keeps the generated image inline when storage fails', async () => {
    createInternalEntryMock.mockRejectedValue(new Error('disk full'))

    const [part] = await relocateInlineImages([filePart(INLINE_PNG)])

    expect(part).toMatchObject({ url: INLINE_PNG })
  })
})
