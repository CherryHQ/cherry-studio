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
