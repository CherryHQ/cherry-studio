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
  vi.useRealTimers()
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

it('loads twelve uncached HEIF previews without exceeding four in-flight requests', async () => {
  let inFlight = 0
  let peak = 0
  let urlIndex = 0
  vi.mocked(URL.createObjectURL)
    .mockReset()
    .mockImplementation(() => `blob:preview-${urlIndex++}`)
  mocks.request.mockImplementation(async () => {
    inFlight++
    peak = Math.max(peak, inFlight)
    try {
      if (inFlight > 9) throw new IpcError('FILE_HEIF_BUSY')
      await new Promise((resolve) => setTimeout(resolve, 10))
      return png
    } finally {
      inFlight--
    }
  })
  const sources = Array.from({ length: 12 }, (_, index) => ({ source: `/tmp/photo-${index}.heic` }))
  const { result } = renderHook(() => useHeifRenditions(sources))

  await waitFor(() => expect(result.current.every((state) => !state.loading)).toBe(true))

  expect(result.current).toEqual(sources.map(() => ({ loading: false, url: expect.stringMatching(/^blob:preview-/) })))
  expect(new Set(result.current.map((state) => state.url)).size).toBe(12)
  expect(peak).toBeLessThanOrEqual(4)
})

it.each([1, 2, 3, 4, 5, 6, 7])(
  'retries busy previews with a six-attempt budget after %i busy failures',
  async (busyFailures) => {
    vi.useFakeTimers()
    let attempts = 0
    mocks.request.mockImplementation(async () => {
      if (attempts++ < busyFailures) throw new IpcError('FILE_HEIF_BUSY')
      return png
    })
    const { result } = renderHook(() => useHeifRendition('/tmp/photo.heic'))

    await act(async () => vi.advanceTimersByTimeAsync(2000))

    expect(result.current).toEqual(
      busyFailures < 6 ? { loading: false, url: 'blob:first' } : { loading: false, error: 'error.heif_detail_busy' }
    )
  }
)

it('shares decoder capacity across twelve independent owners', async () => {
  vi.useFakeTimers()
  let inFlight = 0
  let peak = 0
  let urlIndex = 0
  vi.mocked(URL.createObjectURL)
    .mockReset()
    .mockImplementation(() => `blob:owner-${urlIndex++}`)
  mocks.request.mockImplementation(async () => {
    inFlight++
    peak = Math.max(peak, inFlight)
    try {
      if (inFlight > 9) throw new IpcError('FILE_HEIF_BUSY')
      await new Promise((resolve) => setTimeout(resolve, 150))
      return png
    } finally {
      inFlight--
    }
  })
  const owners = Array.from({ length: 12 }, (_, index) =>
    renderHook(() => useHeifRendition(`/tmp/photo-${index}.heic`))
  )

  await act(async () => vi.advanceTimersByTimeAsync(2000))

  const states = owners.map(({ result }) => result.current)
  expect(states).toEqual(owners.map(() => ({ loading: false, url: expect.stringMatching(/^blob:owner-/) })))
  expect(new Set(states.map((state) => state.url)).size).toBe(12)
  expect(peak).toBeLessThanOrEqual(4)
})

it('releases stalled preview slots at the deadline for a later owner', async () => {
  vi.useFakeTimers()
  mocks.request.mockImplementation((_route, { source }) =>
    source.path.includes('stalled') ? new Promise(() => {}) : Promise.resolve(png)
  )
  const sources = Array.from({ length: 4 }, (_, index) => ({ source: `/tmp/stalled-${index}.heic` }))
  const stalled = renderHook(() => useHeifRenditions(sources))
  const later = renderHook(() => useHeifRendition('/tmp/later.heic'))

  await act(async () => vi.advanceTimersByTimeAsync(30_001))

  expect(stalled.result.current).toEqual(sources.map(() => ({ loading: false, error: 'error.heif_detail_timeout' })))
  expect(later.result.current).toEqual({ loading: false, url: 'blob:first' })
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
})

it('keeps another owner’s queued preview when an owner unmounts', async () => {
  const pending: (() => void)[] = []
  mocks.request.mockImplementation(() => new Promise((resolve) => pending.push(() => resolve(png))))
  const sources = Array.from({ length: 4 }, (_, index) => ({ source: `/tmp/first-${index}.heic` }))
  const first = renderHook(() => useHeifRenditions(sources))
  const survivor = renderHook(() => useHeifRendition('/tmp/survivor.heic'))

  first.unmount()
  await act(async () => pending.splice(0).forEach((complete) => complete()))
  await act(async () => pending.splice(0).forEach((complete) => complete()))

  expect(survivor.result.current).toEqual({ loading: false, url: 'blob:first' })
})

it('cancels queued previews on unmount and revokes created URLs exactly once', async () => {
  const pending: (() => void)[] = []
  const started: string[] = []
  const created: string[] = []
  const revoked: string[] = []
  vi.mocked(URL.createObjectURL)
    .mockReset()
    .mockImplementation(() => {
      const url = `blob:preview-${created.length}`
      created.push(url)
      return url
    })
  vi.mocked(URL.revokeObjectURL).mockImplementation((url) => revoked.push(url))
  mocks.request.mockImplementation(
    (_route, { source }) =>
      new Promise((resolve) => {
        started.push(source.path)
        pending.push(() => resolve(png))
      })
  )
  const sources = Array.from({ length: 12 }, (_, index) => ({ source: `/tmp/photo-${index}.heic` }))
  const { result, unmount } = renderHook(() => useHeifRenditions(sources))
  await act(async () => pending.shift()!())
  expect(result.current[0]).toEqual({ loading: false, url: 'blob:preview-0' })
  const startedBeforeUnmount = [...started]
  unmount()
  await act(async () => pending.splice(0).forEach((complete) => complete()))

  expect(started).toEqual(startedBeforeUnmount)
  expect(started).toEqual(sources.slice(0, 5).map((item) => item.source))
  expect(created).toEqual(['blob:preview-0'])
  expect(revoked).toEqual(created)
})

it('does not retry or start queued previews after unmount during busy backoff', async () => {
  vi.useFakeTimers()
  const started: string[] = []
  mocks.request.mockImplementation(async (_route, { source }) => {
    started.push(source.path)
    throw new IpcError('FILE_HEIF_BUSY')
  })
  const sources = Array.from({ length: 12 }, (_, index) => ({ source: `/tmp/photo-${index}.heic` }))
  const { unmount } = renderHook(() => useHeifRenditions(sources))
  await act(async () => vi.advanceTimersByTimeAsync(0))
  const startedBeforeUnmount = [...started]
  unmount()
  await act(async () => vi.advanceTimersByTimeAsync(1000))

  expect(started).toEqual(startedBeforeUnmount)
  expect(started).toEqual(sources.slice(0, 4).map((item) => item.source))
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})
