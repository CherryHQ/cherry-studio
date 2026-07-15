// @vitest-environment jsdom
import type { FilePath } from '@shared/types/file'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openTab: vi.fn()
}))

vi.mock('@renderer/hooks/tab', () => ({
  useTabs: () => ({ openTab: mocks.openTab })
}))

import { useOpenFilePreviewTab } from '../useOpenFilePreviewTab'

beforeEach(() => {
  mocks.openTab.mockReset()
  mocks.openTab.mockReturnValue('file-preview-tab')
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
      title: 'report.md'
    })
  })

  it('rejects invalid paths before opening a tab', () => {
    const { result } = renderHook(() => useOpenFilePreviewTab())

    expect(() => result.current('relative/report.md' as FilePath)).toThrow()
    expect(mocks.openTab).not.toHaveBeenCalled()
  })
})
