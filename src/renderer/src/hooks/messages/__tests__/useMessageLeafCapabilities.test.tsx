import { FILE_TYPE, type FileMetadata } from '@renderer/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import { renderHook } from '@testing-library/react'
import type { DragEvent } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMessageLeafCapabilities } from '../useMessageLeafCapabilities'

const {
  mockUseExternalApps,
  mockPreview,
  mockUploadFiles,
  mockFormatFileName,
  mockGetSafePath,
  mockHandlePaste,
  mockRegisterHandler,
  mockSetLastFocusedComponent,
  mockUnregisterHandler,
  mockGetFilesFromDropEvent
} = vi.hoisted(() => ({
  mockUseExternalApps: vi.fn(() => ({ data: [] })),
  mockPreview: vi.fn(),
  mockUploadFiles: vi.fn(),
  mockFormatFileName: vi.fn(),
  mockGetSafePath: vi.fn(),
  mockHandlePaste: vi.fn(),
  mockRegisterHandler: vi.fn(),
  mockSetLastFocusedComponent: vi.fn(),
  mockUnregisterHandler: vi.fn(),
  mockGetFilesFromDropEvent: vi.fn()
}))

vi.mock('@renderer/hooks/useAttachment', () => ({
  useAttachment: () => ({ preview: mockPreview })
}))

vi.mock('@renderer/hooks/useExternalApps', () => ({
  useExternalApps: mockUseExternalApps
}))

vi.mock('@renderer/services/FileManager', () => ({
  default: {
    formatFileName: mockFormatFileName,
    getSafePath: mockGetSafePath,
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

describe('useMessageLeafCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseExternalApps.mockReturnValue({ data: [] })
    mockUploadFiles.mockResolvedValue([])
    mockFormatFileName.mockReturnValue('display.pdf')
    mockGetSafePath.mockReturnValue('/safe/display.pdf')
    mockHandlePaste.mockResolvedValue(true)
    mockGetFilesFromDropEvent.mockResolvedValue([])
  })

  it('loads external apps for ordinary text parts that mention inline absolute paths', () => {
    const partsByMessageId: Record<string, CherryMessagePart[]> = {
      message: [{ type: 'text', text: 'Open `/Users/example/project/App.tsx`.' } as CherryMessagePart]
    }

    renderHook(() => useMessageLeafCapabilities({ partsByMessageId }))

    expect(mockUseExternalApps).toHaveBeenCalledWith({ enabled: true })
  })

  it('does not load external apps for text parts without local path hints', () => {
    const partsByMessageId: Record<string, CherryMessagePart[]> = {
      message: [{ type: 'text', text: 'plain response' } as CherryMessagePart]
    }

    renderHook(() => useMessageLeafCapabilities({ partsByMessageId }))

    expect(mockUseExternalApps).toHaveBeenCalledWith({ enabled: false })
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

    const { result } = renderHook(() => useMessageLeafCapabilities({ partsByMessageId: {} }))

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

  it('projects file display data for shared attachment renderers', () => {
    const { result } = renderHook(() => useMessageLeafCapabilities({ partsByMessageId: {} }))

    const file: FileMetadata = {
      id: 'file-1',
      type: FILE_TYPE.DOCUMENT,
      ext: '.pdf',
      path: '/tmp/file.pdf',
      origin_name: 'file.pdf',
      name: 'stored-file.pdf',
      size: 100,
      created_at: '2026-01-01T00:00:00.000Z',
      count: 1
    }

    expect(result.current.getFileView?.(file)).toEqual({
      displayName: 'display.pdf',
      safePath: '/safe/display.pdf',
      previewUrl: 'file:///safe/display.pdf'
    })
    expect(mockFormatFileName).toHaveBeenCalled()
    expect(mockGetSafePath).toHaveBeenCalled()
  })

  it('routes editor paste handling through the page-side paste service capability', async () => {
    const { result } = renderHook(() => useMessageLeafCapabilities({ partsByMessageId: {} }))
    const addFiles = vi.fn()
    const pastedFile = {
      id: 'file-1',
      type: FILE_TYPE.TEXT,
      ext: '.txt',
      path: '/tmp/paste.txt',
      origin_name: 'paste.txt',
      name: 'paste.txt',
      size: 10,
      created_at: '2026-01-01T00:00:00.000Z',
      count: 1
    } satisfies FileMetadata
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
    const { result } = renderHook(() => useMessageLeafCapabilities({ partsByMessageId: {} }))
    const addFiles = vi.fn()
    const pastedFile = {
      id: 'file-1',
      type: FILE_TYPE.TEXT,
      ext: '.txt',
      path: '/tmp/paste.txt',
      origin_name: 'paste.txt',
      name: 'paste.txt',
      size: 10,
      created_at: '2026-01-01T00:00:00.000Z',
      count: 1
    } satisfies FileMetadata
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
    const { result } = renderHook(() => useMessageLeafCapabilities({ partsByMessageId: {} }))
    const handler = vi.fn()

    const cleanup = result.current.bindEditorPasteHandler?.(handler)
    result.current.focusEditorPasteTarget?.()
    cleanup?.()

    expect(mockRegisterHandler).toHaveBeenCalledWith('messageEditor', handler)
    expect(mockSetLastFocusedComponent).toHaveBeenCalledWith('messageEditor')
    expect(mockUnregisterHandler).toHaveBeenCalledWith('messageEditor')
  })

  it('routes dropped editor files through the page-side drop parser capability', async () => {
    const { result } = renderHook(() => useMessageLeafCapabilities({ partsByMessageId: {} }))
    const event = { dataTransfer: { files: [] } } as unknown as DragEvent<HTMLDivElement>

    await result.current.getDroppedEditorFiles?.(event)

    expect(mockGetFilesFromDropEvent).toHaveBeenCalledWith(event)
  })
})
