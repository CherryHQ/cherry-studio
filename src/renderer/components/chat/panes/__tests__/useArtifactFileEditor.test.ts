// @vitest-environment jsdom
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const ipcMocks = vi.hoisted(() => ({
  request: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: ipcMocks
}))

import { useArtifactFileEditor } from '../useArtifactFileEditor'

const selection = { workspacePath: '/ws', filePath: 'notes.txt' }
const otherSelection = { workspacePath: '/ws', filePath: 'other.txt' }

const snapshot = {
  content: 'hello\n',
  version: { mtime: 1_000, size: 6 },
  contentHash: '0123456789abcdef',
  lineEnding: 'lf' as const,
  hasBom: false
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useArtifactFileEditor', () => {
  it('enters edit mode by loading an editable snapshot', async () => {
    ipcMocks.request.mockResolvedValueOnce(snapshot)
    const { result } = renderHook(() => useArtifactFileEditor())

    await act(async () => {
      await result.current.setMode(selection, 'edit')
    })

    expect(ipcMocks.request).toHaveBeenCalledWith('file.read_text_snapshot', { kind: 'path', path: '/ws/notes.txt' })
    expect(result.current.getSession(selection)).toMatchObject({
      filePath: '/ws/notes.txt',
      mode: 'edit',
      status: 'ready',
      draft: 'hello\n',
      savedContent: 'hello\n',
      version: snapshot.version,
      contentHash: snapshot.contentHash,
      lineEnding: 'lf',
      hasBom: false
    })
    expect(result.current.session).toBe(result.current.getSession(selection))
    expect(result.current.hasUnsavedChanges).toBe(false)
  })

  it('saves a dirty draft with the snapshot version and records the new one', async () => {
    ipcMocks.request.mockResolvedValueOnce(snapshot)
    const { result } = renderHook(() => useArtifactFileEditor())
    await act(async () => {
      await result.current.setMode(selection, 'edit')
    })
    act(() => result.current.updateDraft(selection, 'changed\n'))

    const saved = { version: { mtime: 2_000, size: 8 }, contentHash: 'fedcba9876543210' }
    ipcMocks.request.mockResolvedValueOnce(saved)
    await act(async () => {
      await result.current.save(selection)
    })

    expect(ipcMocks.request).toHaveBeenLastCalledWith('file.write_text_if_unchanged', {
      handle: { kind: 'path', path: '/ws/notes.txt' },
      content: 'changed\n',
      lineEnding: 'lf',
      hasBom: false,
      expectedVersion: snapshot.version,
      expectedContentHash: snapshot.contentHash
    })
    expect(result.current.getSession(selection)).toMatchObject({
      status: 'ready',
      draft: 'changed\n',
      savedContent: 'changed\n',
      version: saved.version,
      contentHash: saved.contentHash
    })
    expect(result.current.hasUnsavedChanges).toBe(false)
  })

  it('keeps the dirty draft in conflict state when the file changed on disk', async () => {
    ipcMocks.request.mockResolvedValueOnce(snapshot)
    const { result } = renderHook(() => useArtifactFileEditor())
    await act(async () => {
      await result.current.setMode(selection, 'edit')
    })
    act(() => result.current.updateDraft(selection, 'draft'))

    const stale = new IpcError(fileErrorCodes.TEXT_EDIT_STALE, 'stale')
    ipcMocks.request.mockRejectedValueOnce(stale)
    await expect(
      act(async () => {
        await result.current.save(selection)
      })
    ).rejects.toBe(stale)

    expect(result.current.getSession(selection)).toMatchObject({
      status: 'conflict',
      draft: 'draft',
      savedContent: 'hello\n'
    })
    expect(result.current.hasUnsavedChanges).toBe(true)
  })

  it('discard restores the last saved content', async () => {
    ipcMocks.request.mockResolvedValueOnce(snapshot)
    const { result } = renderHook(() => useArtifactFileEditor())
    await act(async () => {
      await result.current.setMode(selection, 'edit')
    })
    act(() => result.current.updateDraft(selection, 'draft'))

    act(() => result.current.discard(selection))

    expect(result.current.getSession(selection)).toMatchObject({ draft: 'hello\n', savedContent: 'hello\n' })
  })

  it('reload replaces the draft with a fresh snapshot', async () => {
    ipcMocks.request.mockResolvedValueOnce(snapshot)
    const { result } = renderHook(() => useArtifactFileEditor())
    await act(async () => {
      await result.current.setMode(selection, 'edit')
    })
    act(() => result.current.updateDraft(selection, 'draft'))

    const newer = {
      ...snapshot,
      content: 'newer\n',
      version: { mtime: 3_000, size: 6 },
      contentHash: '1111111111111111'
    }
    ipcMocks.request.mockResolvedValueOnce(newer)
    await act(async () => {
      await result.current.reload(selection)
    })

    expect(result.current.getSession(selection)).toMatchObject({
      status: 'ready',
      draft: 'newer\n',
      savedContent: 'newer\n',
      version: newer.version,
      contentHash: newer.contentHash
    })
  })

  it('replaces the active session when another file loads', async () => {
    ipcMocks.request.mockResolvedValue(snapshot)
    const { result } = renderHook(() => useArtifactFileEditor())
    await act(async () => {
      await result.current.setMode(selection, 'edit')
    })
    await act(async () => {
      await result.current.setMode(otherSelection, 'edit')
    })
    expect(result.current.getSession(selection)).toBeUndefined()

    act(() => result.current.updateDraft(otherSelection, 'dirty'))
    expect(result.current.hasUnsavedChanges).toBe(true)
    await act(async () => {
      await result.current.setMode(selection, 'edit')
    })
    expect(result.current.getSession(otherSelection)).toBeUndefined()
    expect(result.current.session).toMatchObject({ filePath: '/ws/notes.txt', draft: 'hello\n' })
    expect(result.current.hasUnsavedChanges).toBe(false)
  })

  it('clears the active session and invalidates an outstanding load', async () => {
    let resolveLoad!: (value: typeof snapshot) => void
    ipcMocks.request.mockImplementationOnce(() => new Promise((resolve) => (resolveLoad = resolve)))
    const { result } = renderHook(() => useArtifactFileEditor())

    let load: Promise<void> | undefined
    act(() => {
      load = result.current.setMode(selection, 'edit')
    })
    act(() => result.current.clear())
    await act(async () => {
      resolveLoad(snapshot)
      await load
    })

    expect(result.current.session).toBeUndefined()
    expect(result.current.hasUnsavedChanges).toBe(false)
  })

  it('ignores a stale snapshot response after a newer load starts', async () => {
    let resolveFirst!: (value: typeof snapshot) => void
    ipcMocks.request.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
    const { result } = renderHook(() => useArtifactFileEditor())

    let first: Promise<void> | undefined
    act(() => {
      first = result.current.setMode(selection, 'edit')
    })
    ipcMocks.request.mockResolvedValueOnce({ ...snapshot, content: 'second\n' })
    await act(async () => {
      await result.current.reload(selection)
    })
    await act(async () => {
      resolveFirst({ ...snapshot, content: 'first\n' })
      await first
    })

    expect(result.current.getSession(selection)).toMatchObject({ status: 'ready', draft: 'second\n' })
  })

  it('drops the session and rethrows when the initial load fails', async () => {
    const unsupported = new IpcError(fileErrorCodes.TEXT_EDIT_UNSUPPORTED, 'unsupported')
    ipcMocks.request.mockRejectedValueOnce(unsupported)
    const { result } = renderHook(() => useArtifactFileEditor())

    await expect(
      act(async () => {
        await result.current.setMode(selection, 'edit')
      })
    ).rejects.toBe(unsupported)

    expect(result.current.getSession(selection)).toBeUndefined()
  })

  it('clears the active session when the reset key changes', async () => {
    ipcMocks.request.mockResolvedValueOnce(snapshot)
    const { result, rerender } = renderHook(({ resetKey }) => useArtifactFileEditor(resetKey), {
      initialProps: { resetKey: 'ws-a' }
    })
    await act(async () => {
      await result.current.setMode(selection, 'edit')
    })
    expect(result.current.getSession(selection)).toBeDefined()

    rerender({ resetKey: 'ws-b' })

    expect(result.current.getSession(selection)).toBeUndefined()
  })
})
