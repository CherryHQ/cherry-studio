// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { type ReactNode, useEffect } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: ipc }))

import { UnsupportedFileTextError } from '@renderer/utils/fileTextSnapshot'
import type { FileHandle } from '@shared/data/types/file'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { AbsoluteFilePath } from '@shared/types/file'

import { type FileEditSession, useFileEditSession } from '../useFileEditSession'

const A: FileHandle = { kind: 'path', path: '/notes/a.md' as AbsoluteFilePath }
const B: FileHandle = { kind: 'path', path: '/notes/b.md' as AbsoluteFilePath }
const bytes = (text: string) => new TextEncoder().encode(text)
const read = (text: string, mtime = 1) => ({
  content: bytes(text),
  mime: 'text/markdown',
  version: { mtime, size: bytes(text).byteLength }
})
const writes = () => ipc.request.mock.calls.filter(([route]) => route === 'file.write_if_unchanged')
const neutral = {
  status: 'loading',
  draft: '',
  savedContent: '',
  savedSizeBytes: undefined,
  saveError: undefined,
  isDirty: false,
  isSaving: false,
  conflict: false,
  metadataRecoveryPending: false
}

function harness() {
  const cache = new Map()
  const commits: { handle: FileHandle | undefined; session: FileEditSession }[] = []
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>{children}</SWRConfig>
  )
  const hook = renderHook(
    ({ handle }: { handle: FileHandle | undefined }) => {
      const session = useFileEditSession(handle)
      useEffect(() => {
        commits.push({ handle, session })
      })
      return session
    },
    { initialProps: { handle: A as FileHandle | undefined }, wrapper }
  )
  return { ...hook, commits }
}

const ready = async (hook: ReturnType<typeof harness>, content: string) => {
  await waitFor(() => expect(hook.result.current.status).toBe('ready'))
  expect(hook.result.current).toMatchObject({ draft: content, savedContent: content, isDirty: false })
}

