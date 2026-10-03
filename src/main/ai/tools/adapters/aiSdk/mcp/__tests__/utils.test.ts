import { describe, expect, it } from 'vitest'

import type { McpCallToolResponse } from '@main/ai/mcp/types'

import { hasMultimodalContent, mcpResultToModelOutput, mcpResultToTextSummary } from '../utils'

describe('mcpResultToTextSummary', () => {
  it('returns JSON string for null / invalid shapes', () => {
    expect(mcpResultToTextSummary(null as unknown as McpCallToolResponse)).toBe('null')
    expect(mcpResultToTextSummary({} as McpCallToolResponse)).toBe('{}')
    expect(mcpResultToTextSummary({ content: 'not-an-array' } as unknown as McpCallToolResponse)).toContain(
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

  it('turns image parts into honest placeholders (never "delivered")', () => {
    const out = mcpResultToTextSummary({
      content: [{ type: 'image', data: 'base64', mimeType: 'image/png' }]
    })
    expect(out).toBe('[Image: image/png — the model cannot see this content]')
    expect(out).not.toContain('delivered to user')
  })

  it('turns audio parts into honest placeholders (never "delivered")', () => {
    const out = mcpResultToTextSummary({
      content: [{ type: 'audio', data: 'base64', mimeType: 'audio/mp3' }]
    })
    expect(out).toBe('[Audio: audio/mp3 — the model cannot see this content]')
    expect(out).not.toContain('delivered to user')
  })

  it('uses an honest placeholder for blob resources, text for inline resources', () => {
    const blob = mcpResultToTextSummary({
      content: [
        {
          type: 'resource',
          resource: { uri: 'file://x.pdf', mimeType: 'application/pdf', blob: 'base64' }
        }
      ]
    })
    expect(blob).toBe('[Resource: application/pdf, uri=file://x.pdf — the model cannot see this content]')
    expect(blob).not.toContain('delivered to user')

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
    expect(out).toBe('intro\n[Image: image/jpeg — the model cannot see this content]\noutro')
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
    expect(hasMultimodalContent(null as unknown as McpCallToolResponse)).toBe(false)
  })
})

describe('mcpResultToModelOutput', () => {
  it('forwards an image part as structured media instead of a text stub', () => {
    const out = mcpResultToModelOutput({
      content: [{ type: 'image', data: 'png-base64', mimeType: 'image/png' }]
    })
    expect(out).toEqual({
      type: 'content',
      value: [{ type: 'image-data', data: 'png-base64', mediaType: 'image/png' }]
    })
  })

  it('forwards an audio part as structured media', () => {
    const out = mcpResultToModelOutput({
      content: [{ type: 'audio', data: 'wav-base64', mimeType: 'audio/wav' }]
    })
    expect(out).toEqual({
      type: 'content',
      value: [{ type: 'file-data', data: 'wav-base64', mediaType: 'audio/wav' }]
    })
  })

  it('keeps text verbatim ahead of the media and fills missing mime types', () => {
    const out = mcpResultToModelOutput({
      content: [
        { type: 'text', text: 'chart:' },
        { type: 'image', data: 'img' },
        { type: 'audio', data: 'aud' }
      ]
    })
    expect(out).toEqual({
      type: 'content',
      value: [
        { type: 'text', text: 'chart:' },
        { type: 'image-data', data: 'img', mediaType: 'image/png' },
        { type: 'file-data', data: 'aud', mediaType: 'audio/mp3' }
      ]
    })
  })

  it('stays a plain text output when the result carries no media', () => {
    expect(mcpResultToModelOutput({ content: [{ type: 'text', text: 'hello' }] })).toEqual({
      type: 'text',
      value: 'hello'
    })
    expect(
      mcpResultToModelOutput({
        content: [{ type: 'resource', resource: { uri: 'note://a', text: 'the body' } }]
      })
    ).toEqual({ type: 'text', value: 'the body' })
  })

  it('replaces blob resources with an honest stub (binary never reaches the model)', () => {
    const out = mcpResultToModelOutput({
      content: [{ type: 'resource', resource: { uri: 'file://x.pdf', mimeType: 'application/pdf', blob: 'b64' } }]
    })
    expect(out).toEqual({
      type: 'text',
      value: '[Resource: application/pdf, uri=file://x.pdf — the model cannot see this content]'
    })
  })

  it('keeps unknown part types as JSON text', () => {
    const out = mcpResultToModelOutput({ content: [{ type: 'future-kind', payload: 42 } as never] })
    expect(out).toEqual({ type: 'text', value: expect.stringContaining('future-kind') })
  })

  it('degrades a media block without data to JSON text instead of forwarding it', () => {
    const out = mcpResultToModelOutput({ content: [{ type: 'image', mimeType: 'image/png' }] })
    expect(out).toEqual({ type: 'text', value: expect.stringContaining('image/png') })
  })

  it('degrades to the text summary for malformed input', () => {
    expect(mcpResultToModelOutput(null as unknown as McpCallToolResponse)).toEqual({
      type: 'text',
      value: 'null'
    })
  })
})
