import type { MCPCallToolResponse } from '@types'
import { describe, expect, it } from 'vitest'

import { hasMultimodalContent, mcpResultToTextSummary } from '../utils'

describe('mcpResultToTextSummary', () => {
  it('returns JSON string for null / invalid shapes', () => {
    expect(mcpResultToTextSummary(null as unknown as MCPCallToolResponse)).toBe('null')
    expect(mcpResultToTextSummary({} as MCPCallToolResponse)).toBe('{}')
    expect(mcpResultToTextSummary({ content: 'not-an-array' } as unknown as MCPCallToolResponse)).toContain(
      '"not-an-array"'
    )
  })

  it('joins text parts verbatim', () => {
    const out = mcpResultToTextSummary({
      content: [
        { type: 'text', text: 'hello' },
        { type: 'text', text: 'world' }
      ]
    })
    expect(out).toBe('hello\nworld')
  })

  it('turns image parts into placeholders', () => {
    const out = mcpResultToTextSummary({
      content: [{ type: 'image', data: 'base64', mimeType: 'image/png' }]
    })
    expect(out).toBe('[Image: image/png, delivered to user]')
  })

  it('turns audio parts into placeholders', () => {
    const out = mcpResultToTextSummary({
      content: [{ type: 'audio', data: 'base64', mimeType: 'audio/mp3' }]
    })
    expect(out).toBe('[Audio: audio/mp3, delivered to user]')
  })

  it('uses placeholder for blob resources, text for inline resources', () => {
    const blob = mcpResultToTextSummary({
      content: [
        {
          type: 'resource',
          resource: { uri: 'file://x.pdf', mimeType: 'application/pdf', blob: 'base64' }
        }
      ]
    })
    expect(blob).toBe('[Resource: application/pdf, uri=file://x.pdf, delivered to user]')

    const inlineText = mcpResultToTextSummary({
      content: [{ type: 'resource', resource: { uri: 'note://a', text: 'the body' } }]
    })
    expect(inlineText).toBe('the body')
  })

  it('mixes part types in declaration order', () => {
    const out = mcpResultToTextSummary({
      content: [
        { type: 'text', text: 'intro' },
        { type: 'image', data: 'x', mimeType: 'image/jpeg' },
        { type: 'text', text: 'outro' }
      ]
    })
    expect(out).toBe('intro\n[Image: image/jpeg, delivered to user]\noutro')
  })

  it('defaults to JSON.stringify for unknown part types', () => {
    const out = mcpResultToTextSummary({
      content: [{ type: 'future-kind', payload: 42 } as never]
    })
    expect(out).toContain('"future-kind"')
    expect(out).toContain('42')
  })
})

describe('hasMultimodalContent', () => {
  it('false for pure text', () => {
    expect(
      hasMultimodalContent({
        content: [{ type: 'text', text: 'hi' }]
      })
    ).toBe(false)
  })

  it('true when an image part exists', () => {
    expect(
      hasMultimodalContent({
        content: [{ type: 'image', data: 'x', mimeType: 'image/png' }]
      })
    ).toBe(true)
  })

  it('true when an audio part exists', () => {
    expect(
      hasMultimodalContent({
        content: [{ type: 'audio', data: 'x', mimeType: 'audio/wav' }]
      })
    ).toBe(true)
  })

  it('true only for blob-backed resources, not text-backed', () => {
    expect(
      hasMultimodalContent({
        content: [{ type: 'resource', resource: { uri: 'u', text: 'body' } }]
      })
    ).toBe(false)
    expect(
      hasMultimodalContent({
        content: [{ type: 'resource', resource: { uri: 'u', blob: 'b' } }]
      })
    ).toBe(true)
  })

  it('false for empty or malformed input', () => {
    expect(hasMultimodalContent({ content: [] })).toBe(false)
    expect(hasMultimodalContent(null as unknown as MCPCallToolResponse)).toBe(false)
  })
})
