import { FILE_TYPE } from '@renderer/types/file'
import type { AbsoluteFilePath } from '@shared/types/file'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMessageLeafCapabilities } from '../useMessageLeafCapabilities'

// Keep t() returning raw keys: the renderer setup now initializes real i18n, but
// these assertions embed key strings in the expected display names.
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

const { mockPreview, mockSafeOpen, mockLoggerWarn, mockLoggerDebug } = vi.hoisted(() => ({
  mockPreview: vi.fn(),
  mockSafeOpen: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerDebug: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ warn: mockLoggerWarn, debug: mockLoggerDebug })
  }
}))

vi.mock('../useAttachment', () => ({
  useAttachment: () => ({ preview: mockPreview })
}))

vi.mock('@renderer/utils/file/safeOpen', () => ({
  safeOpen: mockSafeOpen
}))

const mockGetPhysicalPath = vi.fn()

const entryTarget = {
  handle: { kind: 'entry', entryId: '019606a0-0000-7000-8000-000000000001' },
  name: 'notes.txt',
  ext: '.txt'
} as const
const pathTarget = {
  handle: { kind: 'path', path: '/tmp/a.txt' as AbsoluteFilePath },
  name: 'a.txt',
  ext: '.txt'
} as const

describe('useMessageLeafCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSafeOpen.mockResolvedValue(undefined)
    vi.stubGlobal(
      'window',
      Object.assign(globalThis.window, { api: { file: { getPhysicalPath: mockGetPhysicalPath } } })
    )
  })

  it('hands the attachment handle to safeOpen untouched', async () => {
    const { result } = renderHook(() => useMessageLeafCapabilities({ partsByMessageId: {} }))

    await result.current.openFile?.(pathTarget)

    expect(mockSafeOpen).toHaveBeenCalledWith({ kind: 'path', path: '/tmp/a.txt' })
  })

  it('previews text from the path a path handle already carries', async () => {
    const { result } = renderHook(() => useMessageLeafCapabilities({ partsByMessageId: {} }))

    await result.current.previewFile?.(pathTarget)

    expect(mockPreview).toHaveBeenCalledWith('/tmp/a.txt', 'a.txt', FILE_TYPE.TEXT, '.txt')
    expect(mockSafeOpen).not.toHaveBeenCalled()
  })

  // The renderer must never derive this path itself; Main resolves the entry.
  it('asks Main to resolve an entry handle before previewing text', async () => {
    mockGetPhysicalPath.mockResolvedValue('/data/Application Support/notes.txt')
    const { result } = renderHook(() => useMessageLeafCapabilities({ partsByMessageId: {} }))

    await result.current.previewFile?.(entryTarget)

    expect(mockGetPhysicalPath).toHaveBeenCalledWith({ id: '019606a0-0000-7000-8000-000000000001' })
    expect(mockPreview).toHaveBeenCalledWith('/data/Application Support/notes.txt', 'notes.txt', FILE_TYPE.TEXT, '.txt')
  })

  it('falls back to opening the file when the entry has no resolvable path', async () => {
    mockGetPhysicalPath.mockRejectedValue(new Error('gone'))
    const { result } = renderHook(() => useMessageLeafCapabilities({ partsByMessageId: {} }))

    await result.current.previewFile?.(entryTarget)

    expect(mockPreview).not.toHaveBeenCalled()
    expect(mockSafeOpen).toHaveBeenCalledWith(entryTarget.handle)
  })

  it('opens non-text attachments instead of rendering them inline', async () => {
    const { result } = renderHook(() => useMessageLeafCapabilities({ partsByMessageId: {} }))

    await result.current.previewFile?.({ ...pathTarget, name: 'file.pdf', ext: '.pdf' })

    expect(mockSafeOpen).toHaveBeenCalledWith({ kind: 'path', path: '/tmp/a.txt' })
    expect(mockPreview).not.toHaveBeenCalled()
  })

  it('keeps legacy pasted temp-file display behavior local to message attachments', () => {
    const { result } = renderHook(() => useMessageLeafCapabilities({ partsByMessageId: {} }))

    expect(
      result.current.getFileView?.({
        origin_name: 'temp_file_1_image.png',
        ext: '.png',
        created_at: '2026-01-01T00:00:00.000Z'
      })
    ).toEqual({ displayName: '2026-01-01 message.attachments.pasted_image.png' })

    expect(
      result.current.getFileView?.({
        origin_name: 'report.pdf',
        ext: '.pdf',
        created_at: '2026-01-01T00:00:00.000Z'
      })
    ).toEqual({ displayName: 'report.pdf' })
  })
})
