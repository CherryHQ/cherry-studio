import type { MCPCallToolResponse } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import {
  mcpToolCallResponseToOpenAIChatToolContent,
  mcpToolCallResponseToOpenAIResponsesOutput
} from '../mcp-tool-content'

describe('mcpToolCallResponseToOpenAIResponsesOutput', () => {
  it('returns structured array with input_text and input_image for vision model', () => {
    const resp: MCPCallToolResponse = {
      content: [
        { type: 'text', text: 'Analysis complete' },
        { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }
      ]
    }
    const result = mcpToolCallResponseToOpenAIResponsesOutput(resp, true)
    expect(Array.isArray(result)).toBe(true)
    const parts = result as Array<any>
    expect(parts).toHaveLength(2)
    expect(parts[0]).toEqual({ type: 'input_text', text: 'Analysis complete' })
    expect(parts[1]).toEqual({
      type: 'input_image',
      image_url: 'data:image/png;base64,iVBORw0KGgo=',
      detail: 'auto'
    })
  })

  it('returns JSON string for non-vision model', () => {
    const resp: MCPCallToolResponse = {
      content: [
        { type: 'text', text: 'hello' },
        { type: 'image', data: 'abc', mimeType: 'image/png' }
      ]
    }
    const result = mcpToolCallResponseToOpenAIResponsesOutput(resp, false)
    expect(typeof result).toBe('string')
    expect(result).toBe(JSON.stringify(resp.content))
  })

  it('returns JSON string for error response', () => {
    const resp: MCPCallToolResponse = {
      isError: true,
      content: [{ type: 'text', text: 'Something failed' }]
    }
    const result = mcpToolCallResponseToOpenAIResponsesOutput(resp, true)
    expect(typeof result).toBe('string')
    expect(result).toBe(JSON.stringify(resp.content))
  })

  it('returns text placeholder when image data is missing', () => {
    const resp: MCPCallToolResponse = {
      content: [{ type: 'image', mimeType: 'image/png' }]
    }
    const result = mcpToolCallResponseToOpenAIResponsesOutput(resp, true)
    expect(Array.isArray(result)).toBe(true)
    const parts = result as Array<any>
    expect(parts[0]).toEqual({ type: 'input_text', text: '[Image result omitted: missing image data]' })
  })

  it('summarizes audio content as text for vision model', () => {
    const resp: MCPCallToolResponse = {
      content: [{ type: 'audio', data: 'audiodata', mimeType: 'audio/mp3' }]
    }
    const result = mcpToolCallResponseToOpenAIResponsesOutput(resp, true)
    expect(Array.isArray(result)).toBe(true)
    const parts = result as Array<any>
    expect(parts[0]).toEqual({ type: 'input_text', text: '[Audio result: audio/mp3, base64 payload present]' })
  })

  it('summarizes resource content with text for vision model', () => {
    const resp: MCPCallToolResponse = {
      content: [{ type: 'resource', resource: { text: 'resource content', uri: 'file://test.txt' } }]
    }
    const result = mcpToolCallResponseToOpenAIResponsesOutput(resp, true)
    expect(Array.isArray(result)).toBe(true)
    const parts = result as Array<any>
    expect(parts[0]).toEqual({ type: 'input_text', text: 'resource content' })
  })

  it('summarizes resource without text for vision model', () => {
    const resp: MCPCallToolResponse = {
      content: [{ type: 'resource', resource: { uri: 'file://data.bin', mimeType: 'application/octet-stream' } }]
    }
    const result = mcpToolCallResponseToOpenAIResponsesOutput(resp, true)
    expect(Array.isArray(result)).toBe(true)
    const parts = result as Array<any>
    expect(parts[0]).toEqual({
      type: 'input_text',
      text: '[Resource result: file://data.bin (application/octet-stream)]'
    })
  })
})

describe('mcpToolCallResponseToOpenAIChatToolContent', () => {
  it('joins multiple text items with newlines', () => {
    const resp: MCPCallToolResponse = {
      content: [
        { type: 'text', text: 'line one' },
        { type: 'text', text: 'line two' }
      ]
    }
    const result = mcpToolCallResponseToOpenAIChatToolContent(resp, false)
    expect(result).toBe('line one\nline two')
  })

  it('returns summarized text for vision model with mixed content', () => {
    const resp: MCPCallToolResponse = {
      content: [
        { type: 'text', text: 'Description' },
        { type: 'image', data: 'abc', mimeType: 'image/jpeg' }
      ]
    }
    const result = mcpToolCallResponseToOpenAIChatToolContent(resp, true)
    expect(result).toBe('Description\n[Image result: image/jpeg, base64 payload present]')
  })

  it('returns JSON string for error response', () => {
    const resp: MCPCallToolResponse = {
      isError: true,
      content: [{ type: 'text', text: 'Error occurred' }]
    }
    const result = mcpToolCallResponseToOpenAIChatToolContent(resp, false)
    expect(result).toBe(JSON.stringify(resp.content))
  })

  it('stringifies non-text items for non-vision model', () => {
    const resp: MCPCallToolResponse = {
      content: [
        { type: 'text', text: 'hello' },
        { type: 'image', data: 'img', mimeType: 'image/png' }
      ]
    }
    const result = mcpToolCallResponseToOpenAIChatToolContent(resp, false)
    expect(result).toContain('hello')
    expect(result).toContain('"type":"image"')
  })

  it('handles empty text gracefully', () => {
    const resp: MCPCallToolResponse = {
      content: [{ type: 'text' }]
    }
    const result = mcpToolCallResponseToOpenAIChatToolContent(resp, false)
    expect(result).toBe('')
  })
})
