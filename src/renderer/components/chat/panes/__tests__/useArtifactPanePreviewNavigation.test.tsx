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

function acceptLastSelection(requestFileSelection: ReturnType<typeof vi.fn>) {
  const accept = requestFileSelection.mock.calls.at(-1)?.[1] as (() => void) | undefined
  act(() => accept?.())
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
        expect.objectContaining({ workspacePath: '/managed/current', filePath: 'report.md' }),
        expect.any(Function)
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
    expect(requestFileSelection).toHaveBeenLastCalledWith(second, expect.any(Function))
    acceptLastSelection(requestFileSelection)

    act(() => result.current.closeFilePreview())
    expect(requestFileSelection).toHaveBeenLastCalledWith(first, expect.any(Function))
    acceptLastSelection(requestFileSelection)
  })

  it('returns to every linked artifact while an input preview return chain is active', () => {
    const requestFileSelection = vi.fn()
    const first = fileSelection('/workspace', 'first.md')
    const second: ArtifactPaneFileSelection = { workspacePath: '/workspace', filePath: 'second.md' }
    const third: ArtifactPaneFileSelection = { workspacePath: '/workspace', filePath: 'third.md' }
    const { result, rerender } = renderHook(
      ({ selection }: { selection: ArtifactPaneFileSelection }) =>
        useArtifactPanePreviewNavigation({
          paneId: 'files',
          previewFileSelection: selection,
          requestFileSelection,
          workspacePath: '/workspace'
        }),
      { initialProps: { selection: first } }
    )

    act(() => result.current.captureInputPreviewReturnTarget())
    rerender({ selection: second })
    act(() => result.current.captureInputPreviewReturnTarget())
    rerender({ selection: third })
    act(() => result.current.closeFilePreview())
    expect(requestFileSelection).toHaveBeenLastCalledWith(second, expect.any(Function))
    acceptLastSelection(requestFileSelection)
    rerender({ selection: second })
    act(() => result.current.closeFilePreview())
    expect(requestFileSelection).toHaveBeenLastCalledWith(first, expect.any(Function))
    acceptLastSelection(requestFileSelection)
  })

  it('does not activate Files before a guarded selection is accepted', async () => {
    const requestFileSelection = vi.fn()
    vi.mocked(ipcApi.request).mockResolvedValue({ kind: 'file' })
    const { result } = renderHook(() =>
      useArtifactPanePreviewNavigation({
        paneId: 'files',
        previewFileSelection: null,
        requestFileSelection
      })
    )
    act(() =>
      result.current.previewInputFile({
        displayName: 'report.md',
        previewPath: '/managed/report.md' as AbsoluteFilePath
      })
    )
    await waitFor(() => expect(requestFileSelection).toHaveBeenCalledTimes(1))
    expect(panelActions.requestOpen).not.toHaveBeenCalled()
    const accept = requestFileSelection.mock.calls[0][1] as () => void
    act(accept)
    expect(panelActions.requestOpen).toHaveBeenCalledWith('files', { userInitiated: true })
  })

  it('does not select a file when the scope changes before attachment metadata resolves', async () => {
    let resolveMetadata: (metadata: { kind: 'file' }) => void = () => {}
    vi.mocked(ipcApi.request).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMetadata = resolve
        })
    )
    const requestFileSelection = vi.fn()
    const { result, rerender } = renderHook(
      ({ scopeKey }) =>
        useArtifactPanePreviewNavigation({
          paneId: 'files',
          previewFileSelection: null,
          requestFileSelection,
          scopeKey
        }),
      { initialProps: { scopeKey: 'session-a' } }
    )
    act(() =>
      result.current.previewInputFile({
        displayName: 'report.md',
        previewPath: '/managed/report.md' as AbsoluteFilePath
      })
    )
    rerender({ scopeKey: 'session-b' })
    await act(async () => {
      resolveMetadata({ kind: 'file' })
    })

    expect(requestFileSelection).not.toHaveBeenCalled()
    expect(panelActions.requestOpen).not.toHaveBeenCalled()
  })

  it('keeps a reachable UNC original ahead of the managed preview path', async () => {
    const requestFileSelection = vi.fn()
    const uncPath = '\\\\server\\share\\docs\\report.md' as AbsoluteFilePath
    vi.mocked(ipcApi.request).mockResolvedValue({ kind: 'file' })
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
        originalPath: uncPath
      })
    })

    await waitFor(() => expect(requestFileSelection).toHaveBeenCalledTimes(1))
    expect(ipcApi.request).toHaveBeenCalledWith('file.get_metadata', { kind: 'path', path: uncPath })
    expect(getPhysicalPath).not.toHaveBeenCalled()
    expect(requestFileSelection).toHaveBeenCalledWith(
      expect.objectContaining({ workspacePath: '//server/share/docs', filePath: 'report.md' }),
      expect.any(Function)
    )
  })

  it('falls back to the managed path when the UNC original is unreachable', async () => {
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
        originalPath: '\\\\server\\share\\docs\\report.md' as AbsoluteFilePath
      })
    })

    await waitFor(() => {
      expect(getPhysicalPath).toHaveBeenCalledWith({ id: 'entry-report' })
      expect(requestFileSelection).toHaveBeenCalledWith(
        expect.objectContaining({ workspacePath: '/managed/current', filePath: 'report.md' }),
        expect.any(Function)
      )
    })
  })

  it('drops a pending attachment after a newer shared selection generation starts', async () => {
    const selectionGenerationRef = { current: 0 }
    let resolveMetadata: (metadata: { kind: 'file' }) => void = () => {}
    vi.mocked(ipcApi.request).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMetadata = resolve
        })
    )
    const requestFileSelection = vi.fn()
    const { result } = renderHook(() =>
      useArtifactPanePreviewNavigation({
        paneId: 'files',
        previewFileSelection: null,
        requestFileSelection,
        selectionGenerationRef,
        workspacePath: '/workspace'
      })
    )

    act(() => {
      result.current.previewInputFile({
        displayName: 'notes.md',
        previewPath: '/workspace/notes.md' as AbsoluteFilePath
      })
    })
    const attachmentGeneration = selectionGenerationRef.current
    act(() => {
      selectionGenerationRef.current += 1
    })
    await act(async () => {
      resolveMetadata({ kind: 'file' })
    })

    expect(selectionGenerationRef.current).toBeGreaterThan(attachmentGeneration)
    expect(requestFileSelection).not.toHaveBeenCalled()
  })

  it('restores the original pane only after Back is accepted, including when that target has no file', () => {
    const requestFileSelection = vi.fn()
    panelState.presentationOpen = false
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
        displayName: 'notes.md',
        previewPath: '/workspace/notes.md' as AbsoluteFilePath
      })
    })
    act(() => result.current.closeFilePreview())
    expect(requestFileSelection).toHaveBeenLastCalledWith(null, expect.any(Function))
    expect(panelActions.close).not.toHaveBeenCalled()

    act(() => result.current.closeFilePreview())
    expect(panelActions.close).not.toHaveBeenCalled()
    expect(requestFileSelection).toHaveBeenLastCalledWith(null, expect.any(Function))

    acceptLastSelection(requestFileSelection)
    expect(panelActions.close).toHaveBeenCalledTimes(1)

    panelActions.close.mockClear()
    act(() => result.current.closeFilePreview())
    acceptLastSelection(requestFileSelection)
    expect(panelActions.close).not.toHaveBeenCalled()
  })

  it('keeps the previous panel until Back is accepted', () => {
    const requestFileSelection = vi.fn()
    const artifact = fileSelection('/workspace', 'report.md')
    panelState.activePanelId = 'browser'
    const { result } = renderHook(() =>
      useArtifactPanePreviewNavigation({
        paneId: 'files',
        previewFileSelection: artifact,
        requestFileSelection,
        workspacePath: '/workspace'
      })
    )

    act(() => {
      result.current.previewInputFile({
        displayName: 'notes.md',
        previewPath: '/workspace/notes.md' as AbsoluteFilePath
      })
    })
    act(() => result.current.closeFilePreview())
    expect(requestFileSelection).toHaveBeenLastCalledWith(artifact, expect.any(Function))
    expect(panelActions.requestOpen).not.toHaveBeenCalled()
    expect(panelActions.close).not.toHaveBeenCalled()

    acceptLastSelection(requestFileSelection)
    expect(panelActions.requestOpen).toHaveBeenCalledWith('browser')
    expect(panelActions.close).not.toHaveBeenCalled()
  })
})
