import { FILE_TYPE, type FileMetadata } from '@renderer/types/file'
import type { CherryMessagePart } from '@shared/data/types/message'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMessageLeafCapabilities } from '../useMessageLeafCapabilities'

const { mockUseExternalApps, mockPreview, mockSafeOpen } = vi.hoisted(() => ({
  mockUseExternalApps: vi.fn(() => ({ data: [] })),
  mockPreview: vi.fn(),
  mockSafeOpen: vi.fn()
}))

vi.mock('@renderer/hooks/useAttachment', () => ({
  useAttachment: () => ({ preview: mockPreview })
}))

vi.mock('@renderer/hooks/useExternalApps', () => ({
  useExternalApps: mockUseExternalApps
}))

vi.mock('@renderer/utils/file/safeOpen', () => ({
  safeOpen: mockSafeOpen
}))

describe('useMessageLeafCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseExternalApps.mockReturnValue({ data: [] })
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

  it('falls back to a file entry handle when shared attachment path is missing', async () => {
    const { result } = renderHook(() => useMessageLeafCapabilities({ partsByMessageId: {} }))

    const file: FileMetadata = {
      id: '019606a0-0000-7000-8000-000000000001',
      type: FILE_TYPE.DOCUMENT,
      ext: '.pdf',
      path: '',
      origin_name: 'file.pdf',
      name: 'stored-file.pdf',
      size: 100,
      created_at: '2026-01-01T00:00:00.000Z',
      count: 1
    }

    await result.current.openFile?.(file)

    expect(mockSafeOpen).toHaveBeenCalledWith({ kind: 'entry', entryId: '019606a0-0000-7000-8000-000000000001' })
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
      displayName: 'file.pdf',
      previewUrl: 'file:///tmp/file.pdf'
    })
    expect(
      result.current.getFileView?.({
        ...file,
        ext: '.exe',
        path: '/tmp/payload.exe'
      })
    ).toEqual({
      displayName: 'file.pdf',
      previewUrl: 'file:///tmp'
    })
  })

  it('keeps legacy pasted temp-file display behavior local to message attachments', () => {
    const { result } = renderHook(() => useMessageLeafCapabilities({ partsByMessageId: {} }))

    const file: FileMetadata = {
      id: 'file-1',
      type: FILE_TYPE.IMAGE,
      ext: '.png',
      path: '/tmp/temp_file_1_image.png',
      origin_name: 'temp_file_1_image.png',
      name: 'temp_file_1_image.png',
      size: 100,
      created_at: '2026-01-01T00:00:00.000Z',
      count: 1
    }

    expect(result.current.getFileView?.(file)).toEqual({
      displayName: '2026-01-01 message.attachments.pasted_image.png',
      previewUrl: 'file:///tmp/temp_file_1_image.png'
    })
  })

  it('keeps legacy pasted text display behavior local to message attachments', () => {
    const { result } = renderHook(() => useMessageLeafCapabilities({ partsByMessageId: {} }))

    const file: FileMetadata = {
      id: 'file-1',
      type: FILE_TYPE.TEXT,
      ext: '.txt',
      path: '/tmp/pasted_text.txt',
      origin_name: 'pasted_text.txt',
      name: 'pasted_text.txt',
      size: 100,
      created_at: '2026-01-01T00:00:00.000Z',
      count: 1
    }

    expect(result.current.getFileView?.(file)).toEqual({
      displayName: '2026-01-01 message.attachments.pasted_text.txt',
      previewUrl: 'file:///tmp/pasted_text.txt'
    })
  })

  it('returns an empty attachment display name when origin_name is missing', () => {
    const { result } = renderHook(() => useMessageLeafCapabilities({ partsByMessageId: {} }))

    const file: FileMetadata = {
      id: 'file-1',
      type: FILE_TYPE.DOCUMENT,
      ext: '.pdf',
      path: '/tmp/file.pdf',
      origin_name: '',
      name: 'stored-file.pdf',
      size: 100,
      created_at: '2026-01-01T00:00:00.000Z',
      count: 1
    }

    expect(result.current.getFileView?.(file)).toEqual({
      displayName: '',
      previewUrl: 'file:///tmp/file.pdf'
    })
  })
})
