import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { type ReactNode, useLayoutEffect } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { FileEditSessionManager } from '@renderer/services/fileEdit/FileEditSessionManager'
import type { FileHandle } from '@shared/data/types/file'
import { fileEditRequestSchemas } from '@shared/ipc/schemas/fileEdit'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { createFilePathHandle } from '@shared/utils/file'

import { createEditTransport } from '../../../../tests/helpers/file/editTransport'
import { FileEditSessionContext, useFileEditSession } from '../useFileEditSession'

const ipc = vi.hoisted(() => ({ request: vi.fn(), on: vi.fn(() => () => {}) }))
vi.mock('@renderer/ipc', () => ({ ipcApi: ipc }))

const a = createFilePathHandle(AbsoluteFilePathSchema.parse('/notes/A.md'))
const b = createFilePathHandle(AbsoluteFilePathSchema.parse('/notes/B.md'))
let manager: FileEditSessionManager
const wrapper = ({ children }: { children: ReactNode }) => (
  <FileEditSessionContext value={manager}>{children}</FileEditSessionContext>
)

beforeEach(() => {
  manager = new FileEditSessionManager()
  ipc.request.mockReset()
  ipc.request.mockImplementation(
    createEditTransport(async (route, input) => {
      if (route === 'file.edit.read') {
        const content = new TextEncoder().encode(
          input && typeof input === 'object' && 'path' in input && input.path === '/notes/A.md' ? 'ALPHA' : 'BRAVO'
        )
        return { content, version: { mtime: 101, size: content.byteLength } }
      }
      if (
        route === 'file.edit.write' &&
        input &&
        typeof input === 'object' &&
        'data' in input &&
        input.data instanceof Uint8Array
      )
        return { mtime: 102, size: input.data.byteLength }
      throw new Error(`Unexpected route: ${route}`)
    })
  )
})
afterEach(cleanup)

it('never exposes another file draft as ready when reopening a cached file', async () => {
  const observed: { path: string; draft: string }[] = []
  const { result, rerender } = renderHook(
    ({ handle }: { handle: FileHandle }) => {
      const session = useFileEditSession(handle, 'notes')
      useLayoutEffect(() => {
        if (session.status === 'ready' && handle.kind === 'path') {
          observed.push({ path: handle.path, draft: session.draft })
        }
      }, [handle, session])
      return session
    },
    { initialProps: { handle: a }, wrapper }
  )
  await waitFor(() => expect(result.current.draft).toBe('ALPHA'))
  rerender({ handle: b })
  await waitFor(() => expect(result.current.draft).toBe('BRAVO'))
  rerender({ handle: a })
  await waitFor(() => expect(result.current.draft).toBe('ALPHA'))

  expect(observed).not.toContainEqual({ path: '/notes/A.md', draft: 'BRAVO' })
  expect(observed).not.toContainEqual({ path: '/notes/B.md', draft: 'ALPHA' })
})

it('rejects an old editor callback after switching files and after reopening the same path', async () => {
  const { result, rerender } = renderHook(({ handle }) => useFileEditSession(handle, 'notes'), {
    initialProps: { handle: a },
    wrapper
  })
  await waitFor(() => expect(result.current.draft).toBe('ALPHA'))
  const oldEdit = result.current.setDraft
  rerender({ handle: b })
  await waitFor(() => expect(result.current.draft).toBe('BRAVO'))
  act(() => oldEdit('late edit from A'))
  await act(async () => result.current.flush())
  expect(result.current.draft).toBe('BRAVO')

  rerender({ handle: a })
  await waitFor(() => expect(result.current.draft).toBe('ALPHA'))
  act(() => oldEdit('late edit from previous A session'))
  await act(async () => result.current.flush())
  expect(result.current.draft).toBe('ALPHA')
  expect(ipc.request.mock.calls.filter(([route]) => route === 'file.edit.write')).toEqual([])

  act(() => result.current.setDraft('current A edit'))
  await act(async () => result.current.flush())
  const writes = ipc.request.mock.calls.filter(([route]) => route === 'file.edit.write')
  expect(writes).toHaveLength(1)
  expect(new TextDecoder().decode(writes[0][1].data)).toBe('current A edit')
})

it('does not republish a released A attachment when B is abandoned before acquisition completes', async () => {
  const { result, rerender } = renderHook(({ handle }) => useFileEditSession(handle, 'notes'), {
    initialProps: { handle: a },
    wrapper
  })
  await waitFor(() => expect(result.current.status).toBe('ready'))
  const transport = ipc.request.getMockImplementation()!
  const pending = Promise.withResolvers<void>()
  ipc.request.mockImplementation(async (...args) => {
    if (args[0] === 'file.edit.open') await pending.promise
    return transport(...args)
  })
  rerender({ handle: b })
  rerender({ handle: a })
  expect(result.current.status).toBe('loading')
  expect(result.current.draft).toBe('')
  pending.resolve()
  await waitFor(() => expect(result.current.draft).toBe('ALPHA'))
})

