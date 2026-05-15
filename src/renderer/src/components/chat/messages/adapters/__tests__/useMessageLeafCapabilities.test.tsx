import type { CherryMessagePart } from '@shared/data/types/message'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMessageLeafCapabilities } from '../useMessageLeafCapabilities'

const { mockUseExternalApps, mockPreview, mockUploadFiles } = vi.hoisted(() => ({
  mockUseExternalApps: vi.fn(() => ({ data: [] })),
  mockPreview: vi.fn(),
  mockUploadFiles: vi.fn()
}))

vi.mock('@renderer/hooks/useAttachment', () => ({
  useAttachment: () => ({ preview: mockPreview })
}))

vi.mock('@renderer/hooks/useExternalApps', () => ({
  useExternalApps: mockUseExternalApps
}))

vi.mock('@renderer/services/FileManager', () => ({
  default: {
    formatFileName: vi.fn(),
    getSafePath: vi.fn(),
    uploadFiles: mockUploadFiles
  }
}))

describe('useMessageLeafCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseExternalApps.mockReturnValue({ data: [] })
    mockUploadFiles.mockResolvedValue([])
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
})
