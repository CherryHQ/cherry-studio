import { Blob as NodeBlob } from 'node:buffer'

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { IpcError } from '@shared/ipc/errors/IpcError'

import { useHeifRendition, useHeifRenditions } from '../useHeifRendition'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: mocks }))
const png = { content: new Uint8Array([137, 80, 78, 71]) }
beforeEach(() => {
  vi.stubGlobal('Blob', NodeBlob)
  mocks.request.mockReset().mockResolvedValue(png)
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn().mockReturnValueOnce('blob:first').mockReturnValue('blob:second')
  })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('preserves the rendition and its URL when a new sources array has equal values', async () => {
  const source = { source: '/tmp/photo.heic', mediaType: 'image/heic', filename: 'photo.heic' }
  const { result, rerender } = renderHook(({ sources }) => useHeifRenditions(sources), {
    initialProps: { sources: [source] }
  })
  await waitFor(() => expect(result.current[0].url).toBe('blob:first'))

  rerender({ sources: [{ ...source }] })

  expect(result.current[0]).toEqual({ url: 'blob:first', loading: false })
  expect(mocks.request).toHaveBeenCalledTimes(1)
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  expect(URL.revokeObjectURL).not.toHaveBeenCalled()
})

it.each([
  { kind: 'path', source: () => '/tmp/old.heic', replacement: () => '/tmp/new.heic' },
  {
    kind: 'Blob with equal type and size',
    source: () => new Blob(['old'], { type: 'image/heic' }),
    replacement: () => new Blob(['new'], { type: 'image/heic' })
  }
])('replaces and revokes the rendition when the $kind changes', async ({ source, replacement }) => {
  const { result, rerender } = renderHook(({ sources }) => useHeifRenditions(sources), {
    initialProps: { sources: [{ source: source() }] }
  })
  await waitFor(() => expect(result.current[0].url).toBe('blob:first'))

  rerender({ sources: [{ source: replacement() }] })

  await waitFor(() => expect(result.current[0].url).toBe('blob:second'))
  expect(mocks.request).toHaveBeenCalledTimes(2)
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:first')
})

it('replaces the rendition on explicit refresh even when source values are equal', async () => {
  const { result, rerender } = renderHook(({ sources, refreshKey }) => useHeifRenditions(sources, refreshKey), {
    initialProps: { sources: [{ source: '/tmp/photo.heic' }], refreshKey: 0 }
  })
  await waitFor(() => expect(result.current[0].url).toBe('blob:first'))

  rerender({ sources: [{ source: '/tmp/photo.heic' }], refreshKey: 1 })

  await waitFor(() => expect(result.current[0].url).toBe('blob:second'))
  expect(mocks.request).toHaveBeenCalledTimes(2)
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:first')
})

it('never lets an obsolete conversion replace a newer source', async () => {
  let complete!: (value: typeof png) => void
  mocks.request.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve
    })
  )
  const { result, rerender, unmount } = renderHook(({ source }) => useHeifRendition(source), {
    initialProps: { source: '/tmp/old.heic' }
  })
  expect(result.current).toMatchObject({ loading: true, url: undefined })
  rerender({ source: '/tmp/new.heif' })
  await waitFor(() => expect(result.current.url).toBe('blob:first'))
  await act(async () => complete(png))
  expect(result.current.url).toBe('blob:first')
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first')
})

it('gives simultaneous owners separate URLs and revokes each on replacement or unmount', async () => {
  const first = renderHook(({ source }) => useHeifRendition(source), { initialProps: { source: '/tmp/photo.heic' } })
  const second = renderHook(() => useHeifRendition('/tmp/photo.heic'))
  await waitFor(() => expect(second.result.current.url).toBe('blob:second'))
  first.rerender({ source: '/tmp/ordinary.png' })
  expect(first.result.current.url).toBe('/tmp/ordinary.png')
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first')
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:second')
  second.unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:second')
})

it.each([
  ['FILE_HEIF_TOO_LARGE', 'error.heif_detail_too_large'],
  ['FILE_HEIF_UNAVAILABLE', 'error.heif_detail_unavailable'],
  ['FILE_HEIF_BUSY', 'error.heif_detail_busy'],
  ['FILE_HEIF_TIMEOUT', 'error.heif_detail_timeout'],
  ['FILE_HEIF_INVALID', 'error.heif_detail_convert']
])('maps %s to actionable copy without creating a raw HEIF URL', async (code, key) => {
  mocks.request.mockRejectedValueOnce(new IpcError(code, 'private native diagnostic'))
  const { result } = renderHook(() => useHeifRendition('/tmp/photo.heic'))
  await waitFor(() => expect(result.current.error).toBe(key))
  expect(result.current.url).toBeUndefined()
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})

it('recognizes a HEIF path even when its display name has no extension', async () => {
  const { result } = renderHook(() => useHeifRendition('/tmp/photo.HEIC', undefined, 'Holiday photo'))
  await waitFor(() => expect(result.current.url).toBe('blob:first'))
  expect(mocks.request).toHaveBeenCalledWith('file.get_heif_rendition', {
    source: { kind: 'path', path: '/tmp/photo.HEIC' }
  })
})
