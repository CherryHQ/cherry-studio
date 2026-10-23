import { act, renderHook } from '@testing-library/react'
import type { TFunction } from 'i18next'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useFileDragDrop } from '@renderer/components/composer/paste/useFileDragDrop'
import { toast } from '@renderer/services/toast'
import { FILE_TYPE, type FileMetadata } from '@renderer/types/file'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { MODEL_CAPABILITY, type Model } from '@shared/data/types/model'

import { useComposerFileCapabilities } from '../useComposerFileCapabilities'

const textModel = (id: string) => ({ id, capabilities: [] }) as unknown as Model
const capableModel = (id: string, capability: string) => ({ id, capabilities: [capability] }) as unknown as Model
const t = ((key: string) => key) as TFunction

function metadata(path: string): FileMetadata {
  const name = path.split('/').pop() ?? 'file'
  const ext = name.includes('.') ? `.${name.split('.').pop()}` : ''
  return {
    id: path,
    name,
    origin_name: name,
    path,
    size: 128,
    ext,
    type: FILE_TYPE.OTHER,
    created_at: '',
    count: 1
  }
}

function dropEvent(files: File[]) {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      files,
      items: [],
      getData: vi.fn(() => '')
    }
  } as unknown as React.DragEvent<HTMLDivElement>
}

async function upload(supportedExts: string[], paths: string[]) {
  const filesByPath = new Map(paths.map((path) => [path, metadata(path)]))
  const nativeFiles = paths.map((path) => ({ name: path.split('/').pop() ?? path }) as File)
  vi.mocked(window.api.file.getPathForFile).mockImplementation((file: File) => {
    return paths.find((path) => path.endsWith(`/${file.name}`)) ?? ''
  })
  vi.mocked(window.api.file.get).mockImplementation(async (path: string) => filesByPath.get(path) ?? null)

  let attached: ComposerAttachment[] = []
  const { result } = renderHook(() =>
    useFileDragDrop({
      supportedExts,
      setFiles: (updater) => {
        attached = updater(attached)
      },
      enabled: true,
      t
    })
  )

  await act(async () => {
    await result.current.handleDrop?.(dropEvent(nativeFiles))
  })

  return attached
}

describe('chat media upload', () => {
  beforeEach(() => {
    Object.assign(window.api.file, {
      get: vi.fn(),
      getPathForFile: vi.fn()
    })
    vi.mocked(window.api.ipcApi.request).mockReset()
    vi.mocked(window.api.ipcApi.request).mockResolvedValue({
      ok: true,
      data: { kind: 'file', type: 'other' }
    })
  })

  it('accepts a dropped audio, video, and WebM file for a text-only chat model', async () => {
    const { result } = renderHook(() =>
      useComposerFileCapabilities({ models: [], fallbackModel: textModel('text-only') })
    )
    const paths = ['/Users/jd/Media/clip.mp3', '/Users/jd/Media/clip.mp4', '/Users/jd/Media/clip.webm']

    const attached = await upload(result.current.supportedExts, paths)

    expect(attached.map((file) => file.path)).toEqual(paths)
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('accepts a dropped audio and video file when mentioned models are mixed', async () => {
    const { result } = renderHook(() =>
      useComposerFileCapabilities({
        models: [
          capableModel('audio', MODEL_CAPABILITY.AUDIO_RECOGNITION),
          textModel('text'),
          capableModel('video', MODEL_CAPABILITY.VIDEO_RECOGNITION)
        ],
        fallbackModel: undefined
      })
    )

    const attached = await upload(result.current.supportedExts, [
      '/Users/jd/Media/clip.mp3',
      '/Users/jd/Media/clip.mp4'
    ])

    expect(attached.map((file) => file.origin_name)).toEqual(['clip.mp3', 'clip.mp4'])
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('still rejects an archive dropped into chat', async () => {
    const { result } = renderHook(() =>
      useComposerFileCapabilities({ models: [], fallbackModel: textModel('text-only') })
    )

    const attached = await upload(result.current.supportedExts, ['/Users/jd/Media/notes.zip'])

    expect(attached).toEqual([])
    expect(toast.info).toHaveBeenCalledWith('chat.input.file_not_supported_count')
  })

  it('keeps agent uploads closed when no model is active', async () => {
    const { result } = renderHook(() => useComposerFileCapabilities(undefined))

    const attached = await upload(result.current.supportedExts, ['/Users/jd/Media/clip.mp3'])

    expect(attached).toEqual([])
    expect(toast.info).toHaveBeenCalledWith('chat.input.file_not_supported_count')
  })

  it('keeps every file type attachable for an active agent model', async () => {
    const { result } = renderHook(() => useComposerFileCapabilities(textModel('agent')))

    const attached = await upload(result.current.supportedExts, [
      '/Users/jd/Media/notes.zip',
      '/Users/jd/Media/clip.webm',
      '/Users/jd/Media/clip.mp3'
    ])

    expect(attached.map((file) => file.origin_name)).toEqual(['notes.zip', 'clip.webm', 'clip.mp3'])
    expect(toast.info).not.toHaveBeenCalled()
  })
})
