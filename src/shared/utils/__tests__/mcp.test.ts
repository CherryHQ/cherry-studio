import { describe, expect, it } from 'vitest'

import { isMcpContentBlock, stripMcpImageData } from '@shared/utils/mcp'

describe('isMcpContentBlock', () => {
  it('accepts an asset-only image block after history sanitization', () => {
    expect(isMcpContentBlock({ type: 'image', assetId: 'file-1', mimeType: 'image/png' })).toBe(true)
  })
  it.each([
    ['text', { type: 'text', text: 'hello' }],
    ['image', { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }],
    ['audio', { type: 'audio', data: 'UklGRg==', mimeType: 'audio/wav' }],
    ['resource_link', { type: 'resource_link', uri: 'file:///a.txt', name: 'a.txt' }],
    ['embedded text resource', { type: 'resource', resource: { uri: 'file:///a.txt', text: 'hi' } }],
    ['embedded blob resource', { type: 'resource', resource: { uri: 'file:///a.png', blob: 'iVBORw0KGgo=' } }]
  ])('accepts a spec-shaped %s block', (_name, block) => {
    expect(isMcpContentBlock(block)).toBe(true)
  })

  it.each([
    ['non-object', 'plain string'],
    ['missing text', { type: 'text' }],
    [
      'Anthropic-style image (source instead of data/mimeType)',
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' }
      }
    ],
    ['resource without uri', { type: 'resource', resource: { text: 'hi' } }],
    ['unknown type', { type: 'tool_use', id: 'x' }]
  ])('rejects %s', (_name, value) => {
    expect(isMcpContentBlock(value)).toBe(false)
  })
})

describe('stripMcpImageData', () => {
  it('removes bytes only when an asset id is present and preserves other payloads', () => {
    const value = {
      content: [
        { type: 'image', data: 'BASE64', assetId: 'file-1', mimeType: 'image/png' },
        { type: 'image', data: 'KEEP', mimeType: 'image/png' },
        { type: 'text', text: 'done' }
      ]
    }
    expect(stripMcpImageData(value)).toEqual({
      content: [
        { type: 'image', assetId: 'file-1', mimeType: 'image/png' },
        { type: 'image', data: 'KEEP', mimeType: 'image/png' },
        { type: 'text', text: 'done' }
      ]
    })
  })
})
