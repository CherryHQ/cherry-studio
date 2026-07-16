// @vitest-environment jsdom
import type { FilePath } from '@shared/types/file'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openTab: vi.fn(),
  tabs: [] as Array<{
    id: string
    metadata?: Record<string, unknown>
    type: 'route'
    url: string
  }>,
  updateTab: vi.fn()
}))

vi.mock('@renderer/hooks/tab', () => ({
  useTabs: () => ({ openTab: mocks.openTab, tabs: mocks.tabs, updateTab: mocks.updateTab })
}))

import { useOpenFilePreviewTab } from '../useOpenFilePreviewTab'

beforeEach(() => {
  mocks.openTab.mockReset()
  mocks.openTab.mockReturnValue('file-preview-tab')
  mocks.tabs.length = 0
  mocks.updateTab.mockReset()
})

describe('useOpenFilePreviewTab', () => {
  it('opens a canonical route that reuses the same file tab', () => {
    const { result } = renderHook(() => useOpenFilePreviewTab())
    let tabId: string | undefined

    act(() => {
      tabId = result.current('/tmp/notes/../report.md' as FilePath)
    })

    expect(tabId).toBe('file-preview-tab')
    expect(mocks.openTab).toHaveBeenCalledWith('/app/file-preview?path=%2Ftmp%2Freport.md', {
      metadata: { filePreviewRefreshKey: 0 },
      title: 'report.md'
    })
    expect(mocks.updateTab).not.toHaveBeenCalled()
  })

  it('increments the refresh key when reusing an existing file tab', () => {
    mocks.tabs.push({
      id: 'file-preview-tab',
      metadata: { filePreviewRefreshKey: 2, retained: true },
      type: 'route',
      url: '/app/file-preview?path=%2Ftmp%2Freport.md'
    })
    const { result } = renderHook(() => useOpenFilePreviewTab())

    act(() => {
      result.current('/tmp/report.md' as FilePath)
    })

    expect(mocks.openTab).toHaveBeenCalledWith('/app/file-preview?path=%2Ftmp%2Freport.md', {
      title: 'report.md'
    })
    expect(mocks.updateTab).toHaveBeenCalledWith('file-preview-tab', {
      metadata: { filePreviewRefreshKey: 3, retained: true }
    })
  })

  it('uses the provided file name as the tab title', () => {
    const { result } = renderHook(() => useOpenFilePreviewTab())

    act(() => {
      result.current('/tmp/storage/opaque-id.docx' as FilePath, 'Quarterly report.docx')
    })

    expect(mocks.openTab).toHaveBeenCalledWith('/app/file-preview?path=%2Ftmp%2Fstorage%2Fopaque-id.docx', {
      metadata: { filePreviewRefreshKey: 0 },
      title: 'Quarterly report.docx'
    })
  })

  it('uses the same URL for lexically equivalent paths', () => {
    const { result } = renderHook(() => useOpenFilePreviewTab())

    act(() => {
      result.current('/tmp/notes/../report.md' as FilePath)
      result.current('/tmp/report.md' as FilePath)
    })

    expect(mocks.openTab.mock.calls.map(([url]) => url)).toEqual([
      '/app/file-preview?path=%2Ftmp%2Freport.md',
      '/app/file-preview?path=%2Ftmp%2Freport.md'
    ])
  })

  it('rejects invalid paths before opening a tab', () => {
    const { result } = renderHook(() => useOpenFilePreviewTab())

    expect(() => result.current('relative/report.md' as FilePath)).toThrow()
    expect(mocks.openTab).not.toHaveBeenCalled()
  })
})
