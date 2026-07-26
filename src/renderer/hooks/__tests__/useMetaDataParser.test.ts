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
})
