import { toast } from '@renderer/services/toast'
import { FILE_TYPE, type FileMetadata } from '@renderer/types/file'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { act, renderHook } from '@testing-library/react'
import type { TFunction } from 'i18next'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getSingleDroppedPathFromText, useFileDragDrop } from '../useFileDragDrop'

vi.mock('@renderer/services/toast', () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn()
  }
}))

const fileApi = {
  getMetadata: vi.fn(),
  get: vi.fn(),
  getPathForFile: vi.fn(),
  isTextFile: vi.fn()
}
const t = ((key: string) => key) as TFunction

function createFileMetadata(path: string): FileMetadata {
  return {
    id: 'file-1',
    name: path.split('/').pop() ?? 'note.md',
    origin_name: path.split('/').pop() ?? 'note.md',
    path,
    size: 12,
    ext: '.md',
    type: FILE_TYPE.TEXT,
    created_at: '',
    count: 1
  }
}

function createDropEvent(text: string, files: File[] = []) {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      files,
      items: [],
      getData: vi.fn((type: string) => (type === 'text' ? text : ''))
    }
  } as unknown as React.DragEvent<HTMLDivElement>
}

describe('useFileDragDrop', () => {
  beforeEach(() => {
    fileApi.getMetadata.mockReset()
    fileApi.get.mockReset()
    fileApi.getPathForFile.mockReset()
    fileApi.isTextFile.mockReset()
    vi.mocked(toast.info).mockReset()
    vi.mocked(toast.error).mockReset()
    Object.defineProperty(window, 'api', {
      value: {
        file: fileApi
      },
      configurable: true
    })
  })

  it('extracts a single local path from dropped text', () => {
    expect(getSingleDroppedPathFromText('  /Users/jd/Notes/a.md  ')).toBe('/Users/jd/Notes/a.md')
    expect(getSingleDroppedPathFromText('"file:///Users/jd/Notes/a.md"')).toBe('/Users/jd/Notes/a.md')
    expect(getSingleDroppedPathFromText('plain text')).toBeNull()
    expect(getSingleDroppedPathFromText('/tmp/a.md\n/tmp/b.md')).toBeNull()
  })

  it('turns a dropped file path text into a composer attachment', async () => {
    const path = '/Users/jd/Notes/a.md'
    const file = createFileMetadata(path)
    let files: ComposerAttachment[] = []
    const setFiles = vi.fn((updater: (prevFiles: ComposerAttachment[]) => ComposerAttachment[]) => {
      files = updater(files)
    })
    const onTextDropped = vi.fn()
    const onFolderPathDropped = vi.fn()
    fileApi.getMetadata.mockResolvedValue({
      kind: 'file',
      size: 12,
      createdAt: 1,
      modifiedAt: 1,
      mime: 'text/markdown'
    })
    fileApi.get.mockResolvedValue(file)

    const { result } = renderHook(() =>
      useFileDragDrop({
        supportedExts: ['.md'],
        setFiles,
        onTextDropped,
        onFolderPathDropped,
        enabled: true,
        t
      })
    )

    await act(async () => {
      await result.current.handleDrop?.(createDropEvent(path))
    })

    expect(fileApi.getMetadata).toHaveBeenCalledWith({ kind: 'path', path })
    expect(fileApi.get).toHaveBeenCalledWith(path)
    expect(setFiles).toHaveBeenCalledTimes(1)
    expect(files).toEqual([expect.objectContaining({ path, origin_name: 'a.md' })])
    expect(onTextDropped).not.toHaveBeenCalled()
    expect(onFolderPathDropped).not.toHaveBeenCalled()
  })

  it('prefers DataTransfer files over a text path', async () => {
    const path = '/Users/jd/Finder/finder.md'
    const file = createFileMetadata(path)
    let files: ComposerAttachment[] = []
    const setFiles = vi.fn((updater: (prevFiles: ComposerAttachment[]) => ComposerAttachment[]) => {
      files = updater(files)
    })
    const onTextDropped = vi.fn()
    const onFolderPathDropped = vi.fn()
    const nativeFile = { name: 'finder.md' } as File
    fileApi.getPathForFile.mockReturnValue(path)
    fileApi.get.mockResolvedValue(file)
    fileApi.getMetadata.mockResolvedValue({
      kind: 'file',
      size: 12,
      createdAt: 1,
      modifiedAt: 1,
      mime: 'text/markdown'
    })

    const { result } = renderHook(() =>
      useFileDragDrop({
        supportedExts: ['.md'],
        setFiles,
        onTextDropped,
        onFolderPathDropped,
        enabled: true,
        t
      })
    )

    await act(async () => {
      await result.current.handleDrop?.(createDropEvent('/Users/jd/Notes', [nativeFile]))
    })

    expect(fileApi.getPathForFile).toHaveBeenCalledWith(nativeFile)
    expect(fileApi.getMetadata).toHaveBeenCalledWith({ kind: 'path', path })
    expect(files).toEqual([expect.objectContaining({ path, origin_name: 'finder.md' })])
    expect(onTextDropped).not.toHaveBeenCalled()
    expect(onFolderPathDropped).not.toHaveBeenCalled()
  })

  it('turns a DataTransfer directory into a folder token callback', async () => {
    const path = '/Users/jd/Notes/Project Notes'
    const directory = createFileMetadata(path)
    const setFiles = vi.fn()
    const onTextDropped = vi.fn()
    const onFolderPathDropped = vi.fn()
    const nativeFile = { name: 'Project Notes' } as File
    fileApi.getPathForFile.mockReturnValue(path)
    fileApi.get.mockResolvedValue(directory)
    fileApi.getMetadata.mockResolvedValue({ kind: 'directory', size: 1, createdAt: 1, modifiedAt: 1 })

    const { result } = renderHook(() =>
      useFileDragDrop({
        supportedExts: ['.md'],
        setFiles,
        onTextDropped,
        onFolderPathDropped,
        enabled: true,
        t
      })
    )

    await act(async () => {
      await result.current.handleDrop?.(createDropEvent('/Users/jd/Notes/Project Notes', [nativeFile]))
    })

    expect(fileApi.getPathForFile).toHaveBeenCalledWith(nativeFile)
    expect(fileApi.getMetadata).toHaveBeenCalledWith({ kind: 'path', path })
    expect(onFolderPathDropped).toHaveBeenCalledWith(path)
    expect(setFiles).not.toHaveBeenCalled()
    expect(onTextDropped).not.toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('turns a dropped directory path text into a folder token callback', async () => {
    const path = '/Users/jd/Notes'
    const setFiles = vi.fn()
    const onTextDropped = vi.fn()
    const onFolderPathDropped = vi.fn()
    fileApi.getMetadata.mockResolvedValue({ kind: 'directory', size: 1, createdAt: 1, modifiedAt: 1 })

    const { result } = renderHook(() =>
      useFileDragDrop({
        supportedExts: ['.md'],
        setFiles,
        onTextDropped,
        onFolderPathDropped,
        enabled: true,
        t
      })
    )

    await act(async () => {
      await result.current.handleDrop?.(createDropEvent(path))
    })

    expect(onFolderPathDropped).toHaveBeenCalledWith(path)
    expect(setFiles).not.toHaveBeenCalled()
    expect(onTextDropped).not.toHaveBeenCalled()
  })

  it('keeps non-path dropped text as text', async () => {
    const setFiles = vi.fn()
    const onTextDropped = vi.fn()
    const onFolderPathDropped = vi.fn()

    const { result } = renderHook(() =>
      useFileDragDrop({
        supportedExts: ['.md'],
        setFiles,
        onTextDropped,
        onFolderPathDropped,
        enabled: true,
        t
      })
    )

    await act(async () => {
      await result.current.handleDrop?.(createDropEvent('plain text'))
    })

    expect(fileApi.getMetadata).not.toHaveBeenCalled()
    expect(onTextDropped).toHaveBeenCalledWith('plain text')
    expect(onFolderPathDropped).not.toHaveBeenCalled()
    expect(setFiles).not.toHaveBeenCalled()
  })

  it('keeps missing path text as text when metadata lookup fails', async () => {
    const path = '/Users/jd/Missing/a.md'
    const setFiles = vi.fn()
    const onTextDropped = vi.fn()
    const onFolderPathDropped = vi.fn()
    fileApi.getMetadata.mockRejectedValue(new Error('missing'))

    const { result } = renderHook(() =>
      useFileDragDrop({
        supportedExts: ['.md'],
        setFiles,
        onTextDropped,
        onFolderPathDropped,
        enabled: true,
        t
      })
    )

    await act(async () => {
      await result.current.handleDrop?.(createDropEvent(path))
    })

    expect(onTextDropped).toHaveBeenCalledWith(path)
    expect(onFolderPathDropped).not.toHaveBeenCalled()
    expect(setFiles).not.toHaveBeenCalled()
  })
})
