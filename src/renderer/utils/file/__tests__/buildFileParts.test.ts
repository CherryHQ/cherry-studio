import { FILE_TYPE, type FileMetadata } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildFilePartsForAttachments } from '../buildFileParts'

const createInternalEntry = vi.fn()
const getPhysicalPath = vi.fn()

function createFile(overrides: Partial<FileMetadata> = {}): FileMetadata {
  return {
    id: 'file-1',
    name: 'voice.flac',
    origin_name: 'voice.flac',
    path: '/source/voice.flac',
    size: 4,
    ext: '.flac',
    type: FILE_TYPE.AUDIO,
    created_at: '2026-06-20T00:00:00.000Z',
    count: 1,
    ...overrides
  }
}

describe('buildFilePartsForAttachments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          createInternalEntry,
          getPhysicalPath
        }
      }
    })
  })

  it.each([
    ['.mp3', 'audio/mpeg'],
    ['.wav', 'audio/wav'],
    ['.ogg', 'audio/ogg'],
    ['.flac', 'audio/flac'],
    ['.aac', 'audio/aac'],
    ['.aiff', 'audio/aiff']
  ])('creates audio file parts with %s as %s', async (ext, mediaType) => {
    createInternalEntry.mockResolvedValueOnce({ id: 'entry-1', ext })
    getPhysicalPath.mockResolvedValueOnce(`/internal/voice${ext}`)

    const [part] = await buildFilePartsForAttachments([
      createFile({
        ext,
        name: `voice${ext}`,
        origin_name: `voice${ext}`,
        path: `/source/voice${ext}`
      })
    ])

    expect(part).toMatchObject({
      type: 'file',
      mediaType,
      url: `file:///internal/voice${ext}`,
      filename: `voice${ext}`
    })
    expect(part.providerMetadata?.cherry).toMatchObject({ fileEntryId: 'entry-1' })
  })
})
