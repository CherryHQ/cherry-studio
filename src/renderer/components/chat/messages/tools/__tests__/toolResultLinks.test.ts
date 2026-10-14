import { describe, expect, it } from 'vitest'

import { getToolResultLinks } from '../shared/toolResultLinks'

describe('tool result links', () => {
  it('recognizes an image pathname without treating query strings or fragments as file extensions', () => {
    expect(getToolResultLinks({ type: 'text', text: 'https://example.com/result.PNG?signature=abc#preview' })).toEqual([
      { url: 'https://example.com/result.PNG?signature=abc#preview', isImage: true }
    ])
    expect(getToolResultLinks({ type: 'text', text: 'https://example.com/page?file=result.png' })?.[0].isImage).toBe(
      false
    )
  })

  it('uses resource MIME metadata ahead of the pathname', () => {
    expect(
      getToolResultLinks({
        type: 'resource_link',
        uri: 'https://example.com/download?id=1',
        name: 'image',
        mimeType: 'image/webp'
      })?.[0].isImage
    ).toBe(true)
    expect(
      getToolResultLinks({
        type: 'resource_link',
        uri: 'https://example.com/not-an-image.png',
        name: 'page',
        mimeType: 'text/html'
      })?.[0].isImage
    ).toBe(false)
  })

  it('unwraps JSON URL strings and lists without dropping structured data', () => {
    expect(getToolResultLinks({ type: 'text', text: '"https://example.com/image.webp"' })?.[0].isImage).toBe(true)
    expect(
      getToolResultLinks({ type: 'text', text: '["https://example.com/a.png","https://example.com/docs"]' })
    ).toEqual([
      { url: 'https://example.com/a.png', isImage: true },
      { url: 'https://example.com/docs', isImage: false }
    ])
    expect(
      getToolResultLinks({ type: 'text', text: '{"status":"ready","url":"https://example.com/a.png"}' })
    ).toBeNull()
    expect(
      getToolResultLinks({ type: 'text', text: '["https://example.com/a.png","Image generation failed"]' })
    ).toBeNull()
  })

  it.each(['javascript:alert(1)', 'file:///tmp/a.png', 'data:image/svg+xml,<svg/>', 'https://example.com/a.png extra'])(
    'does not turn unsupported or non-URL text into an active link: %s',
    (value) => expect(getToolResultLinks({ type: 'text', text: value })).toBeNull()
  )
})