it('opens the selected note when a mutation settles', async () => {
  const { result, rerender } = renderHook(({ handle }) => useFileEditSession(handle, 'notes'), {
    initialProps: { handle: a },
    wrapper
  })
  await waitFor(() => expect(result.current.draft).toBe('ALPHA'))
  let mutation!: Awaited<ReturnType<typeof manager.prepareMutation>>
  await act(async () => {
    mutation = await manager.prepareMutation()
  })
  rerender({ handle: b })
  await act(async () => {})
  expect(result.current.status).toBe('loading')
  expect(result.current.draft).toBe('')
  await act(async () => {
    await mutation.finish()
  })
  await waitFor(() => expect(result.current.status).toBe('ready'))
  expect(result.current.draft).toBe('BRAVO')
})

it.each(['switch', 'unmount'] as const)('releases a queued acquisition abandoned by %s', async (outcome) => {
  const transport = ipc.request.getMockImplementation()!
  const openLeases = new Map<string, string>()
  const closedPaths = new Set<string>()
  ipc.request.mockImplementation(async (route, ...args) => {
    const result = await transport(route, ...args)
    if (route === 'file.edit.open') {
      const resource = fileEditRequestSchemas[route].output.parse(result)
      const { handle } = fileEditRequestSchemas[route].input.parse(args[0])
      if (handle.kind === 'path') openLeases.set(resource.editId, handle.path)
    } else if (route === 'file.edit.close') {
      const { editId } = fileEditRequestSchemas[route].input.parse(args[0])
      const path = openLeases.get(editId)
      if (path) closedPaths.add(path)
      openLeases.delete(editId)
    }
    return result
  })
  const mutation = await manager.prepareMutation()
  const { result, rerender, unmount } = renderHook(({ handle }) => useFileEditSession(handle, 'notes'), {
    initialProps: { handle: b },
    wrapper
  })
  if (outcome === 'switch') rerender({ handle: a })
  else unmount()
  await act(async () => await mutation.finish())
  await waitFor(() => expect(closedPaths.has('/notes/B.md')).toBe(true))
  if (outcome === 'switch') {
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.draft).toBe('ALPHA')
    expect(manager.listRetained().map((session) => session.locator)).toEqual(['/notes/A.md'])
    unmount()
  }
  await waitFor(() => expect(manager.listRetained()).toEqual([]))
  await waitFor(() => expect(openLeases.size).toBe(0))
})

it('masks the previous draft while loading and keeps loading callbacks detached after adoption', async () => {
  const { result, rerender } = renderHook(({ handle }) => useFileEditSession(handle, 'notes'), {
    initialProps: { handle: a },
    wrapper
  })
  await waitFor(() => expect(result.current.draft).toBe('ALPHA'))
  const transport = ipc.request.getMockImplementation()!
  const pending = Promise.withResolvers<void>()
  ipc.request.mockImplementation(async (...args) => {
    if (args[0] === 'file.edit.read') await pending.promise
    return transport(...args)
  })
  rerender({ handle: b })
  const loading = result.current
  expect(loading).toMatchObject({
    status: 'loading',
    draft: '',
    savedContent: '',
    savedSizeBytes: undefined,
    isDirty: false,
    isSaving: false,
    conflict: false,
    saveError: undefined
  })
  await act(async () => pending.resolve())
  await waitFor(() => expect(result.current.draft).toBe('BRAVO'))
  act(() => loading.setDraft('loading callback leaked'))
  for (const command of [loading.discard, loading.flush, loading.reload, loading.keepDraft])
    await expect(command()).rejects.toThrow('not ready')
  expect(result.current).toMatchObject({ draft: 'BRAVO', savedContent: 'BRAVO', isDirty: false })
  expect(ipc.request.mock.calls.filter(([route]) => route === 'file.edit.write')).toEqual([])
})

it.each(['initial read', 'reload', 'save'] as const)('does not publish a late A %s into B', async (operation) => {
  const transport = ipc.request.getMockImplementation()!
  const pending = Promise.withResolvers<void>()
  const started = Promise.withResolvers<void>()
  const installGate = () => {
    let gated = false
    ipc.request.mockImplementation(async (...args) => {
      if (!gated && args[0] === (operation === 'save' ? 'file.edit.write' : 'file.edit.read')) {
        gated = true
        started.resolve()
        await pending.promise
      }
      return transport(...args)
    })
  }
  if (operation === 'initial read') installGate()
  const { result, rerender } = renderHook(({ handle }) => useFileEditSession(handle, 'notes'), {
    initialProps: { handle: a },
    wrapper
  })
  let task: Promise<void> | undefined
  if (operation !== 'initial read') {
    await waitFor(() => expect(result.current.draft).toBe('ALPHA'))
    installGate()
    act(() => {
      if (operation === 'save') {
        result.current.setDraft('A pending edit')
        task = result.current.flush()
      } else task = result.current.reload()
    })
  }
  await act(async () => started.promise)
  rerender({ handle: b })
  await waitFor(() => expect(result.current.draft).toBe('BRAVO'))
  await act(async () => {
    pending.resolve()
    await task
  })
  expect(result.current).toMatchObject({
    status: 'ready',
    draft: 'BRAVO',
    savedContent: 'BRAVO',
    isDirty: false,
    isSaving: false,
    conflict: false,
    saveError: undefined
  })
  if (operation === 'save') {
    const writes = ipc.request.mock.calls.filter(([route]) => route === 'file.edit.write')
    expect(writes).toHaveLength(1)
    expect(new TextDecoder().decode(writes[0][1].data)).toBe('A pending edit')
  }
})
