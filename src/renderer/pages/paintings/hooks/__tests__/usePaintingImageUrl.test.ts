import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loggerService } from '@logger'

import { usePaintingImageUrl } from '../usePaintingImageUrl'

type Source = Parameters<typeof usePaintingImageUrl>[0]
const svg = { id: 'svg-1', path: '/tmp/generated.svg', ext: 'svg' }
const bytes = new Uint8Array([60, 115, 118, 103, 62, 13, 10, 0, 255, 60, 47, 115, 118, 103, 62])
const browserUrl = URL
const createObjectURL = vi.fn<(blob: Blob) => string>()
const revokeObjectURL = vi.fn<(url: string) => void>()

function deferredRead() {
  let resolve!: (value: unknown) => void
  let reject!: (reason: Error) => void
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function readBytes(blob: Blob) {
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
  return new Uint8Array(buffer)
}

const success = (content = bytes) => ({ ok: true, data: { content, mime: 'image/svg+xml' } })

describe('usePaintingImageUrl', () => {
  beforeEach(() => {
    vi.mocked(window.api.ipcApi.request).mockReset()
    createObjectURL.mockReset().mockImplementation(() => `blob:painting-${createObjectURL.mock.calls.length}`)
    revokeObjectURL.mockReset()
    vi.stubGlobal(
      'URL',
      class extends browserUrl {
        static createObjectURL = createObjectURL
        static revokeObjectURL = revokeObjectURL
      }
    )
  })

  afterEach(() => {
    vi.stubGlobal('URL', browserUrl)
    vi.restoreAllMocks()
  })

  it('returns an idle empty source without reading a file', () => {
    const { result } = renderHook(() => usePaintingImageUrl(undefined))
    expect(result.current).toEqual({ url: undefined, isLoading: false })
    expect(window.api.ipcApi.request).not.toHaveBeenCalled()
  })

  it.each([
    [{ id: 'png', path: '/tmp/a #1.png', ext: '.png' }, 'file:///tmp/a%20%231.png'],
    [{ id: 'win', path: 'C:\\Pictures\\a b.png', ext: 'PNG' }, 'file:///C:/Pictures/a%20b.png'],
    [{ id: 'unc', path: '\\\\server\\share\\a.png', ext: 'png' }, 'file://server/share/a.png'],
    [{ id: 'invalid', path: 'relative.png', ext: 'png' }, undefined],
    [{ id: 'html', path: '/tmp/page.html', ext: 'html' }, 'file:///tmp/page.html'],
    [{ id: 'svgz', path: '/tmp/image.svgz', ext: 'svgz' }, 'file:///tmp/image.svgz']
  ])('preserves the synchronous guarded URL for %j', (file, url) => {
    const renders: ReturnType<typeof usePaintingImageUrl>[] = []
    const { result } = renderHook(() => {
      const image = usePaintingImageUrl(file)
      renders.push(image)
      return image
    })
    expect(renders[0]).toEqual({ url, isLoading: false })
    expect(result.current).toEqual({ url, isLoading: false })
    expect(window.api.ipcApi.request).not.toHaveBeenCalled()
  })

  it.each(['svg', '.svg', 'SVG'])(
    'reads %s by entry id and preserves every binary byte in a passive image blob',
    async (ext) => {
      vi.mocked(window.api.ipcApi.request).mockResolvedValue(success())
      const { result, unmount } = renderHook(() => usePaintingImageUrl({ ...svg, ext }))
      expect(result.current).toEqual({ url: undefined, isLoading: true })
      await waitFor(() => expect(result.current).toEqual({ url: 'blob:painting-1', isLoading: false }))
      expect(window.api.ipcApi.request).toHaveBeenCalledWith('file.read', {
        handle: { kind: 'entry', entryId: svg.id },
        options: { mode: 'full', encoding: 'binary' }
      })
      const blob = createObjectURL.mock.calls[0][0]
      expect(blob.type).toBe('image/svg+xml')
      expect(await readBytes(blob)).toEqual(bytes)
      expect(revokeObjectURL).not.toHaveBeenCalled()
      unmount()
      expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:painting-1')
    }
  )

  it.each(['read failed', 'provider entry missing', 'dangling file'])(
    'settles %s without falling back to the physical path',
    async (message) => {
      const error = new Error(message)
      const warn = vi.spyOn(loggerService, 'warn').mockImplementation(() => {})
      vi.mocked(window.api.ipcApi.request).mockRejectedValue(error)
      const { result } = renderHook(() => usePaintingImageUrl(svg))
      await waitFor(() => expect(result.current).toEqual({ url: undefined, isLoading: false }))
      expect(warn).toHaveBeenCalledExactlyOnceWith('Failed to read painting SVG image', { fileId: svg.id, error })
      expect(createObjectURL).not.toHaveBeenCalled()
    }
  )

  it('removes the previous URL immediately on selection change and releases only its own URL', async () => {
    vi.mocked(window.api.ipcApi.request).mockResolvedValueOnce(success())
    const renders: (ReturnType<typeof usePaintingImageUrl> & { id?: string })[] = []
    const { result, rerender, unmount } = renderHook<ReturnType<typeof usePaintingImageUrl>, { file: Source }>(
      ({ file }) => {
        const image = usePaintingImageUrl(file)
        renders.push({ id: file?.id, ...image })
        return image
      },
      { initialProps: { file: svg } }
    )
    await waitFor(() => expect(result.current.url).toBe('blob:painting-1'))
    const next = deferredRead()
    vi.mocked(window.api.ipcApi.request).mockReturnValueOnce(next.promise)
    rerender({ file: { ...svg, id: 'svg-2' } })
    expect(renders.find((image) => image.id === 'svg-2')).toEqual({ id: 'svg-2', url: undefined, isLoading: true })
    expect(result.current).toEqual({ url: undefined, isLoading: true })
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:painting-1')
    await act(async () => next.resolve(success()))
    expect(result.current).toEqual({ url: 'blob:painting-2', isLoading: false })
    rerender({ file: { id: 'png', path: '/tmp/image.png', ext: 'png' } })
    expect(result.current).toEqual({ url: 'file:///tmp/image.png', isLoading: false })
    expect(revokeObjectURL.mock.calls).toEqual([['blob:painting-1'], ['blob:painting-2']])
    rerender({ file: undefined })
    expect(result.current).toEqual({ url: undefined, isLoading: false })
    unmount()
    expect(revokeObjectURL).toHaveBeenCalledTimes(2)
  })

  it('ignores pending reads after switching or unmounting without creating orphan URLs', async () => {
    const first = deferredRead()
    const second = deferredRead()
    vi.mocked(window.api.ipcApi.request).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result, rerender, unmount } = renderHook(({ file }) => usePaintingImageUrl(file), {
      initialProps: { file: svg }
    })
    rerender({ file: { ...svg, id: 'svg-2' } })
    await act(async () => first.resolve(success()))
    expect(result.current).toEqual({ url: undefined, isLoading: true })
    expect(createObjectURL).not.toHaveBeenCalled()
    unmount()
    await act(async () => second.resolve(success()))
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it('ignores an obsolete read failure after a new selection succeeds', async () => {
    const old = deferredRead()
    vi.mocked(window.api.ipcApi.request).mockReturnValueOnce(old.promise).mockResolvedValue(success())
    const warn = vi.spyOn(loggerService, 'warn').mockImplementation(() => {})
    const { result, rerender } = renderHook(({ file }) => usePaintingImageUrl(file), { initialProps: { file: svg } })
    rerender({ file: { ...svg, id: 'svg-2' } })
    await waitFor(() => expect(result.current.url).toBe('blob:painting-1'))
    await act(async () => old.reject(new Error('old entry missing')))
    expect(result.current).toEqual({ url: 'blob:painting-1', isLoading: false })
    expect(warn).not.toHaveBeenCalled()
  })

  it('keeps two instances independent across effect replay and unmount', async () => {
    vi.mocked(window.api.ipcApi.request).mockResolvedValue(success())
    const first = renderHook(() => usePaintingImageUrl(svg), { wrapper: StrictMode })
    const second = renderHook(() => usePaintingImageUrl(svg), { wrapper: StrictMode })
    await waitFor(() => expect(first.result.current.isLoading || second.result.current.isLoading).toBe(false))
    const firstUrl = first.result.current.url
    const secondUrl = second.result.current.url
    expect(firstUrl).toMatch(/^blob:/)
    expect(secondUrl).toMatch(/^blob:/)
    expect(firstUrl).not.toBe(secondUrl)
    first.unmount()
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(firstUrl)
    expect(second.result.current.url).toBe(secondUrl)
    second.unmount()
    expect(revokeObjectURL.mock.calls).toEqual([[firstUrl], [secondUrl]])
  })
})