beforeEach(() => {
  ipc.request.mockReset()
  ipc.request.mockImplementation((route, input) => {
    if (route === 'file.read') return Promise.resolve(read(input.handle.path === A.path ? 'A body' : 'B body'))
    return Promise.resolve({ mtime: 2, size: input.data.byteLength })
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('file edit session ownership', () => {
  it('never commits A mirrors as ready on a cached B read', async () => {
    const hook = harness()
    await ready(hook, 'A body')
    hook.rerender({ handle: B })
    await ready(hook, 'B body')
    hook.rerender({ handle: A })
    await ready(hook, 'A body')
    const checkpoint = hook.commits.length
    hook.rerender({ handle: B })
    await ready(hook, 'B body')
    const bCommits = hook.commits.slice(checkpoint).filter(({ handle }) => handle === B)
    expect(bCommits.length).toBeGreaterThan(0)
    for (const { session } of bCommits) {
      if (session.status === 'ready') {
        expect(session).toMatchObject({ draft: 'B body', savedContent: 'B body', savedSizeBytes: 6 })
      }
      expect(session.draft).not.toBe('A body')
      expect(session.savedContent).not.toBe('A body')
    }
    act(() => {
      for (const { session } of bCommits) {
        if (session.status === 'loading') session.setDraft('loading leaked')
      }
    })
    expect(hook.result.current.draft).toBe('B body')
    expect(writes()).toEqual([])
  })

  it('masks every mirror during a cache miss and adopts only B', async () => {
    const hook = harness()
    await ready(hook, 'A body')
    const pending = Promise.withResolvers<ReturnType<typeof read>>()
    ipc.request.mockReturnValueOnce(pending.promise)
    hook.rerender({ handle: B })
    expect(hook.result.current).toMatchObject(neutral)
    await act(async () => pending.resolve(read('B loaded')))
    await ready(hook, 'B loaded')
    expect(writes()).toEqual([])
  })

  it('detached callbacks cannot edit, discard, flush, reload, recover or watch B or cancel its autosave', async () => {
    const hook = harness()
    await ready(hook, 'A body')
    const old = hook.result.current
    hook.rerender({ handle: B })
    await ready(hook, 'B body')
    vi.useFakeTimers()
    act(() => hook.result.current.setDraft('B edit'))
    ipc.request.mockClear()
    await act(async () => {
      old.setDraft('A leaked')
      old.discard()
      await old.flush()
      await old.reload()
      await old.keepDraft()
      old.notifyExternalChange()
    })
    expect(hook.result.current.draft).toBe('B edit')
    expect(ipc.request.mock.calls).toEqual([])
    await act(async () => vi.advanceTimersByTimeAsync(800))
    expect(writes().map(([, input]) => input)).toEqual([
      { handle: B, data: bytes('B edit'), expectedVersion: read('B body').version }
    ])
    expect(hook.result.current.savedContent).toBe('B edit')
  })

  it('A1 callbacks remain detached after reopening A as A2; current callbacks edit and save', async () => {
    const hook = harness()
    await ready(hook, 'A body')
    const old = hook.result.current.setDraft
    hook.rerender({ handle: B })
    await ready(hook, 'B body')
    hook.rerender({ handle: A })
    await ready(hook, 'A body')
    act(() => old('A1 leaked'))
    expect(hook.result.current.draft).toBe('A body')
    act(() => hook.result.current.setDraft('A2 edit'))
    await act(async () => hook.result.current.flush())
    expect(hook.result.current.savedContent).toBe('A2 edit')
    expect(writes().map(([, input]) => input)).toEqual([
      { handle: A, data: bytes('A2 edit'), expectedVersion: read('A body').version }
    ])
  })

  it('callbacks obtained while loading stay inert after adoption', async () => {
    const pending = Promise.withResolvers<ReturnType<typeof read>>()
    ipc.request.mockReturnValueOnce(pending.promise)
    const hook = harness()
    const loading = hook.result.current
    expect(loading).toMatchObject(neutral)
    await act(async () => pending.resolve(read('A body')))
    await ready(hook, 'A body')
    ipc.request.mockClear()
    await act(async () => {
      loading.setDraft('loading leaked')
      loading.discard()
      await loading.flush()
      await loading.reload()
      await loading.keepDraft()
      loading.notifyExternalChange()
    })
    expect(hook.result.current.draft).toBe('A body')
    expect(ipc.request.mock.calls).toEqual([])
  })

  it('ignores a late initial A read after B has loaded', async () => {
    const pendingA = Promise.withResolvers<ReturnType<typeof read>>()
    const pendingB = Promise.withResolvers<ReturnType<typeof read>>()
    ipc.request.mockReturnValueOnce(pendingA.promise).mockReturnValueOnce(pendingB.promise)
    const hook = harness()
    hook.rerender({ handle: B })
    expect(hook.result.current).toMatchObject(neutral)
    await act(async () => pendingB.resolve(read('B first')))
    await ready(hook, 'B first')
    await act(async () => pendingA.resolve(read('A late')))
    expect(hook.result.current.draft).toBe('B first')
    expect(hook.commits.filter(({ handle }) => handle === B).every(({ session }) => session.draft !== 'A late')).toBe(
      true
    )
    expect(writes()).toEqual([])
  })

  it.each(['reload', 'watcher'] as const)('ignores a late A %s completion after switching to B', async (operation) => {
    const hook = harness()
    await ready(hook, 'A body')
    const pending = Promise.withResolvers<ReturnType<typeof read>>()
    ipc.request.mockReturnValueOnce(pending.promise)
    let task: Promise<void> | undefined
    await act(async () => {
      if (operation === 'reload') task = hook.result.current.reload()
      else hook.result.current.notifyExternalChange()
    })
    hook.rerender({ handle: B })
    await ready(hook, 'B body')
    const before = hook.result.current
    await act(async () => {
      pending.resolve(read('A late', 9))
      await task
    })
    expect(hook.result.current).toBe(before)
    expect(writes()).toEqual([])
  })

  it('settles an in-flight A writer using A bytes and version without publishing into B', async () => {
    const hook = harness()
    await ready(hook, 'A body')
    const pending = Promise.withResolvers<{ mtime: number; size: number }>()
    ipc.request.mockReturnValueOnce(pending.promise)
    act(() => hook.result.current.setDraft('A edit'))
    let task!: Promise<void>
    act(() => {
      task = hook.result.current.flush()
    })
    await waitFor(() => expect(hook.result.current.isSaving).toBe(true))
    hook.rerender({ handle: B })
    await ready(hook, 'B body')
    const before = hook.result.current
    const count = hook.commits.length
    expect(before).toMatchObject({ isSaving: false, conflict: false, saveError: undefined })
    await act(async () => {
      pending.resolve({ mtime: 2, size: 6 })
      await task
    })
    expect(writes().map(([, input]) => input)).toEqual([
      { handle: A, data: bytes('A edit'), expectedVersion: read('A body').version }
    ])
    expect(hook.result.current).toBe(before)
    expect(hook.commits).toHaveLength(count)
  })

  it.each(['conflict', 'io', 'metadata'] as const)('isolates A %s flags while B loads', async (failure) => {
    const hook = harness()
    await ready(hook, 'A body')
    act(() => hook.result.current.setDraft('A edit'))
    if (failure === 'conflict') {
      ipc.request
        .mockRejectedValueOnce(new IpcError(fileErrorCodes.STALE_VERSION, 'stale'))
        .mockResolvedValueOnce(read('external', 9))
    } else if (failure === 'metadata') {
      ipc.request
        .mockRejectedValueOnce(new IpcError(fileErrorCodes.COMMITTED_METADATA_PENDING, 'metadata'))
        .mockResolvedValueOnce(read('A edit', 9))
    } else ipc.request.mockRejectedValueOnce(new Error('disk full'))
    await act(async () => {
      await hook.result.current.flush().catch(() => {})
    })
    expect(hook.result.current.draft).toBe('A edit')
    if (failure === 'conflict') expect(hook.result.current.conflict).toBe(true)
    else expect(hook.result.current.saveError).toBeInstanceOf(Error)
    const pending = Promise.withResolvers<ReturnType<typeof read>>()
    ipc.request.mockReturnValueOnce(pending.promise)
    hook.rerender({ handle: B })
    expect(hook.result.current).toMatchObject(neutral)
    for (const { session } of hook.commits.filter(({ handle }) => handle === B)) {
      expect(session).toMatchObject(neutral)
    }
    await act(async () => pending.resolve(read('B body')))
    await ready(hook, 'B body')
  })

  it.each([
    { error: new Error('read failed'), status: 'error', unsupportedReason: undefined },
    { error: new UnsupportedFileTextError('encoding'), status: 'unsupported', unsupportedReason: 'encoding' }
  ])('prioritizes a current-key $status over loading', async ({ error, status, unsupportedReason }) => {
    const hook = harness()
    await ready(hook, 'A body')
    ipc.request.mockRejectedValueOnce(error)
    hook.rerender({ handle: B })
    await waitFor(() => expect(hook.result.current.status).toBe(status))
    expect(hook.result.current).toMatchObject({ ...neutral, status, unsupportedReason })
    expect(hook.result.current.error).toBe(status === 'error' ? error : undefined)
    expect(writes()).toEqual([])
  })

  it('keeps callbacks stable across typing, discard, reload and conflict recovery, including an empty file', async () => {
    ipc.request.mockResolvedValueOnce(read(''))
    const hook = harness()
    await ready(hook, '')
    const callbacks = (session: FileEditSession) => [
      session.setDraft,
      session.discard,
      session.reload,
      session.keepDraft,
      session.flush,
      session.notifyExternalChange
    ]
    const initial = callbacks(hook.result.current)
    act(() => hook.result.current.setDraft('edit'))
    expect(callbacks(hook.result.current)).toEqual(initial)
    act(() => hook.result.current.discard())
    expect(callbacks(hook.result.current)).toEqual(initial)
    await act(async () => hook.result.current.reload())
    expect(callbacks(hook.result.current)).toEqual(initial)
    act(() => hook.result.current.setDraft('local'))
    ipc.request
      .mockRejectedValueOnce(new IpcError(fileErrorCodes.STALE_VERSION, 'stale'))
      .mockResolvedValueOnce(read('external', 9))
    await act(async () => {
      await expect(hook.result.current.flush()).rejects.toThrow()
    })
    expect(hook.result.current.conflict).toBe(true)
    await act(async () => hook.result.current.keepDraft())
    expect(hook.result.current.savedContent).toBe('local')
    expect(callbacks(hook.result.current)).toEqual(initial)
    hook.rerender({ handle: undefined })
    expect(hook.result.current).toMatchObject({ ...neutral, status: 'idle' })
  })
})
