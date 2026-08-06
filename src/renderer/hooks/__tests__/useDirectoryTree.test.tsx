import { loggerService } from '@logger'
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
  activate: vi.fn(),
  dispose: vi.fn(),
  onMutation: vi.fn()
}))

// The hook talks to `file.tree.*` over IpcApi; route each one to its own mock so
// the assertions below stay per-operation rather than matching on route strings.
vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (route: string, input: { treeId?: string; revision?: number; rootPath?: string; options?: unknown }) => {
      if (route === 'file.tree.create') return mocks.create(input.rootPath, input.options)
      if (route === 'file.tree.activate') return mocks.activate(input.treeId, input.revision)
      if (route === 'file.tree.dispose') return mocks.dispose(input.treeId)
      throw new Error(`Unexpected route ${route}`)
    },
    on: (event: string, callback: unknown) => {
      if (event !== 'file.tree.mutation') throw new Error(`Unexpected event ${event}`)
      return mocks.onMutation(callback)
    }
  }
}))

beforeEach(() => {
  mocks.create.mockReset()
  mocks.activate.mockReset().mockResolvedValue(true)
  mocks.dispose.mockReset().mockResolvedValue(undefined)
  mocks.onMutation.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
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
  it('returns the initial snapshot once file.tree.create resolves', async () => {
    const snapshot = makeSnapshot('/notes', ['a.md', 'b.md'])
    mocks.create.mockResolvedValue({ treeId: 't-1', revision: 0, snapshot })
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
    mocks.create.mockResolvedValue({ treeId: 't-2', revision: 0, snapshot })
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
      pushListener?.({ treeId: 't-2', revision: 1, event: addedEvent })
    })
    expect(result.current.root?.hasChild('new.md')).toBe(true)

    const removedEvent: TreeMutationEvent = { type: 'removed', path: '/notes/existing.md' }
    act(() => {
      pushListener?.({ treeId: 't-2', revision: 2, event: removedEvent })
    })
    expect(result.current.root?.hasChild('existing.md')).toBe(false)
  })

  it('applies a renamed mutation by mutating the existing node identity', async () => {
    const snapshot = makeSnapshot('/notes', ['old.md'])
    mocks.create.mockResolvedValue({ treeId: 't-rename', revision: 0, snapshot })
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
      pushListener?.({ treeId: 't-rename', revision: 1, event: renamedEvent })
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
    mocks.create.mockResolvedValue({ treeId: 't-3', revision: 0, snapshot: makeSnapshot('/notes', []) })
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

  it('disposes the in-flight builder when rootPath changes before file.tree.create resolves', async () => {
    let resolveFirst: ((value: CreateTreeIpcResult) => void) | null = null
    mocks.create.mockImplementationOnce(
      () =>
        new Promise<CreateTreeIpcResult>((resolve) => {
          resolveFirst = resolve
        })
    )
    mocks.create.mockResolvedValueOnce({ treeId: 't-second', revision: 0, snapshot: makeSnapshot('/notes2', []) })
    mocks.onMutation.mockReturnValue(() => {})

    const { rerender, result } = renderHook(({ root }: { root: string | undefined }) => useDirectoryTree(root), {
      initialProps: { root: '/notes' as string | undefined }
    })

    // Swap rootPath while the first file.tree.create is still pending. The hook's
    // cleanup sets `cancelled=true`; once the first promise finally resolves it
    // must dispose the orphaned builder rather than swap it in.
    rerender({ root: '/notes2' as string | undefined })

    await act(async () => {
      resolveFirst?.({ treeId: 't-first', revision: 0, snapshot: makeSnapshot('/notes', []) })
    })

    await waitFor(() => {
      expect(result.current.treeId).toBe('t-second')
    })

    expect(mocks.dispose).toHaveBeenCalledWith('t-first')
  })

  it('does not expose the previous root while the next root loads', async () => {
    let resolveSecond: ((value: CreateTreeIpcResult) => void) | null = null
    mocks.create
      .mockResolvedValueOnce({ treeId: 't-first', revision: 0, snapshot: makeSnapshot('/notes', ['a.md']) })
      .mockImplementationOnce(
        () =>
          new Promise<CreateTreeIpcResult>((resolve) => {
            resolveSecond = resolve
          })
      )
    mocks.onMutation.mockReturnValue(() => {})

    const { rerender, result } = renderHook(({ root }: { root: string }) => useDirectoryTree(root), {
      initialProps: { root: '/notes' }
    })
    await waitFor(() => {
      expect(result.current.root?.path).toBe('/notes')
    })

    rerender({ root: '/notes2' })

    expect(result.current.root).toBeNull()
    expect(result.current.treeId).toBeNull()
    expect(result.current.getNode('/notes/a.md')).toBeNull()
    expect(result.current.isLoading).toBe(true)

    await act(async () => {
      resolveSecond?.({ treeId: 't-second', revision: 0, snapshot: makeSnapshot('/notes2', []) })
    })
    await waitFor(() => {
      expect(result.current.root?.path).toBe('/notes2')
    })
    expect(result.current.root?.children).toEqual({})
  })

  it('does not retain the previous root when the next root fails to load', async () => {
    const nextError = new Error('notes2 failed')
    const errorSpy = vi.spyOn(loggerService, 'error').mockImplementation(() => undefined)
    let resolveThird: ((value: CreateTreeIpcResult) => void) | null = null
    mocks.create
      .mockResolvedValueOnce({ treeId: 't-first', revision: 0, snapshot: makeSnapshot('/notes', ['a.md']) })
      .mockRejectedValueOnce(nextError)
      .mockImplementationOnce(
        () =>
          new Promise<CreateTreeIpcResult>((resolve) => {
            resolveThird = resolve
          })
      )
    mocks.onMutation.mockReturnValue(() => {})

    const { rerender, result } = renderHook(({ root }: { root: string }) => useDirectoryTree(root), {
      initialProps: { root: '/notes' }
    })
    await waitFor(() => {
      expect(result.current.root?.path).toBe('/notes')
    })

    rerender({ root: '/notes2' })

    await waitFor(() => {
      expect(result.current.error).toBe(nextError)
    })
    expect(result.current.root).toBeNull()
    expect(result.current.treeId).toBeNull()
    expect(result.current.getNode('/notes/a.md')).toBeNull()
    expect(errorSpy).toHaveBeenCalledWith('Failed to create directory tree for /notes2', nextError)

    rerender({ root: '/notes' })

    expect(result.current.root).toBeNull()
    expect(result.current.treeId).toBeNull()
    expect(result.current.error).toBeNull()
    expect(result.current.isLoading).toBe(true)

    await act(async () => {
      resolveThird?.({ treeId: 't-third', revision: 0, snapshot: makeSnapshot('/notes', []) })
    })
    await waitFor(() => {
      expect(result.current.treeId).toBe('t-third')
    })
  })

  it('does not call setError when file.tree.create rejects after unmount', async () => {
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
      .mockResolvedValueOnce({ treeId: 't-strict-1', revision: 0, snapshot: makeSnapshot('/notes', []) })
      .mockResolvedValueOnce({ treeId: 't-strict-2', revision: 0, snapshot: makeSnapshot('/notes', []) })
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

  it('ignores file.tree.mutation payloads whose treeId does not match', async () => {
    mocks.create.mockResolvedValue({ treeId: 'live-tree', revision: 0, snapshot: makeSnapshot('/notes', ['a.md']) })
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
      pushListener?.({ treeId: 'other-tree', revision: 1, event: strayEvent })
    })

    expect(result.current.version).toBe(baselineVersion)
    expect(result.current.root?.hasChild('stray.md')).toBe(false)
  })

  it('applies a mutation delivered during activation after the snapshot', async () => {
    mocks.create.mockResolvedValue({ treeId: 't-handoff', revision: 4, snapshot: makeSnapshot('/notes', []) })
    let pushListener: ((payload: TreeMutationPushPayload) => void) | null = null
    mocks.onMutation.mockImplementation((cb) => {
      pushListener = cb
      return () => {
        pushListener = null
      }
    })
    mocks.activate.mockImplementation(async () => {
      pushListener?.({
        treeId: 't-handoff',
        revision: 5,
        event: {
          type: 'added',
          kind: 'file',
          path: '/notes/generated.md',
          basename: 'generated.md',
          parentPath: '/notes'
        }
      })
      return true
    })

    const { result } = renderHook(() => useDirectoryTree('/notes'))

    await waitFor(() => {
      expect(result.current.root?.hasChild('generated.md')).toBe(true)
    })
    expect(mocks.activate).toHaveBeenCalledWith('t-handoff', 4)
  })

  it('forwards a mutation replayed during activation to the side-consumer callback', async () => {
    // A side consumer cannot subscribe on its own before `treeId` is published,
    // which happens only after `activate` has flushed the buffered mutations — so
    // an external edit in that window would otherwise never reach it.
    const onMutation = vi.fn()
    const updatedEvent: TreeMutationEvent = {
      type: 'updated',
      path: '/notes/watched.md',
      stats: { mtime: 42, birthtime: 1 }
    }
    mocks.create.mockResolvedValue({
      treeId: 't-side',
      revision: 7,
      snapshot: makeSnapshot('/notes', ['watched.md'])
    })
    let pushListener: ((payload: TreeMutationPushPayload) => void) | null = null
    mocks.onMutation.mockImplementation((cb) => {
      pushListener = cb
      return () => {
        pushListener = null
      }
    })
    mocks.activate.mockImplementation(async () => {
      pushListener?.({ treeId: 't-side', revision: 8, event: updatedEvent })
      return true
    })

    const { result } = renderHook(() => useDirectoryTree('/notes', undefined, onMutation))

    await waitFor(() => {
      expect(result.current.treeId).toBe('t-side')
    })
    expect(onMutation).toHaveBeenCalledWith(updatedEvent)
  })

  it('does not forward another tree’s mutations to the side-consumer callback', async () => {
    const onMutation = vi.fn()
    mocks.create.mockResolvedValue({ treeId: 't-own', revision: 0, snapshot: makeSnapshot('/notes', []) })
    let pushListener: ((payload: TreeMutationPushPayload) => void) | null = null
    mocks.onMutation.mockImplementation((cb) => {
      pushListener = cb
      return () => {
        pushListener = null
      }
    })

    const { result } = renderHook(() => useDirectoryTree('/notes', undefined, onMutation))
    await waitFor(() => {
      expect(result.current.root).not.toBeNull()
    })

    act(() => {
      pushListener?.({
        treeId: 'other-tree',
        revision: 1,
        event: { type: 'updated', path: '/notes/stray.md', stats: { mtime: 1, birthtime: 1 } }
      })
    })

    expect(onMutation).not.toHaveBeenCalled()
  })

  it('reports a forward revision gap instead of applying a stale stream', async () => {
    const errorSpy = vi.spyOn(loggerService, 'error').mockImplementation(() => undefined)
    mocks.create.mockResolvedValue({ treeId: 't-gap', revision: 2, snapshot: makeSnapshot('/notes', []) })
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

    act(() => {
      pushListener?.({
        treeId: 't-gap',
        revision: 4,
        event: {
          type: 'added',
          kind: 'file',
          path: '/notes/skipped.md',
          basename: 'skipped.md',
          parentPath: '/notes'
        }
      })
    })

    await waitFor(() => {
      expect(result.current.error?.message).toContain('expected 3, received 4')
    })
    expect(result.current.root).toBeNull()
    expect(result.current.getNode('/notes/skipped.md')).toBeNull()
    expect(errorSpy).toHaveBeenCalledWith('Directory tree mutation stream became stale for /notes', expect.any(Error))
  })

  it('tears the stream down on a revision gap instead of re-reporting every later push', async () => {
    vi.spyOn(loggerService, 'error').mockImplementation(() => undefined)
    mocks.create.mockResolvedValue({ treeId: 't-gap-once', revision: 2, snapshot: makeSnapshot('/notes', ['a.md']) })
    const unsubscribe = vi.fn()
    // Held past `unsubscribe` on purpose, so the test can keep pushing and prove
    // later payloads are inert rather than merely undeliverable.
    let listener: ((payload: TreeMutationPushPayload) => void) | null = null
    mocks.onMutation.mockImplementation((cb) => {
      listener = cb
      return unsubscribe
    })

    const { result } = renderHook(() => useDirectoryTree('/notes'))
    await waitFor(() => {
      expect(result.current.treeId).toBe('t-gap-once')
    })

    const push = (revision: number) =>
      act(() => {
        listener?.({ treeId: 't-gap-once', revision, event: { type: 'removed', path: '/notes/a.md' } })
      })

    push(4)
    await waitFor(() => {
      expect(result.current.error).not.toBeNull()
    })
    const firstError = result.current.error

    // A gap is unrecoverable, so the stream and the main-side tree are released.
    // Staying subscribed would re-gap on every push — a fresh Error each time, which
    // consumers that toast on `error` turn into an unbounded run of toasts.
    expect(unsubscribe).toHaveBeenCalled()
    expect(mocks.dispose).toHaveBeenCalledWith('t-gap-once')
    expect(result.current.root).toBeNull()
    expect(result.current.treeId).toBeNull()

    push(5)
    push(6)
    expect(result.current.error).toBe(firstError)
    expect(mocks.dispose).toHaveBeenCalledTimes(1)
  })
})
