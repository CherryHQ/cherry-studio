import { FILE_TYPE, type FileMetadata } from '@renderer/types/file'
import type { CherryMessagePart } from '@shared/data/types/message'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMessageLeafCapabilities } from '../useMessageLeafCapabilities'

const { mockUseExternalApps, mockPreview, mockFormatFileName, mockSafeOpen } = vi.hoisted(() => ({
  mockUseExternalApps: vi.fn(() => ({ data: [] })),
  mockPreview: vi.fn(),
  mockFormatFileName: vi.fn(),
  mockSafeOpen: vi.fn()
}))

vi.mock('@renderer/hooks/useAttachment', () => ({
  useAttachment: () => ({ preview: mockPreview })
}))

vi.mock('@renderer/hooks/useExternalApps', () => ({
  useExternalApps: mockUseExternalApps
}))

vi.mock('@renderer/services/FileManager', () => ({
  default: {
    formatFileName: mockFormatFileName
  }
}))

vi.mock('@renderer/services/safeOpen', () => ({
  safeOpen: mockSafeOpen
}))

describe('useMessageLeafCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseExternalApps.mockReturnValue({ data: [] })
    mockFormatFileName.mockReturnValue('display.pdf')
    mockSafeOpen.mockResolvedValue(undefined)
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

  it('opens shared attachment files through safeOpen', async () => {
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

    await result.current.openFile?.(file)

    expect(mockSafeOpen).toHaveBeenCalledWith({ kind: 'path', path: '/tmp/file.pdf' })
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
      previewUrl: 'file:///tmp/file.pdf'
    })
    expect(
      result.current.getFileView?.({
        ...file,
        ext: '.exe',
        path: '/tmp/payload.exe'
      })
    ).toEqual({
      displayName: 'display.pdf',
      previewUrl: 'file:///tmp'
    })
    expect(mockFormatFileName).toHaveBeenCalled()
  })
})
