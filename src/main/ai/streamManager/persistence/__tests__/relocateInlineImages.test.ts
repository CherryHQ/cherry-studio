import type { CherryMessagePart, FileUIPart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }
}))

const { createInternalEntryMock, getPhysicalPathMock } = vi.hoisted(() => ({
  createInternalEntryMock: vi.fn(),
  getPhysicalPathMock: vi.fn()
}))
vi.mock('@application', () => ({
  application: {
    get: () => ({ createInternalEntry: createInternalEntryMock, getPhysicalPath: getPhysicalPathMock })
  }
}))

import { relocateInlineImages } from '../relocateInlineImages'

const INLINE_PNG = 'data:image/png;base64,iVBORw0KGgo='

const filePart = (url: string, mediaType = 'image/png'): CherryMessagePart =>
  ({ type: 'file', mediaType, url }) as unknown as CherryMessagePart

beforeEach(() => {
  vi.clearAllMocks()
  createInternalEntryMock.mockResolvedValue({ id: 'entry-1' })
  getPhysicalPathMock.mockReturnValue('/data/files/entry-1.png')
})

describe('relocateInlineImages', () => {
  it('moves a generated image out of the message envelope', async () => {
    const [part] = await relocateInlineImages([filePart(INLINE_PNG)])

    expect(createInternalEntryMock).toHaveBeenCalledWith({
      source: 'base64',
      data: INLINE_PNG,
      cleanupPolicy: 'delete_when_unreferenced'
    })
    expect(part).toMatchObject({ type: 'file', mediaType: 'image/png', url: 'file:///data/files/entry-1.png' })
    expect(readCherryMeta(part as FileUIPart)?.fileEntryId).toBe('entry-1')
  })

  it('leaves parts that are not inline images alone', async () => {
    const parts = [
      { type: 'text', text: 'hi' } as unknown as CherryMessagePart,
      filePart('file:///already/stored.png'),
      filePart('data:application/pdf;base64,JVBERi0=', 'application/pdf')
    ]

    await expect(relocateInlineImages(parts)).resolves.toBe(parts)
    expect(createInternalEntryMock).not.toHaveBeenCalled()
  })

  it('keeps the inline image when the file write fails rather than losing it', async () => {
    createInternalEntryMock.mockRejectedValue(new Error('disk full'))

    const [part] = await relocateInlineImages([filePart(INLINE_PNG)])

    expect(part).toMatchObject({ url: INLINE_PNG })
  })
})
