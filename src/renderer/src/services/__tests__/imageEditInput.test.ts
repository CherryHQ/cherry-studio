import type { ImageMessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getEditableImageInput } from '../imageEditInput'

const mocks = vi.hoisted(() => ({
  base64Image: vi.fn()
}))

describe('getEditableImageInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('window', {
      api: {
        file: {
          base64Image: mocks.base64Image
        }
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const createImageBlock = (overrides: Partial<ImageMessageBlock> = {}): ImageMessageBlock => ({
    id: 'block-1',
    messageId: 'msg-1',
    type: MessageBlockType.IMAGE,
    createdAt: new Date().toISOString(),
    status: MessageBlockStatus.SUCCESS,
    ...overrides
  })

  it('loads a generated local file back as a real data URL', async () => {
    mocks.base64Image.mockResolvedValue({
      mime: 'image/png',
      base64: 'aGVsbG8=',
      data: 'data:image/png;base64,aGVsbG8='
    })

    const result = await getEditableImageInput(
      createImageBlock({
        file: {
          id: 'file-1',
          name: 'file-1.png',
          origin_name: 'file-1.png',
          path: '/tmp/file-1.png',
          size: 5,
          ext: '.png',
          type: 'image',
          created_at: new Date().toISOString(),
          count: 1
        }
      })
    )

    expect(mocks.base64Image).toHaveBeenCalledWith('file-1.png')
    expect(result).toBe('data:image/png;base64,aGVsbG8=')
  })

  it('normalizes legacy ext values without a leading dot', async () => {
    mocks.base64Image.mockResolvedValue({
      mime: 'image/png',
      base64: 'aGVsbG8=',
      data: 'data:image/png;base64,aGVsbG8='
    })

    await getEditableImageInput(
      createImageBlock({
        file: {
          id: 'file-2',
          name: 'file-2.png',
          origin_name: 'file-2.png',
          path: '/tmp/file-2.png',
          size: 5,
          ext: 'png',
          type: 'image',
          created_at: new Date().toISOString(),
          count: 1
        }
      })
    )

    expect(mocks.base64Image).toHaveBeenCalledWith('file-2.png')
  })

  it('passes through remote or data URLs unchanged', async () => {
    const result = await getEditableImageInput(
      createImageBlock({
        url: 'https://example.com/image.png'
      })
    )

    expect(mocks.base64Image).not.toHaveBeenCalled()
    expect(result).toBe('https://example.com/image.png')
  })
})
