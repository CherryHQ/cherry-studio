import { describe, expect, it } from 'vitest'

import type { McpCallToolResponse } from '@main/ai/mcp/types'

import { mcpResultToModelOutput, mcpResultToTextSummary } from '../utils'

describe('MCP tool-result delivery', () => {
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

  it('preserves text and inline resource contents alongside media', () => {
    const text = 'The chart shows revenue in CNY.'
    const resourceText = 'Source: audited results.'
    const output = mcpResultToModelOutput({
      content: [
        { type: 'text', text },
        { type: 'resource', resource: { uri: 'note://source', text: resourceText } },
        { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' }
      ]
    })

    expect(output.type).toBe('content')
    if (output.type !== 'content') throw new Error('Expected multimodal output')
    const deliveredText = output.value.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')
    expect(deliveredText).toContain(text)
    expect(deliveredText).toContain(resourceText)
  })

  it('keeps binary payloads out of text summaries while preserving readable content', () => {
    const data = Buffer.from('binary payload must not consume text context').toString('base64')
    const result: McpCallToolResponse = {
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
