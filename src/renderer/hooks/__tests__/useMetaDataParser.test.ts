import { act, renderHook, waitFor } from '@testing-library/react'
import axios from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMetaDataParser } from '../useMetaDataParser'

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    isCancel: vi.fn(() => false)
  }
}))

const axiosMock = vi.mocked(axios, true)

describe('useMetaDataParser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('extracts document fallback metadata when Open Graph tags are absent', async () => {
    axiosMock.get.mockResolvedValueOnce({
      data: `
        <!doctype html>
        <html>
          <head>
            <title>习近平总书记的深情寄望鼓舞新时代少年儿童成长成才</title>
            <meta name="description" content="Baijiahao article summary">
            <meta property="og:imageAlt" content="Article cover image">
            <link rel="preload" as="image" href="/cover.png">
          </head>
        </html>
      `
    })

    const { result } = renderHook(() =>
      useMetaDataParser('https://baijiahao.baidu.com/s?id=1866720970921273171', [
        'title',
        'description',
        'og:imageAlt',
        'image'
      ] as const)
    )

    await act(async () => {
      await result.current.parseMetadata()
    })

    await waitFor(() => {
      expect(result.current.metadata).toEqual({
        title: '习近平总书记的深情寄望鼓舞新时代少年儿童成长成才',
        description: 'Baijiahao article summary',
        'og:imageAlt': 'Article cover image',
        image: 'https://baijiahao.baidu.com/cover.png'
      })
    })
  })

  it('keeps the loading state while a superseded request is still in flight', async () => {
    axiosMock.isCancel.mockImplementation((error: unknown) => (error as { name?: string })?.name === 'AbortError')

    let rejectFirst!: (reason?: unknown) => void
    axiosMock.get.mockImplementationOnce(
      (_url, config) =>
        new Promise((_resolve, reject) => {
          rejectFirst = (reason) => reject(reason)
          config?.signal?.addEventListener?.('abort', () => rejectFirst(new DOMException('aborted', 'AbortError')), {
            once: true
          })
        })
    )
    let resolveSecond!: (value: { data: string }) => void
    axiosMock.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve
        })
    )

    const { result } = renderHook(() => useMetaDataParser('https://example.com/post', ['title']))

    // First request starts while show = true
    act(() => {
      void result.current.parseMetadata()
    })
    expect(axiosMock.get).toHaveBeenCalledTimes(1)
    expect(result.current.isLoading).toBe(true)

    // show toggles away and back: the effect fires again while the first request is in flight
    act(() => {
      void result.current.parseMetadata()
    })
    expect(axiosMock.get).toHaveBeenCalledTimes(2)
    expect(result.current.isLoading).toBe(true)

    // The superseded request settles: its finally must not reset the loading
    // state while the replacement request is still in flight
    await act(async () => {
      rejectFirst(new DOMException('aborted', 'AbortError'))
    })
    expect(result.current.isLoading).toBe(true)
    expect(result.current.metadata).toEqual({})

    // The replacement request completes normally
    await act(async () => {
      resolveSecond({ data: '<html><head><title>hello</title></head></html>' })
    })
    expect(result.current.metadata.title).toBe('hello')
    expect(result.current.isLoading).toBe(false)
  })
})
