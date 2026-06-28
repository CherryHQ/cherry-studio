import { describe, expect, it } from 'vitest'

import { parseMcpToolResultContent } from '../mcpToolResult'

describe('parseMcpToolResultContent', () => {
  it('returns displayable MCP tool result content', () => {
    expect(
      parseMcpToolResultContent({
        content: [
          { type: 'text', text: 'done' },
          { type: 'image', data: 'base64', mimeType: 'image/png' },
          { type: 'resource', resource: { uri: 'file:///tmp/result.txt', text: 'result' } }
        ],
        isError: false
      })
    ).toEqual([
      { type: 'text', text: 'done' },
      { type: 'image', data: 'base64', mimeType: 'image/png' },
      { type: 'resource', resource: { uri: 'file:///tmp/result.txt' } }
    ])
  })

  it('accepts valid MCP content blocks that these renderers ignore', () => {
    expect(
      parseMcpToolResultContent({
        content: [
          { type: 'audio', data: 'base64', mimeType: 'audio/wav' },
          { type: 'resource_link', uri: 'file:///tmp/result.txt', name: 'result.txt' }
        ]
      })
    ).toEqual([{ type: 'audio' }, { type: 'resource_link' }])
  })

  it('returns null for non-MCP tool result shapes', () => {
    expect(parseMcpToolResultContent({ value: 'plain output' })).toBeNull()
    expect(parseMcpToolResultContent({ content: [{ type: 'text' }] })).toBeNull()
    expect(parseMcpToolResultContent({ content: [{ type: 'unknown', value: 'x' }] })).toBeNull()
  })
})
