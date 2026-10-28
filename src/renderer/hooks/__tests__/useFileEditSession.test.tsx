import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { FileEditSessionManager } from '@renderer/services/fileEdit/FileEditSessionManager'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { createEditTransport } from '../../../../tests/helpers/file/editTransport'
import { FileEditSessionContext, useFileEditSession } from '../useFileEditSession'

const ipc = vi.hoisted(() => ({ request: vi.fn(), on: vi.fn(() => () => {}) }))
vi.mock('@renderer/ipc', () => ({ ipcApi: ipc }))
const handle = { kind: 'path', path: AbsoluteFilePathSchema.parse('/notes/A.md') } as const
let manager: FileEditSessionManager
let disk: Uint8Array
let writes: Uint8Array[]
const wrapper = ({ children }: { children: ReactNode }) => (
  <FileEditSessionContext value={manager}>{children}</FileEditSessionContext>
)
beforeEach(() => {
  manager = new FileEditSessionManager()
  disk = new TextEncoder().encode('base')
  writes = []
  ipc.request.mockImplementation(
    createEditTransport(async (route, input) => {
      if (route === 'file.edit.read') return { content: disk, version: { mtime: 1, size: disk.length } }
      if (
        route === 'file.edit.write' &&
        input &&
        typeof input === 'object' &&
        'data' in input &&
        input.data instanceof Uint8Array
      ) {
        disk = input.data
        writes.push(disk)
        return { mtime: 2, size: disk.length }
      }
      throw new Error(`Unexpected route: ${route}`)
    })
  )
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it('preserves BOM, CRLF and raw Markdown on untouched load and after an actual edit', async () => {
  disk = new TextEncoder().encode('\ufeff__base__\r\n')
  const { result } = renderHook(() => useFileEditSession(handle, 'notes'), { wrapper })
  await waitFor(() => expect(result.current.status).toBe('ready'))
  expect(result.current.draft).toBe('__base__\n')
  await act(async () => result.current.flush())
  expect(writes).toEqual([])
  act(() => result.current.setDraft('__changed__\n'))
  await act(async () => result.current.flush())
  expect(writes.map((bytes) => Array.from(bytes))).toEqual([
    Array.from(new TextEncoder().encode('\ufeff__changed__\r\n'))
  ])
})

it.each<[Uint8Array, string]>([
  [new Uint8Array([0xff]), 'encoding'],
  [new TextEncoder().encode('a\r\nb\n'), 'mixed-line-endings']
])('blocks editing of unsupported text without blocking flush or discard', async (bytes, reason) => {
  disk = bytes
  const { result } = renderHook(() => useFileEditSession(handle, 'notes'), { wrapper })
  await waitFor(() => expect(result.current.status).toBe('unsupported'))
  expect(result.current.unsupportedReason).toBe(reason)
  act(() => result.current.setDraft('replacement'))
  await expect(result.current.flush()).resolves.toBeUndefined()
  await expect(result.current.discard()).resolves.toBeUndefined()
  await expect(result.current.reload()).rejects.toThrow('not ready')
  await expect(result.current.keepDraft()).rejects.toThrow('not ready')
  expect(result.current.sessionId).toBeUndefined()
  expect(writes).toEqual([])
})

it('debounces real edits and rejects a callback captured before a document replacement', async () => {
  const { result } = renderHook(() => useFileEditSession(handle, 'notes'), { wrapper })
  await waitFor(() => expect(result.current.status).toBe('ready'))
  vi.useFakeTimers()
  const oldEdit = result.current.setDraft
  act(() => result.current.setDraft('changed'))
  await act(async () => vi.advanceTimersByTimeAsync(799))
  expect(writes).toEqual([])
  await act(async () => vi.advanceTimersByTimeAsync(1))
  expect(new TextDecoder().decode(disk)).toBe('changed')
  await act(async () => result.current.reload())
  act(() => oldEdit('stale replacement'))
  expect(result.current.draft).toBe('changed')
})
