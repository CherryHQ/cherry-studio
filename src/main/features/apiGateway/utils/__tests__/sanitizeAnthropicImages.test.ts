import type { ContentBlockParam, MessageParam } from '@anthropic-ai/sdk/resources/messages'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { sanitizeAnthropicRequestImages, UNDECODABLE_IMAGE_PLACEHOLDER } from '../sanitizeAnthropicImages'

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64'
)

async function truncatedPng(): Promise<Buffer> {
  const valid = await sharp({ create: { width: 120, height: 50, channels: 3, background: '#ff0000' } })
    .png()
    .toBuffer()
  return valid.subarray(0, Math.floor(valid.length / 2))
}

describe('sanitizeAnthropicRequestImages', () => {
  it('replaces a top-level undecodable image with a text placeholder', async () => {
    const corrupt = (await truncatedPng()).toString('base64')
    const messages: MessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'see this' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: corrupt } }
        ]
      }
    ]

    const { messages: out, replacedCount } = await sanitizeAnthropicRequestImages(messages)

    expect(replacedCount).toBe(1)
    expect(out[0].content).toEqual([
      { type: 'text', text: 'see this' },
      { type: 'text', text: UNDECODABLE_IMAGE_PLACEHOLDER }
    ])
  })

  it('replaces undecodable images nested in tool_result content', async () => {
    const corrupt = (await truncatedPng()).toString('base64')
    const messages: MessageParam[] = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'read-1',
            content: [
              { type: 'text', text: 'Read broken.png' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: corrupt } }
            ]
          }
        ]
      }
    ]

    const { messages: out, replacedCount } = await sanitizeAnthropicRequestImages(messages)

    expect(replacedCount).toBe(1)
    const block = (out[0].content as ContentBlockParam[])[0]
    expect(block.type).toBe('tool_result')
    if (block.type !== 'tool_result' || !Array.isArray(block.content)) {
      throw new Error('expected tool_result with array content')
    }
    expect(block.content).toEqual([
      { type: 'text', text: 'Read broken.png' },
      { type: 'text', text: UNDECODABLE_IMAGE_PLACEHOLDER }
    ])
  })

  it('leaves decodable images untouched', async () => {
    const messages: MessageParam[] = [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: PNG_1X1.toString('base64') }
          }
        ]
      }
    ]

    const { messages: out, replacedCount } = await sanitizeAnthropicRequestImages(messages)

    expect(replacedCount).toBe(0)
    expect(out).toBe(messages)
  })
})
