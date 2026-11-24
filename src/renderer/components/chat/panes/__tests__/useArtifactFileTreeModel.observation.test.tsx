import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { SerializedTreeNode } from '@shared/utils/file'

import { useArtifactFileTreeModel } from '../useArtifactFileTreeModel'
const originalApi = window.api

const disk = vi.hoisted(() => ({ files: ['old.txt'], nextId: 0 }))
vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: async (route: string, input: { rootPath: string }) => {
      if (route === 'file.tree.activate') return true
      if (route === 'file.tree.dispose') return
      if (route !== 'file.tree.create') throw new Error(route)
      const root = input.rootPath
      const children: Record<string, SerializedTreeNode> = {}
      if (root === '/workspace')
        children.src = { kind: 'directory', path: `${root}/src`, basename: 'src', children: {} }
      else for (const name of disk.files) children[name] = { kind: 'file', path: `${root}/${name}`, basename: name }
      return {
        treeId: `tree-${++disk.nextId}`,
        revision: 0,
        snapshot: { kind: 'directory', path: root, basename: root, children }
      }
    },
    on: () => () => {}
  }
}))

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  disk.files = ['old.txt']
  vi.stubGlobal('api', {
    ...originalApi,
    file: {
      ...originalApi?.file,
      listDirectoryEntries: async () =>
        disk.files.map((name) => ({ path: `/workspace/src/${name}`, isDirectory: false }))
    }
  })
})

afterEach(async () => {
  cleanup()
  await vi.runOnlyPendingTimersAsync()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('replaces stale children after a collapsed directory changes without a later filesystem event', async () => {
  const { result, rerender } = renderHook(
    ({ expandedIds }) =>
      useArtifactFileTreeModel({
        workspacePath: '/workspace',
        treeOpen: true,
        expandedIds,
        searchKeyword: '',
        enableFileSearch: false,
        selectedFile: null,
        onExpandedIdsChange: () => {}
      }),
    { initialProps: { expandedIds: new Set(['src']) } }
  )
  await waitFor(() => expect(result.current.nodeById.has('src/old.txt')).toBe(true))
  rerender({ expandedIds: new Set() })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(11_000)
  })
  disk.files = ['new.txt']
  rerender({ expandedIds: new Set(['src']) })
  await waitFor(() => expect(result.current.nodeById.has('src/new.txt')).toBe(true))
  expect(result.current.nodeById.has('src/old.txt')).toBe(false)
})

it('refreshes expanded children and an active search without changing the expansion or query', async () => {
  const expanded = new Set(['src'])
  const { result } = renderHook(() =>
    useArtifactFileTreeModel({
      workspacePath: '/workspace',
      treeOpen: true,
      expandedIds: expanded,
      searchKeyword: 'txt',
      enableFileSearch: true,
      selectedFile: null,
      onExpandedIdsChange: () => {}
    })
  )
  await waitFor(() => expect(result.current.nodeById.has('src/old.txt')).toBe(true))
  disk.files = ['new.txt']
  await act(async () => {
    await result.current.refresh()
  })
  expect(result.current.nodeById.has('src/new.txt')).toBe(true)
  expect(result.current.nodeById.has('src/old.txt')).toBe(false)
  expect(result.current.effectiveExpandedIds.has('src')).toBe(true)
})
