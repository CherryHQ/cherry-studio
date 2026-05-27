import type { SerializedTreeNode, TreeMutationEvent, TreeMutationPushPayload } from '@shared/file/types'
import { act, renderHook, waitFor } from '@testing-library/react'
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
  it('returns the initial snapshot once Tree_Create resolves', async () => {
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
})
