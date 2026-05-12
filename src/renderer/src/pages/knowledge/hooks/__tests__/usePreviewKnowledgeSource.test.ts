import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockRendererLoggerService } from '../../../../../../../tests/__mocks__/RendererLoggerService'
import {
  createDirectoryItem,
  createFileItem,
  createNoteItem,
  createSitemapItem,
  createUrlItem
} from '../../panels/dataSource/__tests__/testUtils'
import { usePreviewKnowledgeSource } from '../usePreviewKnowledgeSource'

const mockOpenPath = vi.fn()
const mockOpenExternal = vi.fn()
const mockToastError = vi.fn()
const mockToastWarning = vi.fn()
let loggerErrorSpy: ReturnType<typeof vi.spyOn>

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'knowledge.data_source.preview.failed': '预览原文失败',
          'knowledge.data_source.preview.unavailable': '当前数据源没有可预览的原文'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

describe('usePreviewKnowledgeSource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loggerErrorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockOpenPath.mockResolvedValue(undefined)
    mockOpenExternal.mockResolvedValue(undefined)
    ;(window as any).api = {
      file: {
        openPath: mockOpenPath
      },
      shell: {
        openExternal: mockOpenExternal
      }
    }
    ;(window as any).toast = {
      error: mockToastError,
      warning: mockToastWarning
    }
  })

  it('opens file sources through the file path API', async () => {
    const { result } = renderHook(() => usePreviewKnowledgeSource())
    const item = createFileItem({ id: 'file-1', source: '/Users/me/report.pdf' })

    await act(async () => {
      await result.current.previewSource(item)
    })

    expect(mockOpenPath).toHaveBeenCalledWith('/Users/me/report.pdf')
    expect(mockOpenExternal).not.toHaveBeenCalled()
  })

  it('opens directory sources through the file path API', async () => {
    const { result } = renderHook(() => usePreviewKnowledgeSource())
    const item = createDirectoryItem({ id: 'directory-1', source: '/Users/me/docs' })

    await act(async () => {
      await result.current.previewSource(item)
    })

    expect(mockOpenPath).toHaveBeenCalledWith('/Users/me/docs')
    expect(mockOpenExternal).not.toHaveBeenCalled()
  })

  it('opens url and sitemap sources in the external browser', async () => {
    const { result } = renderHook(() => usePreviewKnowledgeSource())

    await act(async () => {
      await result.current.previewSource(createUrlItem({ id: 'url-1', source: 'https://example.com/article' }))
      await result.current.previewSource(
        createSitemapItem({ id: 'sitemap-1', source: 'https://example.com/sitemap.xml' })
      )
    })

    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com/article')
    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com/sitemap.xml')
    expect(mockOpenPath).not.toHaveBeenCalled()
  })

  it('opens note sources only when the source is an http url', async () => {
    const { result } = renderHook(() => usePreviewKnowledgeSource())

    await act(async () => {
      await result.current.previewSource(createNoteItem({ id: 'note-1', source: 'https://example.com/note' }))
    })

    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com/note')
    expect(mockToastWarning).not.toHaveBeenCalled()
  })

  it('shows an unavailable toast for notes without a previewable source', async () => {
    const { result } = renderHook(() => usePreviewKnowledgeSource())

    await act(async () => {
      await result.current.previewSource(createNoteItem({ id: 'note-1' }))
    })

    expect(mockOpenPath).not.toHaveBeenCalled()
    expect(mockOpenExternal).not.toHaveBeenCalled()
    expect(mockToastWarning).toHaveBeenCalledWith('当前数据源没有可预览的原文')
  })

  it('logs and shows a failure toast when previewing rejects', async () => {
    const previewError = new Error('open failed')
    mockOpenPath.mockRejectedValueOnce(previewError)
    const { result } = renderHook(() => usePreviewKnowledgeSource())

    await act(async () => {
      await result.current.previewSource(createFileItem({ id: 'file-1', source: '/Users/me/report.pdf' }))
    })

    expect(mockToastError).toHaveBeenCalledWith('预览原文失败: open failed')
    expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to preview knowledge source', previewError, {
      itemId: 'file-1',
      itemType: 'file',
      source: '/Users/me/report.pdf'
    })
  })
})
