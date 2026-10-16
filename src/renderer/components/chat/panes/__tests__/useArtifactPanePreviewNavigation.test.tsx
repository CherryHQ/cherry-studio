import { act, renderHook, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import type { AbsoluteFilePath } from '@shared/types/file'

import type { ArtifactPaneFileSelection } from '../artifactPanePath'
import { getArtifactPaneSelectionPath } from '../artifactPanePath'
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

  it('automatically returns through nested input-file previews in reverse order', async () => {
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
    await waitFor(() => expect(requestFileSelection).toHaveBeenCalledTimes(1))
    acceptLastSelection(requestFileSelection)
    rerender({ previewFileSelection: second })
    act(() => {
      result.current.previewInputFile({
        displayName: 'third.md',
        previewPath: '/workspace/third.md' as AbsoluteFilePath
      })
    })
    await waitFor(() => expect(requestFileSelection).toHaveBeenCalledTimes(2))
    acceptLastSelection(requestFileSelection)

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
    expect(ipcApi.request).toHaveBeenCalledWith('file.read', {
      handle: { kind: 'path', path: uncPath },
      options: { mode: 'range', offset: 0, length: 1 }
    })
    expect(getPhysicalPath).not.toHaveBeenCalled()
    expect(requestFileSelection).toHaveBeenCalledWith(
      expect.objectContaining({ workspacePath: '//server/share/docs', filePath: 'report.md' }),
      expect.any(Function)
    )
  })

  it('previews a readable POSIX original whose filename contains a backslash', async () => {
    const originalPath = '/tmp/a\\b.txt' as AbsoluteFilePath
    const requestFileSelection = vi.fn()
    vi.mocked(ipcApi.request).mockResolvedValue({ kind: 'file' })
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
        displayName: 'a\\b.txt',
        previewPath: '/managed/a/b.txt' as AbsoluteFilePath,
        fileEntryId: 'entry-backslash',
        originalPath
      })
    })

    await waitFor(() => expect(requestFileSelection).toHaveBeenCalledTimes(1))
    const selection = requestFileSelection.mock.calls[0]?.[0] as ArtifactPaneFileSelection
    expect(getArtifactPaneSelectionPath(selection)).toBe(originalPath)
    expect(selection).toMatchObject({ displayPath: originalPath, previewType: 'file', readOnly: true })
    const metadataPaths = vi
      .mocked(ipcApi.request)
      .mock.calls.filter(([route]) => route === 'file.get_metadata')
      .map(([, handle]) => (handle as { path?: string } | undefined)?.path)
    expect(metadataPaths).toEqual([originalPath, originalPath])
    expect(getPhysicalPath).not.toHaveBeenCalled()
  })

  it('uses the managed file when the original path stats as a file but cannot be read', async () => {
    const requestFileSelection = vi.fn()
    const originalPath = '/Users/alice/report.md' as AbsoluteFilePath
    vi.mocked(ipcApi.request).mockImplementation(async (route: string) => {
      if (route === 'file.read') throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      return { kind: 'file' }
    })
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
        originalPath
      })
    })

    await waitFor(() => {
      expect(requestFileSelection).toHaveBeenCalledWith(
        expect.objectContaining({ workspacePath: '/managed/current', filePath: 'report.md' }),
        expect.any(Function)
      )
    })
    expect(ipcApi.request).toHaveBeenCalledWith('file.read', {
      handle: { kind: 'path', path: originalPath },
      options: { mode: 'range', offset: 0, length: 1 }
    })
    expect(getPhysicalPath).toHaveBeenCalledWith({ id: 'entry-report' })
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

  it('keeps the visible file when a root path cannot be previewed, then Back restores the original file and files pane', async () => {
    vi.mocked(ipcApi.request).mockResolvedValue({ kind: 'file' })
    const original = fileSelection('/workspace', 'original.md')
    const { result } = renderHook(() => {
      const [selection, setSelection] = useState<ArtifactPaneFileSelection | null>(original)
      const navigation = useArtifactPanePreviewNavigation({
        paneId: 'files',
        previewFileSelection: selection,
        requestFileSelection: (nextSelection, onAccepted) => {
          setSelection(nextSelection)
          onAccepted?.()
        },
        workspacePath: '/workspace'
      })
      return { selection, ...navigation }
    })

    act(() => {
      result.current.previewInputFile({
        displayName: 'current.md',
        previewPath: '/workspace/current.md' as AbsoluteFilePath
      })
    })

    await waitFor(() => {
      expect(result.current.selection).toMatchObject({
        displayName: 'current.md',
        filePath: 'current.md',
        previewType: 'file',
        readOnly: true,
        workspacePath: '/workspace'
      })
    })
    const visibleFile = result.current.selection
    expect(panelActions.requestOpen).toHaveBeenCalledWith('files', { userInitiated: true })
    panelActions.requestOpen.mockClear()
    panelActions.close.mockClear()

    act(() => {
      result.current.previewInputFile({
        displayName: 'root',
        previewPath: '/' as AbsoluteFilePath
      })
    })

    expect(result.current.selection).toBe(visibleFile)
    expect(panelActions.requestOpen).not.toHaveBeenCalled()
    expect(panelActions.close).not.toHaveBeenCalled()

    act(() => result.current.closeFilePreview())

    expect(result.current.selection).toBe(original)
    expect(panelActions.requestOpen).toHaveBeenCalledWith('files')
    expect(panelActions.close).not.toHaveBeenCalled()
  })

  it('restores the original pane only after Back is accepted, including when that target has no file', async () => {
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
    await waitFor(() => expect(requestFileSelection).toHaveBeenCalledTimes(1))
    acceptLastSelection(requestFileSelection)
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

  it('keeps Back when the incoming workspace changes before the committed workspace does', async () => {
    const requestFileSelection = vi.fn()
    vi.mocked(ipcApi.request).mockResolvedValue({ kind: 'file' })
    const notes = fileSelection('/workspace-a', 'notes.md')
    const design = fileSelection('/workspace-a', 'DESIGN.md')
    const { result, rerender } = renderHook(
      ({
        acceptedWorkspacePath,
        previewFileSelection,
        workspacePath
      }: {
        acceptedWorkspacePath: string
        previewFileSelection: ArtifactPaneFileSelection | null
        workspacePath: string
      }) =>
        useArtifactPanePreviewNavigation({
          acceptedWorkspacePath,
          paneId: 'files',
          previewFileSelection,
          requestFileSelection,
          workspacePath
        }),
      {
        initialProps: {
          acceptedWorkspacePath: '/workspace-a',
          previewFileSelection: null as ArtifactPaneFileSelection | null,
          workspacePath: '/workspace-a'
        }
      }
    )

    act(() => {
      result.current.previewInputFile({
        displayName: 'notes.md',
        previewPath: '/workspace-a/notes.md' as AbsoluteFilePath
      })
    })
    await waitFor(() => expect(requestFileSelection).toHaveBeenCalledTimes(1))
    acceptLastSelection(requestFileSelection)
    rerender({
      acceptedWorkspacePath: '/workspace-a',
      previewFileSelection: notes,
      workspacePath: '/workspace-a'
    })
    act(() => result.current.captureInputPreviewReturnTarget())
    rerender({
      acceptedWorkspacePath: '/workspace-a',
      previewFileSelection: design,
      workspacePath: '/workspace-a'
    })
    rerender({
      acceptedWorkspacePath: '/workspace-a',
      previewFileSelection: design,
      workspacePath: '/workspace-b'
    })

    act(() => result.current.closeFilePreview())
    expect(requestFileSelection).toHaveBeenLastCalledWith(notes, expect.any(Function))

    rerender({
      acceptedWorkspacePath: '/workspace-b',
      previewFileSelection: design,
      workspacePath: '/workspace-b'
    })
    act(() => result.current.closeFilePreview())
    expect(requestFileSelection).toHaveBeenLastCalledWith(null, expect.any(Function))
  })

  it('drops in-flight attachment metadata when the incoming workspace changes', async () => {
    let resolveMetadata: (metadata: { kind: 'file' }) => void = () => {}
    vi.mocked(ipcApi.request).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMetadata = resolve
        })
    )
    const requestFileSelection = vi.fn()
    const { result, rerender } = renderHook(
      ({ acceptedWorkspacePath, workspacePath }) =>
        useArtifactPanePreviewNavigation({
          acceptedWorkspacePath,
          paneId: 'files',
          previewFileSelection: null,
          requestFileSelection,
          workspacePath
        }),
      { initialProps: { acceptedWorkspacePath: '/workspace-a', workspacePath: '/workspace-a' } }
    )

    act(() => {
      result.current.previewInputFile({
        displayName: 'notes.md',
        previewPath: '/workspace-a/notes.md' as AbsoluteFilePath
      })
    })
    rerender({ acceptedWorkspacePath: '/workspace-a', workspacePath: '/workspace-b' })
    await act(async () => {
      resolveMetadata({ kind: 'file' })
    })

    expect(requestFileSelection).not.toHaveBeenCalled()
  })

  it('keeps the previous panel until Back is accepted', async () => {
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
    await waitFor(() => expect(requestFileSelection).toHaveBeenCalledTimes(1))
    expect(panelActions.requestOpen).not.toHaveBeenCalled()
    acceptLastSelection(requestFileSelection)
    expect(panelActions.requestOpen).toHaveBeenCalledWith('files', { userInitiated: true })
    panelActions.requestOpen.mockClear()

    act(() => result.current.closeFilePreview())
    expect(requestFileSelection).toHaveBeenLastCalledWith(artifact, expect.any(Function))
    expect(panelActions.requestOpen).not.toHaveBeenCalled()
    expect(panelActions.close).not.toHaveBeenCalled()

    acceptLastSelection(requestFileSelection)
    expect(panelActions.requestOpen).toHaveBeenCalledWith('browser')
    expect(panelActions.close).not.toHaveBeenCalled()
  })

  it('restores the prior file with one Back after the displayed attachment is previewed again', async () => {
    // Bug: previewing the attachment already on screen pushes that file onto return history, so the first Back stays there.
    vi.mocked(ipcApi.request).mockResolvedValue({ kind: 'file' })
    const prior = fileSelection('/workspace', 'b.md')
    const { result } = renderHook(() => {
      const [selection, setSelection] = useState<ArtifactPaneFileSelection | null>(prior)
      const navigation = useArtifactPanePreviewNavigation({
        paneId: 'files',
        previewFileSelection: selection,
        requestFileSelection: (nextSelection, onAccepted) => {
          setSelection(nextSelection)
          onAccepted?.()
        },
        workspacePath: '/workspace'
      })
      return { selection, ...navigation }
    })

    const previewA = () => {
      result.current.previewInputFile({
        displayName: 'a.md',
        previewPath: '/workspace/a.md' as AbsoluteFilePath
      })
    }

    act(() => previewA())
    await waitFor(() => expect(result.current.selection?.filePath).toBe('a.md'))

    panelActions.requestOpen.mockClear()
    act(() => previewA())
    await waitFor(() => expect(panelActions.requestOpen).toHaveBeenCalledWith('files', { userInitiated: true }))
    expect(result.current.selection?.filePath).toBe('a.md')

    panelActions.requestOpen.mockClear()
    act(() => previewA())
    await waitFor(() => expect(panelActions.requestOpen).toHaveBeenCalledWith('files', { userInitiated: true }))
    expect(result.current.selection).toMatchObject({ filePath: 'a.md', previewType: 'file', readOnly: true })

    act(() => result.current.closeFilePreview())

    expect(result.current.selection).toBe(prior)
  })

  it('restores the original non-file pane with one Back after the same attachment is previewed again', async () => {
    // Bug: repeating the attachment replaces the non-file return target, so one Back stays on the file pane.
    vi.mocked(ipcApi.request).mockResolvedValue({ kind: 'file' })
    panelState.activePanelId = 'status'
    panelState.presentationOpen = true
    const { result } = renderHook(() => {
      const [selection, setSelection] = useState<ArtifactPaneFileSelection | null>(null)
      const navigation = useArtifactPanePreviewNavigation({
        paneId: 'files',
        previewFileSelection: selection,
        requestFileSelection: (nextSelection, onAccepted) => {
          setSelection(nextSelection)
          onAccepted?.()
        },
        workspacePath: '/workspace'
      })
      return { selection, ...navigation }
    })

    const previewA = () => {
      result.current.previewInputFile({
        displayName: 'a.md',
        previewPath: '/workspace/a.md' as AbsoluteFilePath
      })
    }

    act(() => previewA())
    await waitFor(() => expect(result.current.selection?.filePath).toBe('a.md'))
    expect(panelActions.requestOpen).toHaveBeenCalledWith('files', { userInitiated: true })
    panelState.activePanelId = 'files'

    panelActions.requestOpen.mockClear()
    act(() => previewA())
    await waitFor(() => expect(panelActions.requestOpen).toHaveBeenCalledWith('files', { userInitiated: true }))
    panelActions.requestOpen.mockClear()
    act(() => previewA())
    await waitFor(() => expect(panelActions.requestOpen).toHaveBeenCalledWith('files', { userInitiated: true }))
    expect(result.current.selection?.filePath).toBe('a.md')

    panelActions.requestOpen.mockClear()
    panelActions.close.mockClear()
    act(() => result.current.closeFilePreview())

    expect(result.current.selection).toBeNull()
    expect(panelActions.requestOpen).toHaveBeenCalledWith('status')
    expect(panelActions.close).not.toHaveBeenCalled()
  })
})
