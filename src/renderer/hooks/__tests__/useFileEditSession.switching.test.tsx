import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { type ReactNode, useLayoutEffect } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { FileEditSessionManager } from '@renderer/services/fileEdit/FileEditSessionManager'
import type { FileHandle } from '@shared/data/types/file'
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
      const session = useFileEditSession(handle)
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
  const { result, rerender } = renderHook(({ handle }) => useFileEditSession(handle), {
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
  const { result, rerender } = renderHook(({ handle }) => useFileEditSession(handle), {
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
