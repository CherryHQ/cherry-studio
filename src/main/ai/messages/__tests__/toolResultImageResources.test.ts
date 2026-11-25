import { describe, expect, it } from 'vitest'

import { parseToolResultImageUrl, projectToolResultImageResources } from '../toolResultImageResources'

const ref = { topicId: 'topic:1', messageId: 'message/1', toolCallId: 'call 1' }

describe('tool result image resource projection', () => {
  it('replaces oversized inline bytes with latest-identity links and keeps sibling resources', () => {
    const output = {
      content: [
        { type: 'text', text: 'caption' },
        { type: 'image', data: 'A'.repeat(2 * 1024 * 1024), mimeType: 'image/png' },
        { type: 'resource_link', uri: 'file:///existing.png', name: 'existing' },
        { type: 'image', data: 'BBBB', mimeType: 'image/jpeg' }
      ]
    }
    const preview = projectToolResultImageResources(output, ref)
    expect(JSON.stringify(preview).length).toBeLessThan(1024)
    expect(preview).toEqual({
      content: [
        output.content[0],
        {
          type: 'resource_link',
          uri: 'cherry-media://tool-result/topic%3A1/message%2F1/call%201/0',
          name: 'image',
          mimeType: 'image/png'
        },
        output.content[2],
        {
          type: 'resource_link',
          uri: 'cherry-media://tool-result/topic%3A1/message%2F1/call%201/1',
          name: 'image',
          mimeType: 'image/jpeg'
        }
      ]
    })
    expect(output.content[1]).toHaveProperty('data')
  })

  it('decodes only complete bounded image identities', () => {
    expect(parseToolResultImageUrl(new URL('cherry-media://tool-result/topic%3A1/message%2F1/call%201/0'))).toEqual({
      ...ref,
      imageIndex: 0
    })
    for (const suffix of [
      'topic/message/call/-1',
      'topic/message/call/',
      'topic/message/call/NaN',
      'topic/message/call/0/extra',
      'topic/message/%xx/0'
    ]) {
      expect(parseToolResultImageUrl(new URL(`cherry-media://tool-result/${suffix}`))).toBeUndefined()
    }
  })
})
