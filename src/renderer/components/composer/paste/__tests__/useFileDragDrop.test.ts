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
  get: vi.fn(),
  getPathForFile: vi.fn(),
  isDirectory: vi.fn(),
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
    fileApi.get.mockReset()
    fileApi.getPathForFile.mockReset()
    fileApi.isDirectory.mockReset()
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
    fileApi.isDirectory.mockResolvedValue(false)
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

    expect(fileApi.isDirectory).toHaveBeenCalledWith(path)
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
    fileApi.isDirectory.mockResolvedValue(false)

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
    expect(fileApi.isDirectory).toHaveBeenCalledWith(path)
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
    fileApi.isDirectory.mockResolvedValue(true)

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
    expect(fileApi.isDirectory).toHaveBeenCalledWith(path)
    expect(onFolderPathDropped).toHaveBeenCalledWith(path)
    expect(setFiles).not.toHaveBeenCalled()
    expect(onTextDropped).not.toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('handles mixed DataTransfer files and directories', async () => {
    const filePath = '/Users/jd/Finder/finder.md'
    const directoryPath = '/Users/jd/Notes/Project Notes'
    const file = createFileMetadata(filePath)
    const directory = createFileMetadata(directoryPath)
    let files: ComposerAttachment[] = []
    const setFiles = vi.fn((updater: (prevFiles: ComposerAttachment[]) => ComposerAttachment[]) => {
      files = updater(files)
    })
    const onTextDropped = vi.fn()
    const onFolderPathDropped = vi.fn()
    const nativeFile = { name: 'finder.md' } as File
    const nativeDirectory = { name: 'Project Notes' } as File
    fileApi.getPathForFile.mockImplementation((item: File) => (item === nativeFile ? filePath : directoryPath))
    fileApi.get.mockImplementation((path: string) => Promise.resolve(path === filePath ? file : directory))
    fileApi.isDirectory.mockImplementation((path: string) => Promise.resolve(path === directoryPath))

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
      await result.current.handleDrop?.(createDropEvent('/Users/jd/Notes', [nativeFile, nativeDirectory]))
    })

    expect(fileApi.isDirectory).toHaveBeenCalledWith(filePath)
    expect(fileApi.isDirectory).toHaveBeenCalledWith(directoryPath)
    expect(onFolderPathDropped).toHaveBeenCalledWith(directoryPath)
    expect(files).toEqual([expect.objectContaining({ path: filePath, origin_name: 'finder.md' })])
    expect(onTextDropped).not.toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('turns a dropped directory path text into a folder token callback', async () => {
    const path = '/Users/jd/Notes'
    const setFiles = vi.fn()
    const onTextDropped = vi.fn()
    const onFolderPathDropped = vi.fn()
    fileApi.isDirectory.mockResolvedValue(true)

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

    expect(fileApi.isDirectory).toHaveBeenCalledWith(path)
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

    expect(fileApi.isDirectory).not.toHaveBeenCalled()
    expect(onTextDropped).toHaveBeenCalledWith('plain text')
    expect(onFolderPathDropped).not.toHaveBeenCalled()
    expect(setFiles).not.toHaveBeenCalled()
  })

  it.each(['/Users/jd/Missing/a.md', '/api/v1/users'])(
    'keeps missing path-like text as text when the path does not resolve: %s',
    async (path) => {
      const setFiles = vi.fn()
      const onTextDropped = vi.fn()
      const onFolderPathDropped = vi.fn()
      fileApi.isDirectory.mockResolvedValue(false)
      fileApi.get.mockResolvedValue(null)

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

      expect(fileApi.isDirectory).toHaveBeenCalledWith(path)
      expect(fileApi.get).toHaveBeenCalledWith(path)
      expect(onTextDropped).toHaveBeenCalledWith(path)
      expect(onFolderPathDropped).not.toHaveBeenCalled()
      expect(setFiles).not.toHaveBeenCalled()
      expect(toast.info).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    }
  )

  it('shows the unsupported-file toast only after a dropped path resolves to a file', async () => {
    const path = '/Users/jd/Notes/archive.bin'
    const setFiles = vi.fn()
    const onTextDropped = vi.fn()
    const onFolderPathDropped = vi.fn()
    fileApi.isDirectory.mockResolvedValue(false)
    fileApi.get.mockResolvedValue({ ...createFileMetadata(path), ext: '.bin' })
    fileApi.isTextFile.mockResolvedValue(false)

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

    expect(fileApi.isDirectory).toHaveBeenCalledWith(path)
    expect(fileApi.get).toHaveBeenCalledWith(path)
    expect(toast.info).toHaveBeenCalledWith('chat.input.file_not_supported')
    expect(toast.error).not.toHaveBeenCalled()
    expect(onTextDropped).not.toHaveBeenCalled()
    expect(onFolderPathDropped).not.toHaveBeenCalled()
    expect(setFiles).not.toHaveBeenCalled()
  })
})
