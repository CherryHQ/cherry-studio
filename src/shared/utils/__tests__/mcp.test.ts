import { isMcpContentBlock } from '@shared/utils/mcp'
import { describe, expect, it } from 'vitest'

describe('isMcpContentBlock', () => {
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
