import {
  createDirectoryItem,
  createFileItem,
  createNoteItem,
  createUrlItem
} from '@renderer/pages/knowledge/panels/dataSource/__tests__/testUtils'
import { toast } from '@renderer/services/toast'
import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePreviewKnowledgeSource } from '../usePreviewKnowledgeSource'

const mockOpenPath = vi.fn()
const mockOpenExternal = vi.fn()
const mockIpcRequest = vi.hoisted(() => vi.fn())
const previewFileMock = vi.fn()
let loggerErrorSpy: ReturnType<typeof vi.spyOn>

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: mockIpcRequest
  }
}))

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
    mockIpcRequest.mockResolvedValue('/knowledge/base-1/raw/report.pdf')
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
  })

  it('resolves knowledge-managed file sources into embedded preview targets', async () => {
    mockIpcRequest.mockResolvedValue('/knowledge/base-1/raw/drafts/../report.pdf')
    const { result } = renderHook(() => usePreviewKnowledgeSource(previewFileMock))
    const item = createFileItem({ id: 'file-1', source: '/Users/me/report.pdf' })

    await act(async () => {
      await result.current.previewSource(item)
    })

    expect(mockIpcRequest).toHaveBeenCalledWith('knowledge.get_file_path', { itemId: 'file-1' })
    expect(previewFileMock).toHaveBeenCalledWith({
      fileName: 'report.pdf',
      filePath: '/knowledge/base-1/raw/report.pdf'
    })
    expect(mockOpenPath).not.toHaveBeenCalled()
    expect(mockOpenExternal).not.toHaveBeenCalled()
  })

  it('opens directory sources through the file path API', async () => {
    const { result } = renderHook(() => usePreviewKnowledgeSource(previewFileMock))
    const item = createDirectoryItem({ id: 'directory-1', source: '/Users/me/docs' })

    await act(async () => {
      await result.current.previewSource(item)
    })

    expect(mockOpenPath).toHaveBeenCalledWith('/Users/me/docs')
    expect(mockOpenExternal).not.toHaveBeenCalled()
  })

  it('resolves captured URL snapshots into embedded preview targets', async () => {
    mockIpcRequest.mockResolvedValue('/knowledge/base-1/raw/drafts/../Product Docs.md')
    const { result } = renderHook(() => usePreviewKnowledgeSource(previewFileMock))
    const item = createUrlItem({
      id: 'url-1',
      source: 'https://example.com/product-docs',
      relativePath: 'Product Docs.md'
    })

    await act(async () => {
      await result.current.previewSource(item)
    })

    expect(mockIpcRequest).toHaveBeenCalledWith('knowledge.get_file_path', { itemId: 'url-1' })
    expect(previewFileMock).toHaveBeenCalledWith({
      fileName: 'Product Docs',
      filePath: '/knowledge/base-1/raw/Product Docs.md'
    })
    expect(mockOpenPath).not.toHaveBeenCalled()
    expect(mockOpenExternal).not.toHaveBeenCalled()
  })

  it('opens URL sources in the external browser before a snapshot is captured', async () => {
    const { result } = renderHook(() => usePreviewKnowledgeSource(previewFileMock))

    await act(async () => {
      await result.current.previewSource(createUrlItem({ id: 'url-1', source: 'https://example.com/article' }))
    })

    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com/article')
    expect(mockOpenPath).not.toHaveBeenCalled()
    expect(mockIpcRequest).not.toHaveBeenCalled()
    expect(previewFileMock).not.toHaveBeenCalled()
  })

  it('sanitizes url sources before opening them', async () => {
    const { result } = renderHook(() => usePreviewKnowledgeSource(previewFileMock))

    await act(async () => {
      await result.current.previewSource(createUrlItem({ id: 'url-1', source: ' HTTPS://Example.COM/a/../b?x=1#h ' }))
    })

    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com/b?x=1#h')
    expect(mockOpenPath).not.toHaveBeenCalled()
  })

  it('shows an unavailable toast for non-http url sources', async () => {
    const { result } = renderHook(() => usePreviewKnowledgeSource(previewFileMock))

    await act(async () => {
      await result.current.previewSource(createUrlItem({ id: 'url-1', source: 'mailto:test@example.com' }))
    })

    expect(mockOpenPath).not.toHaveBeenCalled()
    expect(mockOpenExternal).not.toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalledWith('当前数据源没有可预览的原文')
  })

  it('shows an unavailable toast for invalid url sources', async () => {
    const { result } = renderHook(() => usePreviewKnowledgeSource(previewFileMock))

    await act(async () => {
      await result.current.previewSource(createUrlItem({ id: 'url-1', source: 'not a url' }))
    })

    expect(mockOpenPath).not.toHaveBeenCalled()
    expect(mockOpenExternal).not.toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalledWith('当前数据源没有可预览的原文')
  })

  it('opens note sources only when the source is an http url', async () => {
    const { result } = renderHook(() => usePreviewKnowledgeSource(previewFileMock))

    await act(async () => {
      await result.current.previewSource(createNoteItem({ id: 'note-1', source: 'https://example.com/note' }))
    })

    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com/note')
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('shows an unavailable toast for non-http note sources', async () => {
    const { result } = renderHook(() => usePreviewKnowledgeSource(previewFileMock))

    await act(async () => {
      await result.current.previewSource(createNoteItem({ id: 'note-1', source: 'obsidian://open?vault=notes' }))
    })

    expect(mockOpenPath).not.toHaveBeenCalled()
    expect(mockOpenExternal).not.toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalledWith('当前数据源没有可预览的原文')
  })

  it('shows an unavailable toast for notes without a previewable source', async () => {
    const { result } = renderHook(() => usePreviewKnowledgeSource(previewFileMock))

    await act(async () => {
      await result.current.previewSource(createNoteItem({ id: 'note-1' }))
    })

    expect(mockOpenPath).not.toHaveBeenCalled()
    expect(mockOpenExternal).not.toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalledWith('当前数据源没有可预览的原文')
  })

  it('logs and shows a failure toast when previewing rejects', async () => {
    const previewError = new Error('open failed')
    mockIpcRequest.mockRejectedValueOnce(previewError)
    const { result } = renderHook(() => usePreviewKnowledgeSource(previewFileMock))

    await act(async () => {
      await result.current.previewSource(createFileItem({ id: 'file-1', source: '/Users/me/report.pdf' }))
    })

    expect(toast.error).toHaveBeenCalledWith('预览原文失败: open failed')
    expect(previewFileMock).not.toHaveBeenCalled()
    expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to preview knowledge source', previewError, {
      itemId: 'file-1',
      itemType: 'file',
      source: '/Users/me/report.pdf'
    })
  })

  it('does not fall back to the live URL when captured snapshot resolution fails', async () => {
    const previewError = new Error('snapshot path unavailable')
    mockIpcRequest.mockRejectedValueOnce(previewError)
    const { result } = renderHook(() => usePreviewKnowledgeSource(previewFileMock))

    await act(async () => {
      await result.current.previewSource(
        createUrlItem({
          id: 'url-1',
          source: 'https://example.com/product-docs',
          relativePath: 'Product Docs.md'
        })
      )
    })

    expect(mockOpenExternal).not.toHaveBeenCalled()
    expect(previewFileMock).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('预览原文失败: snapshot path unavailable')
    expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to preview knowledge source', previewError, {
      itemId: 'url-1',
      itemType: 'url',
      source: 'https://example.com/product-docs'
    })
  })
})
