import type { CallToolResult } from '@modelcontextprotocol/client'
import { describe, expect, it } from 'vitest'

import { mcpResultToModelOutput, mcpResultToTextSummary } from '../utils'

describe('mcpResultToTextSummary', () => {
  it.each([null, false, 0, 'value', [1, 2], { answer: 42 }])(
    'includes structured-only JSON: %j',
    (structuredContent) => {
      expect(mcpResultToTextSummary({ content: [], structuredContent })).toBe(JSON.stringify(structuredContent))
    }
  )

  it('preserves media and text, without repeating the structured JSON fallback', () => {
    const result = {
      content: [
        { type: 'text' as const, text: 'Answer' },
        { type: 'image' as const, data: 'x', mimeType: 'image/png' }
      ],
      structuredContent: { answer: 42 }
    }
    expect(mcpResultToTextSummary(result)).toBe(
      'Answer\n[Image: image/png — the model cannot see this content]\n{"answer":42}'
    )
    expect(
      mcpResultToTextSummary({
        ...result,
        content: [{ type: 'text', text: '{ "answer": 42 }' }]
      })
    ).toBe('{ "answer": 42 }')
    expect(result.content).toHaveLength(2)
  })

  it('returns JSON string for null / invalid shapes', () => {
    expect(mcpResultToTextSummary(null as unknown as CallToolResult)).toBe('null')
    expect(mcpResultToTextSummary({} as CallToolResult)).toBe('{}')
    expect(mcpResultToTextSummary({ content: 'not-an-array' } as unknown as CallToolResult)).toContain('"not-an-array"')
  })
})

describe('MCP tool-result delivery', () => {
  it.each([
    { structuredContent: null, text: 'null' },
    { structuredContent: false, text: 'false' },
    { structuredContent: [1, 2], text: '[1,2]' }
  ])('preserves structured-only output for the model: $text', ({ structuredContent, text }) => {
    expect(mcpResultToModelOutput({ content: [], structuredContent })).toEqual({ type: 'text', value: text })
  })

  it('keeps structured output beside native media without duplicating a JSON fallback', () => {
    const image = { type: 'image' as const, data: 'aW1hZ2U=', mimeType: 'image/png' }
    const fallback = { type: 'text' as const, text: '[1,2]' }
    const expected = {
      type: 'content',
      value: [{ type: 'image-data', data: image.data, mediaType: image.mimeType }, fallback]
    }
    expect(mcpResultToModelOutput({ content: [image], structuredContent: [1, 2] })).toEqual(expected)
    expect(mcpResultToModelOutput({ content: [image, fallback], structuredContent: [1, 2] })).toEqual(expected)
  })

  it.each([
    { type: 'image', mimeType: 'image/png', outputType: 'image-data' },
    { type: 'audio', mimeType: 'audio/wav', outputType: 'file-data' }
  ] as const)('delivers $type bytes as native media, not encoded text', ({ type, mimeType, outputType }) => {
    const data = Buffer.from('tool media bytes').toString('base64')
    const output = mcpResultToModelOutput({ content: [{ type, data, mimeType }] })

    expect(output).toEqual({
      type: 'content',
      value: [{ type: outputType, data, mediaType: mimeType }]
    })
  })

  it('keeps descriptions and resources in their original positions between media blocks', () => {
    const firstImage = Buffer.from('first image').toString('base64')
    const secondImage = Buffer.from('second image').toString('base64')
    const audio = Buffer.from('recording').toString('base64')
    const output = mcpResultToModelOutput({
      content: [
        { type: 'text', text: 'Before:' },
        { type: 'image', data: firstImage, mimeType: 'image/png' },
        { type: 'text', text: 'After:' },
        { type: 'image', data: secondImage, mimeType: 'image/png' },
        { type: 'resource', resource: { uri: 'note://source', text: 'Audio commentary:' } },
        { type: 'audio', data: audio, mimeType: 'audio/wav' },
        { type: 'text', text: 'Compare the two images.' }
      ]
    })

    expect(output).toEqual({
      type: 'content',
      value: [
        { type: 'text', text: 'Before:' },
        { type: 'image-data', data: firstImage, mediaType: 'image/png' },
        { type: 'text', text: 'After:' },
        { type: 'image-data', data: secondImage, mediaType: 'image/png' },
        { type: 'text', text: 'Audio commentary:' },
        { type: 'file-data', data: audio, mediaType: 'audio/wav' },
        { type: 'text', text: 'Compare the two images.' }
      ]
    })
  })

  it('keeps binary payloads out of text summaries while preserving readable content', () => {
    const data = Buffer.from('binary payload must not consume text context').toString('base64')
    const result: CallToolResult = {
      content: [
        { type: 'text', text: 'Result description' },
        { type: 'image', data, mimeType: 'image/png' },
        { type: 'audio', data, mimeType: 'audio/wav' },
        { type: 'resource', resource: { uri: 'file://report.pdf', mimeType: 'application/pdf', blob: data } },
        { type: 'resource', resource: { uri: 'note://source', text: 'Readable source' } }
      ]
    }

    const summary = mcpResultToTextSummary(result)
    expect(summary).not.toContain(data)
    expect(summary).toContain('Result description')
    expect(summary).toContain('Readable source')
  })
})
