import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  net: {
    fetch: fetchMock
  }
}))

import { fetchWebSearchContent } from '../fetchContent'

function createTextResponse(body: string, contentType: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'content-type': contentType
    }
  })
}

describe('fetchWebSearchContent', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('normalizes empty readability output to an empty string', async () => {
    fetchMock.mockResolvedValue(createTextResponse('<html><body><div></div></body></html>', 'text/html'))

    const result = await fetchWebSearchContent('https://example.com/article', false)

    expect(result).toEqual({
      title: 'https://example.com/article',
      url: 'https://example.com/article',
      content: ''
    })
  })
})
