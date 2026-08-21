import type { FileUIPart } from '@shared/data/types/message'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ materializeNativeFilePart: vi.fn() }))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ warn: vi.fn() }) }
}))
vi.mock('@main/ai/messages/fileProcessor', () => ({ materializeNativeFilePart: mocks.materializeNativeFilePart }))

import { buildDshUserContentBlocks } from '../dshUserContent'

function filePart(overrides: Partial<FileUIPart> = {}): FileUIPart {
  return {
    type: 'file',
    url: 'file:///tmp/screenshot.png',
    mediaType: 'image/png',
    filename: 'screenshot.png',
    ...overrides
  } as FileUIPart
}

function message(parts: unknown[]) {
  return { id: 'message-1', data: { parts } } as never
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buildDshUserContentBlocks', () => {
  it('materializes supported images as native blocks and keeps text attachments as paths', async () => {
    const image = filePart()
    mocks.materializeNativeFilePart.mockResolvedValue({
      ...image,
      url: 'data:image/png;base64,AAAA'
    })

    await expect(
      buildDshUserContentBlocks(
        message([
          { type: 'text', text: 'Inspect both files.' },
          image,
          filePart({ filename: 'notes.txt', mediaType: 'text/plain', url: 'file:///tmp/notes.txt' })
        ])
      )
    ).resolves.toEqual([
      {
        type: 'text',
        text: 'Inspect both files.\n\nAttached files (read them with your tools using these absolute paths):\n- /tmp/notes.txt'
      },
      { type: 'image', mediaType: 'image/png', data: 'AAAA', name: 'screenshot.png' }
    ])
    expect(mocks.materializeNativeFilePart).toHaveBeenCalledTimes(1)
  })

  it('does not materialize images for a text-only model and preserves their path', async () => {
    const image = filePart()

    await expect(
      buildDshUserContentBlocks(message([{ type: 'text', text: 'Read this.' }, image]), { includeImages: false })
    ).resolves.toEqual([
      {
        type: 'text',
        text: 'Read this.\n\nAttached files (read them with your tools using these absolute paths):\n- /tmp/screenshot.png'
      }
    ])
    expect(mocks.materializeNativeFilePart).not.toHaveBeenCalled()
  })

  it('normalizes the jpg alias exposed by legacy file metadata', async () => {
    const image = filePart({ mediaType: 'image/jpg' })
    mocks.materializeNativeFilePart.mockResolvedValue({ ...image, url: 'data:image/jpg;base64,BBBB' })

    await expect(buildDshUserContentBlocks(message([image]))).resolves.toEqual([
      { type: 'text', text: '' },
      { type: 'image', mediaType: 'image/jpeg', data: 'BBBB', name: 'screenshot.png' }
    ])
  })
})
