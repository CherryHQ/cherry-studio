import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import type { AbsoluteFilePath } from '@shared/types/file'

import type { ArtifactPaneFileSelection } from '../artifactPanePath'
import { useArtifactPanePreviewNavigation } from '../useArtifactPanePreviewNavigation'

const panelActions = vi.hoisted(() => ({ close: vi.fn(), requestOpen: vi.fn() }))
const panelState = vi.hoisted(() => ({ activePanelId: 'files', presentationOpen: true }))
const getPhysicalPath = vi.hoisted(() => vi.fn())

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: vi.fn() }
}))

vi.mock('../Shell', () => ({
  useRightPanelActions: () => panelActions,
  useRightPanelState: () => panelState
}))

function fileSelection(workspacePath: string, filePath: string): ArtifactPaneFileSelection {
  return { workspacePath, filePath, previewType: 'file', readOnly: true }
}

describe('useArtifactPanePreviewNavigation', () => {
  beforeEach(() => {
    panelActions.close.mockReset()
    panelActions.requestOpen.mockReset()
    panelState.activePanelId = 'files'
    panelState.presentationOpen = true
    vi.mocked(ipcApi.request).mockReset()
    getPhysicalPath.mockReset()
    Object.defineProperty(window.api.file, 'getPhysicalPath', { configurable: true, value: getPhysicalPath })
  })

  it('uses the current managed path when the original file no longer exists', async () => {
    const requestFileSelection = vi.fn()
    vi.mocked(ipcApi.request).mockResolvedValueOnce(null).mockResolvedValueOnce({ kind: 'file' })
    getPhysicalPath.mockResolvedValue('/managed/current/report.md')
    const { result } = renderHook(() =>
      useArtifactPanePreviewNavigation({
        paneId: 'files',
        previewFileSelection: null,
        requestFileSelection,
        workspacePath: '/workspace'
      })
    )

    act(() => {
      result.current.previewInputFile({
        displayName: 'report.md',
        previewPath: '/managed/old/report.md' as AbsoluteFilePath,
        fileEntryId: 'entry-report',
        originalPath: '/Users/alice/report.md' as AbsoluteFilePath
      })
    })
    expect(requestFileSelection).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(getPhysicalPath).toHaveBeenCalledWith({ id: 'entry-report' })
      expect(requestFileSelection).toHaveBeenLastCalledWith(
        expect.objectContaining({ workspacePath: '/managed/current', filePath: 'report.md' })
      )
      expect(requestFileSelection).toHaveBeenCalledTimes(1)
    })
  })

  it('automatically returns through nested input-file previews in reverse order', () => {
    const requestFileSelection = vi.fn()
    vi.mocked(ipcApi.request).mockResolvedValue({ kind: 'file' })
    const first = fileSelection('/workspace', 'first.md')
    const second = fileSelection('/workspace', 'second.md')
    const options = { paneId: 'files', requestFileSelection, workspacePath: '/workspace' }
    const { result, rerender } = renderHook(
      ({ previewFileSelection }) => useArtifactPanePreviewNavigation({ ...options, previewFileSelection }),
      { initialProps: { previewFileSelection: first as ArtifactPaneFileSelection | null } }
    )

    act(() => {
      result.current.previewInputFile({
        displayName: 'second.md',
        previewPath: '/workspace/second.md' as AbsoluteFilePath
      })
    })
    rerender({ previewFileSelection: second })
    act(() => {
      result.current.previewInputFile({
        displayName: 'third.md',
        previewPath: '/workspace/third.md' as AbsoluteFilePath
      })
    })

    act(() => result.current.closeFilePreview())
    expect(requestFileSelection).toHaveBeenLastCalledWith(second)

    act(() => result.current.closeFilePreview())
    expect(requestFileSelection).toHaveBeenLastCalledWith(first)
  })
})
