import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'
import { FILE_TYPE, type FileType } from '@renderer/types/file'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { useMediaPreAnalysis } from '../useMediaPreAnalysis'

const prepare = vi.hoisted(() => vi.fn())

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (route: string, input: unknown) => {
      if (route === 'file_processing.media.prepare') return prepare(input)
      throw new Error(`Unexpected route ${route}`)
    }
  }
}))

function attachment(id: string, type: FileType, path?: string): ComposerAttachment {
  return {
    fileTokenSourceId: id,
    name: id,
    type,
    ...(path && { path: AbsoluteFilePathSchema.parse(path) })
  } as ComposerAttachment
}

describe('useMediaPreAnalysis', () => {
  beforeEach(() => {
    MockCacheUtils.resetMocks()
    prepare.mockReset().mockResolvedValue(undefined)
  })

  it('starts one pre-analysis per newly attached audio or video file', async () => {
    const video = attachment('file-token-video', FILE_TYPE.VIDEO, '/clips/talk.mp4')
    const { rerender } = renderHook(({ files }) => useMediaPreAnalysis(files), {
      initialProps: { files: [video] }
    })

    const audio = attachment('file-token-audio', FILE_TYPE.AUDIO, '/clips/memo.m4a')
    rerender({ files: [video, audio] })
    rerender({ files: [video, audio] })

    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(2))
    expect(prepare.mock.calls.map(([input]) => input.path)).toEqual(['/clips/talk.mp4', '/clips/memo.m4a'])
  })

  it('leaves images, documents and path-less attachments alone', () => {
    renderHook(() =>
      useMediaPreAnalysis([
        attachment('file-token-image', FILE_TYPE.IMAGE, '/shots/a.png'),
        attachment('file-token-doc', FILE_TYPE.DOCUMENT, '/docs/a.pdf'),
        attachment('file-token-edited', FILE_TYPE.VIDEO)
      ])
    )

    expect(prepare).not.toHaveBeenCalled()
  })

  it('marks the attachment as analyzing until its pass ends, even when it fails', async () => {
    let finish!: (error: Error) => void
    prepare.mockReturnValue(new Promise((_, reject) => (finish = reject)))
    const video = attachment('file-token-video', FILE_TYPE.VIDEO, '/clips/talk.mp4')

    renderHook(() => useMediaPreAnalysis([video]))
    expect(cacheService.get('chat.composer.media_preparing.file-token-video')).toBe(true)

    finish(new Error('ffmpeg missing'))
    await waitFor(() => expect(cacheService.get('chat.composer.media_preparing.file-token-video')).toBe(false))
  })
})
