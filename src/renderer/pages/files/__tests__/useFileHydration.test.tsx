// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileEntry } from '@shared/data/types/file'
import type { FileType } from '@shared/types/file'

import { useFileHydration } from '../useFileHydration'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))

const text = { id: 'text', ext: 'txt' } as FileEntry
const image = { id: 'image', ext: 'png' } as FileEntry
type Props = { pages: { items: FileEntry[] }[]; fileType?: FileType }

function setup(props: Props, cache = new Map()) {
  return renderHook(({ pages, fileType }: Props) => useFileHydration(pages, fileType), {
    initialProps: props,
    wrapper: ({ children }: { children: ReactNode }) => (
      <SWRConfig value={{ provider: () => cache, errorRetryInterval: 10 }}>{children}</SWRConfig>
    )
  })
}

beforeEach(() => {
  request.mockReset().mockImplementation((route: string, input: { ids?: string[]; items?: { key: string }[] }) => {
    const ids = input.ids ?? input.items?.map(({ key }) => key) ?? []
    const value = route === 'file.batch_get_dangling_states' ? 'present' : null
    return Promise.resolve(Object.fromEntries(ids.map((id) => [id, value])))
  })
})
afterEach(cleanup)

describe('Files hydration cache', () => {
  it('refreshes filesystem records on reopening and still hydrates only appended IDs', async () => {
    const cache = new Map()
    let restored = false
    request.mockImplementation((route, input) => {
      const ids: string[] = input.ids ?? input.items.map(({ key }: { key: string }) => key)
      const value =
        route === 'file.batch_get_metadata'
          ? { size: restored ? 2048 : 1024, modifiedAt: restored ? 2 : 1 }
          : route === 'file.batch_get_physical_paths'
            ? restored
              ? '/tmp/restored.png'
              : null
            : restored
              ? 'present'
              : 'missing'
      return Promise.resolve(Object.fromEntries(ids.map((id) => [id, value])))
    })
    const first = setup({ pages: [{ items: [text, image] }] }, cache)
    await waitFor(() => {
      expect(first.result.current.metadataById.text?.size).toBe(1024)
      expect(first.result.current.danglingStateById.text).toBe('missing')
      expect(first.result.current.physicalPathById.image).toBeNull()
    })
    first.unmount()
    restored = true
    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31 * 60_000)
    })
    vi.useRealTimers()

    const reopened = setup({ pages: [{ items: [text, image] }] }, cache)
    await waitFor(() => {
      expect(reopened.result.current.metadataById.text?.size).toBe(2048)
      expect(reopened.result.current.metadataById.text?.modifiedAt).toBe(2)
      expect(reopened.result.current.danglingStateById.text).toBe('present')
      expect(reopened.result.current.physicalPathById.image).toBe('/tmp/restored.png')
    })
    request.mockClear()
    const appended = { ...text, id: 'appended' }
    reopened.rerender({ pages: [{ items: [text, image] }, { items: [appended] }] })
    await waitFor(() => {
      expect(reopened.result.current.metadataById.appended?.size).toBe(2048)
      expect(reopened.result.current.danglingStateById.appended).toBe('present')
    })
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls).toEqual(
      expect.arrayContaining([
        ['file.batch_get_metadata', { items: [{ key: 'appended', handle: { kind: 'entry', entryId: 'appended' } }] }],
        ['file.batch_get_dangling_states', { ids: ['appended'] }]
      ])
    )
  })

  it('keeps refreshed records when a late pre-refresh response is followed by pagination', async () => {
    let resolve!: (records: Record<string, unknown>) => void
    const pending = new Promise<Record<string, unknown>>((done) => {
      resolve = done
    })
    let attempts = 0
    const implementation = request.getMockImplementation()!
    request.mockImplementation((route, input) => {
      if (route === 'file.batch_get_metadata' && input.items[0].key === text.id) {
        if (++attempts === 1) return pending
        return Promise.resolve({ text: { size: 2048 } })
      }
      return implementation(route, input)
    })
    const { result, rerender } = setup({ pages: [{ items: [text] }, { items: [image] }] })
    await waitFor(() => expect(attempts).toBe(1))
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.metadataById.text?.size).toBe(2048)
    await waitFor(() => expect(result.current.metadataById.image).toBeNull())
    await act(async () => {
      resolve({ text: { size: 1024 } })
    })
    expect(result.current.metadataById.text?.size).toBe(2048)
    rerender({ pages: [{ items: [text] }] })
    await waitFor(() => expect(result.current.metadataById.image).toBeUndefined())
    expect(result.current.metadataById.text?.size).toBe(2048)
    rerender({ pages: [{ items: [text] }, { items: [image] }] })
    await waitFor(() => expect(result.current.metadataById.image).toBeNull())
    expect(result.current.metadataById.text?.size).toBe(2048)
  })

  it('retries a failed route without repeating successful route work', async () => {
    let attempts = 0
    const implementation = request.getMockImplementation()!
    request.mockImplementation((route, input) => {
      if (route === 'file.batch_get_metadata') {
        if (++attempts === 1) return Promise.reject(new Error('temporarily unavailable'))
        return Promise.resolve({ text: { size: 2048 } })
      }
      return implementation(route, input)
    })
    const { result } = setup({ pages: [{ items: [text] }] })
    await waitFor(() => expect(result.current.metadataById.text?.size).toBe(2048))
    expect(result.current.danglingStateById.text).toBe('present')
    expect(request.mock.calls.filter(([route]) => route === 'file.batch_get_dangling_states')).toHaveLength(1)
  })

  it('handles empty image batches and resets to a different first page', async () => {
    const { result, rerender } = setup({ pages: [{ items: [text] }] })
    await waitFor(() => expect(result.current.metadataById).toEqual({ text: null }))
    expect(result.current.physicalPathById).toEqual({})
    expect(request.mock.calls.some(([route]) => route === 'file.batch_get_physical_paths')).toBe(false)

    rerender({ pages: [{ items: [image] }] })
    await waitFor(() => expect(result.current.physicalPathById).toEqual({ image: null }))
    expect(result.current.metadataById).toEqual({ image: null })
    rerender({ pages: [] })
    expect(result.current.metadataById).toEqual({})
    expect(result.current.physicalPathById).toEqual({})
  })

  it('invalidates inactive filter caches on refresh', async () => {
    let size = 1024
    const implementation = request.getMockImplementation()!
    request.mockImplementation((route, input) =>
      route === 'file.batch_get_metadata' ? Promise.resolve({ text: { size } }) : implementation(route, input)
    )
    const { result, rerender } = setup({ pages: [{ items: [text] }] })
    await waitFor(() => expect(result.current.metadataById.text?.size).toBe(1024))
    rerender({ pages: [{ items: [text] }], fileType: 'text' })
    await waitFor(() => expect(result.current.metadataById.text?.size).toBe(1024))
    size = 2048
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.metadataById.text?.size).toBe(2048)
    rerender({ pages: [{ items: [text] }] })
    await waitFor(() => expect(result.current.metadataById.text?.size).toBe(2048))
  })

  it('does not apply a pending result to a different first-page key after unmount', async () => {
    const cache = new Map()
    let resolve!: (records: Record<string, unknown>) => void
    const pending = new Promise<Record<string, unknown>>((done) => {
      resolve = done
    })
    request.mockReturnValue(pending)
    const view = setup({ pages: [{ items: [text] }] }, cache)
    await waitFor(() => expect(request).toHaveBeenCalled())
    view.unmount()
    request.mockResolvedValue({ image: null })
    const next = setup({ pages: [{ items: [image] }] }, cache)
    await waitFor(() => expect(next.result.current.metadataById).toEqual({ image: null }))
    await act(async () => {
      resolve({ text: { size: 4096 } })
    })
    expect(next.result.current.metadataById).toEqual({ image: null })
  })
})
