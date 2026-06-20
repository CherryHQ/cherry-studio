import type {
  CreateTreeIpcResult,
  SerializedTreeNode,
  TreeMutationEvent,
  TreeMutationPushPayload
} from '@shared/utils/file'
import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDirectoryTree } from '../useDirectoryTree'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  dispose: vi.fn(),
  onMutation: vi.fn()
}))

beforeEach(() => {
  mocks.create.mockReset()
  mocks.dispose.mockReset()
  mocks.onMutation.mockReset()
  ;(globalThis as { window: typeof window }).window = globalThis.window ?? ({} as Window)
  Object.assign(globalThis.window, {
    api: {
      tree: {
        create: mocks.create,
        dispose: mocks.dispose.mockResolvedValue(undefined),
        onMutation: mocks.onMutation
      }
    }
  })
})

afterEach(() => {
  vi.useRealTimers()
})

function makeSnapshot(rootPath: string, files: string[]): SerializedTreeNode {
  const root: SerializedTreeNode = { kind: 'directory', path: rootPath, basename: rootPath, children: {} }
  for (const f of files) {
    ;(root.children as Record<string, SerializedTreeNode>)[f] = {
      kind: 'file',
      path: `${rootPath}/${f}`,
      basename: f
    }
  }
  return root
}

describe('useDirectoryTree', () => {
  it('returns the initial snapshot once File_TreeCreate resolves', async () => {
    const snapshot = makeSnapshot('/notes', ['a.md', 'b.md'])
    mocks.create.mockResolvedValue({ treeId: 't-1', snapshot })
    mocks.onMutation.mockReturnValue(() => {})

    const { result } = renderHook(() => useDirectoryTree('/notes'))

    await waitFor(() => {
      expect(result.current.root).not.toBeNull()
    })
    expect(result.current.root?.hasChild('a.md')).toBe(true)
    expect(result.current.root?.hasChild('b.md')).toBe(true)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('applies added/removed mutations from the push stream', async () => {
    const snapshot = makeSnapshot('/notes', ['existing.md'])
    mocks.create.mockResolvedValue({ treeId: 't-2', snapshot })
    let pushListener: ((payload: TreeMutationPushPayload) => void) | null = null
    mocks.onMutation.mockImplementation((cb) => {
      pushListener = cb
      return () => {
        pushListener = null
      }
    })

    const { result } = renderHook(() => useDirectoryTree('/notes'))

    await waitFor(() => {
      expect(result.current.root).not.toBeNull()
    })

    expect(pushListener).toBeTruthy()

    const addedEvent: TreeMutationEvent = {
      type: 'added',
      kind: 'file',
      path: '/notes/new.md',
      basename: 'new.md',
      parentPath: '/notes'
    }
    act(() => {
      pushListener?.({ treeId: 't-2', event: addedEvent })
    })
    expect(result.current.root?.hasChild('new.md')).toBe(true)

    const removedEvent: TreeMutationEvent = { type: 'removed', path: '/notes/existing.md' }
    act(() => {
      pushListener?.({ treeId: 't-2', event: removedEvent })
    })
    expect(result.current.root?.hasChild('existing.md')).toBe(false)
  })

  it('applies a renamed mutation by mutating the existing node identity', async () => {
    const snapshot = makeSnapshot('/notes', ['old.md'])
    mocks.create.mockResolvedValue({ treeId: 't-rename', snapshot })
    let pushListener: ((payload: TreeMutationPushPayload) => void) | null = null
    mocks.onMutation.mockImplementation((cb) => {
      pushListener = cb
      return () => {
        pushListener = null
      }
    })

    const { result } = renderHook(() => useDirectoryTree('/notes'))
    await waitFor(() => {
      expect(result.current.root).not.toBeNull()
    })

    const beforeNode = result.current.getNode('/notes/old.md')
    expect(beforeNode).not.toBeNull()
    expect(beforeNode?.basename).toBe('old.md')

    const renamedEvent: TreeMutationEvent = {
      type: 'renamed',
      oldPath: '/notes/old.md',
      newPath: '/notes/renamed.md',
      basename: 'renamed.md'
    }
    act(() => {
      pushListener?.({ treeId: 't-rename', event: renamedEvent })
    })

    // Identity preserved through the rename.
    const afterNode = result.current.getNode('/notes/renamed.md')
    expect(afterNode).toBe(beforeNode)
    expect(afterNode?.path).toBe('/notes/renamed.md')
    expect(afterNode?.basename).toBe('renamed.md')
    // Old key gone from index + parent's _children.
    expect(result.current.getNode('/notes/old.md')).toBeNull()
    expect(result.current.root?.hasChild('old.md')).toBe(false)
    expect(result.current.root?.hasChild('renamed.md')).toBe(true)
  })

  it('disposes the tree on unmount', async () => {
    mocks.create.mockResolvedValue({ treeId: 't-3', snapshot: makeSnapshot('/notes', []) })
    const unsub = vi.fn()
    mocks.onMutation.mockReturnValue(unsub)

    const { unmount, result } = renderHook(() => useDirectoryTree('/notes'))

    await waitFor(() => {
      expect(result.current.root).not.toBeNull()
    })

    unmount()
    expect(unsub).toHaveBeenCalled()
    expect(mocks.dispose).toHaveBeenCalledWith('t-3')
  })

  it('returns null root when no rootPath is supplied', () => {
    const { result } = renderHook(() => useDirectoryTree(undefined))
    expect(result.current.root).toBeNull()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('disposes the in-flight builder when rootPath changes before File_TreeCreate resolves', async () => {
    let resolveFirst: ((value: CreateTreeIpcResult) => void) | null = null
    mocks.create.mockImplementationOnce(
      () =>
        new Promise<CreateTreeIpcResult>((resolve) => {
          resolveFirst = resolve
        })
    )
    mocks.create.mockResolvedValueOnce({ treeId: 't-second', snapshot: makeSnapshot('/notes2', []) })
    mocks.onMutation.mockReturnValue(() => {})

    const { rerender, result } = renderHook(({ root }: { root: string | undefined }) => useDirectoryTree(root), {
      initialProps: { root: '/notes' as string | undefined }
    })

    // Swap rootPath while the first File_TreeCreate is still pending. The hook's
    // cleanup sets `cancelled=true`; once the first promise finally resolves it
    // must dispose the orphaned builder rather than swap it in.
    rerender({ root: '/notes2' as string | undefined })

    await act(async () => {
      resolveFirst?.({ treeId: 't-first', snapshot: makeSnapshot('/notes', []) })
    })

    await waitFor(() => {
      expect(result.current.treeId).toBe('t-second')
    })

    expect(mocks.dispose).toHaveBeenCalledWith('t-first')
  })

  it('does not call setError when File_TreeCreate rejects after unmount', async () => {
    let rejectCreate: ((err: Error) => void) | null = null
    mocks.create.mockImplementationOnce(
      () =>
        new Promise<CreateTreeIpcResult>((_resolve, reject) => {
          rejectCreate = reject
        })
    )
    mocks.onMutation.mockReturnValue(() => {})

    const { unmount, result } = renderHook(() => useDirectoryTree('/notes'))
    expect(result.current.isLoading).toBe(true)

    unmount()

    // Rejecting after the cleanup ran must not trigger any state update
    // on the unmounted hook. React would log an act() warning if it did.
    await act(async () => {
      rejectCreate?.(new Error('post-unmount reject'))
      await Promise.resolve()
    })

    // The hook never got a treeId, so dispose should not have been called.
    expect(mocks.dispose).not.toHaveBeenCalled()
  })

  it('disposes the first tree under React StrictMode mount-unmount-mount', async () => {
    mocks.create
      .mockResolvedValueOnce({ treeId: 't-strict-1', snapshot: makeSnapshot('/notes', []) })
      .mockResolvedValueOnce({ treeId: 't-strict-2', snapshot: makeSnapshot('/notes', []) })
    const unsub1 = vi.fn()
    const unsub2 = vi.fn()
    mocks.onMutation.mockReturnValueOnce(unsub1).mockReturnValueOnce(unsub2)

    const { result } = renderHook(() => useDirectoryTree('/notes'), { wrapper: StrictMode })

    await waitFor(() => {
      expect(result.current.treeId).toBe('t-strict-2')
    })

    // StrictMode's discarded mount must hand back its treeId, not leak it.
    expect(mocks.dispose).toHaveBeenCalledWith('t-strict-1')
  })

  it('ignores File_TreeMutation payloads whose treeId does not match', async () => {
    mocks.create.mockResolvedValue({ treeId: 'live-tree', snapshot: makeSnapshot('/notes', ['a.md']) })
    let pushListener: ((payload: TreeMutationPushPayload) => void) | null = null
    mocks.onMutation.mockImplementation((cb) => {
      pushListener = cb
      return () => {
        pushListener = null
      }
    })

    const { result } = renderHook(() => useDirectoryTree('/notes'))
    await waitFor(() => {
      expect(result.current.root).not.toBeNull()
    })

    const baselineVersion = result.current.version
    const strayEvent: TreeMutationEvent = {
      type: 'added',
      kind: 'file',
      path: '/notes/stray.md',
      basename: 'stray.md',
      parentPath: '/notes'
    }
    act(() => {
      pushListener?.({ treeId: 'other-tree', event: strayEvent })
    })

    expect(result.current.version).toBe(baselineVersion)
    expect(result.current.root?.hasChild('stray.md')).toBe(false)
  })
})
