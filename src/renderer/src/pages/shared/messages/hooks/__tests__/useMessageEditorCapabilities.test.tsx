import { FILE_TYPE, type FileMetadata } from '@renderer/types'
import { renderHook } from '@testing-library/react'
import type { DragEvent } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMessageEditorCapabilities } from '../useMessageEditorCapabilities'

const {
  mockUploadFiles,
  mockHandlePaste,
  mockRegisterHandler,
  mockSetLastFocusedComponent,
  mockUnregisterHandler,
  mockGetFilesFromDropEvent
} = vi.hoisted(() => ({
  mockUploadFiles: vi.fn(),
  mockHandlePaste: vi.fn(),
  mockRegisterHandler: vi.fn(),
  mockSetLastFocusedComponent: vi.fn(),
  mockUnregisterHandler: vi.fn(),
  mockGetFilesFromDropEvent: vi.fn()
}))

vi.mock('@renderer/services/FileManager', () => ({
  default: {
    uploadFiles: mockUploadFiles
  }
}))

vi.mock('@renderer/services/PasteService', () => ({
  default: {
    handlePaste: mockHandlePaste,
    registerHandler: mockRegisterHandler,
    setLastFocusedComponent: mockSetLastFocusedComponent,
    unregisterHandler: mockUnregisterHandler
  }
}))

vi.mock('@renderer/utils/input', () => ({
  getFilesFromDropEvent: mockGetFilesFromDropEvent
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('useMessageEditorCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUploadFiles.mockResolvedValue([])
    mockHandlePaste.mockResolvedValue(true)
    mockGetFilesFromDropEvent.mockResolvedValue([])
  })

  it('converts uploaded editor files to message file parts', async () => {
    mockUploadFiles.mockResolvedValue([
      {
        id: 'file-1',
        type: 'image',
        ext: '.png',
        path: '/tmp/image.png',
        origin_name: 'image.png',
        name: 'image.png'
      },
      {
        id: 'file-2',
        type: 'document',
        ext: '.pdf',
        path: '/tmp/doc.pdf',
        origin_name: '',
        name: 'doc.pdf'
      }
    ])

    const { result } = renderHook(() => useMessageEditorCapabilities())

    await expect(result.current.uploadEditorFiles?.([])).resolves.toEqual([
      {
        type: 'file',
        mediaType: 'image/png',
        url: 'file:///tmp/image.png',
        filename: 'image.png'
      },
      {
        type: 'file',
        mediaType: 'application/octet-stream',
        url: 'file:///tmp/doc.pdf',
        filename: 'doc.pdf'
      }
    ])
    expect(mockUploadFiles).toHaveBeenCalledWith([])
  })

  it('routes editor paste handling through the page-side paste service capability', async () => {
    const { result } = renderHook(() => useMessageEditorCapabilities())
    const addFiles = vi.fn()
    const pastedFile = createTextFile()
    const pasteEvent = new Event('paste') as ClipboardEvent

    await expect(
      result.current.handleEditorPaste?.({
        event: pasteEvent,
        extensions: ['.txt'],
        addFiles,
        pasteLongTextAsFile: true,
        pasteLongTextThreshold: 20
      })
    ).resolves.toBe(true)

    const setFiles = mockHandlePaste.mock.calls[0][2] as (updater: (files: FileMetadata[]) => FileMetadata[]) => void
    setFiles(() => [pastedFile])

    expect(addFiles).toHaveBeenCalledWith([pastedFile])
    expect(mockHandlePaste).toHaveBeenCalledWith(
      pasteEvent,
      ['.txt'],
      expect.any(Function),
      undefined,
      true,
      20,
      undefined,
      undefined,
      expect.any(Function)
    )
  })

  it('does not re-add pasted files when PasteService updater returns cumulative file list', async () => {
    const { result } = renderHook(() => useMessageEditorCapabilities())
    const addFiles = vi.fn()
    const pastedFile = createTextFile()
    const pasteEvent = new Event('paste') as ClipboardEvent

    await expect(
      result.current.handleEditorPaste?.({
        event: pasteEvent,
        extensions: ['.txt'],
        addFiles,
        pasteLongTextAsFile: true,
        pasteLongTextThreshold: 20
      })
    ).resolves.toBe(true)

    const updater = mockHandlePaste.mock.calls[0][2] as (updater: (files: FileMetadata[]) => FileMetadata[]) => void
    updater((prev) => {
      expect(prev).toEqual([])
      return [pastedFile]
    })
    updater((prev) => [...prev, pastedFile])

    expect(addFiles).toHaveBeenCalledTimes(1)
    expect(addFiles).toHaveBeenCalledWith([pastedFile])
  })

  it('binds and focuses editor paste target through PasteService', () => {
    const { result } = renderHook(() => useMessageEditorCapabilities())
    const handler = vi.fn()

    const cleanup = result.current.bindEditorPasteHandler?.(handler)
    result.current.focusEditorPasteTarget?.()
    cleanup?.()

    expect(mockRegisterHandler).toHaveBeenCalledWith('messageEditor', handler)
    expect(mockSetLastFocusedComponent).toHaveBeenCalledWith('messageEditor')
    expect(mockUnregisterHandler).toHaveBeenCalledWith('messageEditor')
  })

  it('routes dropped editor files through the page-side drop parser capability', async () => {
    const { result } = renderHook(() => useMessageEditorCapabilities())
    const event = { dataTransfer: { files: [] } } as unknown as DragEvent<HTMLDivElement>

    await result.current.getDroppedEditorFiles?.(event)

    expect(mockGetFilesFromDropEvent).toHaveBeenCalledWith(event)
  })
})

function createTextFile(): FileMetadata {
  return {
    id: 'file-1',
    type: FILE_TYPE.TEXT,
    ext: '.txt',
    path: '/tmp/paste.txt',
    origin_name: 'paste.txt',
    name: 'paste.txt',
    size: 10,
    created_at: '2026-01-01T00:00:00.000Z',
    count: 1
  }
}
