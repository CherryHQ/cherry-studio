// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fileMocks = vi.hoisted(() => ({
  readExternal: vi.fn(),
  write: vi.fn()
}))

import { useArtifactFileEditor } from '../useArtifactFileEditor'

const selection = { workspacePath: '/ws', filePath: 'notes.txt' }
const otherSelection = { workspacePath: '/ws', filePath: 'other.txt' }

const initialContent = 'hello\n'

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { file: fileMocks }
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useArtifactFileEditor', () => {
  it('enters edit mode by loading the file content', async () => {
    fileMocks.readExternal.mockResolvedValueOnce(initialContent)
    const { result } = renderHook(() => useArtifactFileEditor())

    await act(async () => {
      await result.current.setMode(selection, 'edit')
    })

    expect(fileMocks.readExternal).toHaveBeenCalledWith('/ws/notes.txt')
    expect(result.current.getSession(selection)).toMatchObject({
      mode: 'edit',
      status: 'ready',
      draft: 'hello\n',
      savedContent: 'hello\n'
    })
    expect(result.current.hasUnsavedChanges).toBe(false)
  })

  it('saves a dirty draft through the existing file writer and records the new content', async () => {
    fileMocks.readExternal.mockResolvedValueOnce(initialContent)
    const { result } = renderHook(() => useArtifactFileEditor())
    await act(async () => {
      await result.current.setMode(selection, 'edit')
    })
    act(() => result.current.updateDraft(selection, 'changed\n'))

    fileMocks.write.mockResolvedValueOnce(undefined)
    await act(async () => {
      await result.current.save(selection)
    })

    expect(fileMocks.write).toHaveBeenCalledWith('/ws/notes.txt', 'changed\n')
    expect(result.current.getSession(selection)).toMatchObject({
      status: 'ready',
      draft: 'changed\n',
      savedContent: 'changed\n'
    })
    expect(result.current.hasUnsavedChanges).toBe(false)
  })

  it('keeps the dirty draft ready for retry when saving fails', async () => {
    fileMocks.readExternal.mockResolvedValueOnce(initialContent)
    const { result } = renderHook(() => useArtifactFileEditor())
    await act(async () => {
      await result.current.setMode(selection, 'edit')
    })
    act(() => result.current.updateDraft(selection, 'draft'))

    const writeError = new Error('write failed')
    fileMocks.write.mockRejectedValueOnce(writeError)
    await expect(
      act(async () => {
        await result.current.save(selection)
      })
    ).rejects.toBe(writeError)

    expect(result.current.getSession(selection)).toMatchObject({
      status: 'ready',
      draft: 'draft',
      savedContent: 'hello\n'
    })
    expect(result.current.hasUnsavedChanges).toBe(true)
  })

  it('discard restores the last saved content', async () => {
    fileMocks.readExternal.mockResolvedValueOnce(initialContent)
    const { result } = renderHook(() => useArtifactFileEditor())
    await act(async () => {
      await result.current.setMode(selection, 'edit')
    })
    act(() => result.current.updateDraft(selection, 'draft'))

    act(() => result.current.discard(selection))

    expect(result.current.getSession(selection)).toMatchObject({ draft: 'hello\n', savedContent: 'hello\n' })
  })

  it('reload replaces the draft with fresh file content', async () => {
    fileMocks.readExternal.mockResolvedValueOnce(initialContent)
    const { result } = renderHook(() => useArtifactFileEditor())
    await act(async () => {
      await result.current.setMode(selection, 'edit')
    })
    act(() => result.current.updateDraft(selection, 'draft'))

    const newer = 'newer\n'
    fileMocks.readExternal.mockResolvedValueOnce(newer)
    await act(async () => {
      await result.current.reload(selection)
    })

    expect(result.current.getSession(selection)).toMatchObject({
      status: 'ready',
      draft: newer,
      savedContent: newer
    })
  })

  it('replaces the active session when another file loads', async () => {
    fileMocks.readExternal.mockResolvedValue(initialContent)
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
    expect(result.current.getSession(selection)).toMatchObject({ draft: 'hello\n' })
    expect(result.current.hasUnsavedChanges).toBe(false)
  })

  it('clears the active session and invalidates an outstanding load', async () => {
    let resolveLoad!: (value: string) => void
    fileMocks.readExternal.mockImplementationOnce(() => new Promise((resolve) => (resolveLoad = resolve)))
    const { result } = renderHook(() => useArtifactFileEditor())

    let load: Promise<void> | undefined
    act(() => {
      load = result.current.setMode(selection, 'edit')
    })
    act(() => result.current.clear())
    await act(async () => {
      resolveLoad(initialContent)
      await load
    })

    expect(result.current.getSession(selection)).toBeUndefined()
    expect(result.current.hasUnsavedChanges).toBe(false)
  })

  it('ignores a stale read response after a newer load starts', async () => {
    let resolveFirst!: (value: string) => void
    fileMocks.readExternal.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
    const { result } = renderHook(() => useArtifactFileEditor())

    let first: Promise<void> | undefined
    act(() => {
      first = result.current.setMode(selection, 'edit')
    })
    fileMocks.readExternal.mockResolvedValueOnce('second\n')
    await act(async () => {
      await result.current.reload(selection)
    })
    await act(async () => {
      resolveFirst('first\n')
      await first
    })

    expect(result.current.getSession(selection)).toMatchObject({ status: 'ready', draft: 'second\n' })
  })

  it('drops the session and rethrows when the initial load fails', async () => {
    const readError = new Error('read failed')
    fileMocks.readExternal.mockRejectedValueOnce(readError)
    const { result } = renderHook(() => useArtifactFileEditor())

    await expect(
      act(async () => {
        await result.current.setMode(selection, 'edit')
      })
    ).rejects.toBe(readError)

    expect(result.current.getSession(selection)).toBeUndefined()
  })
})
