import { type ModelMessage, tool, type UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { coalesceConsecutiveSameRole, ensureNonEmptyAssistantContent, toModelMessages } from '../messageRules'

const ui = (role: UIMessage['role'], parts: UIMessage['parts'], id = 'm'): UIMessage => ({ id, role, parts })

// toModelMessages runs the exact Agent.stream order; these guard each step so deleting
// one (coalesce, ignoreIncompleteToolCalls, the empty-content placeholder) fails a test.
describe('toModelMessages', () => {
  it('rescues a data-error-only assistant turn (#16195)', async () => {
    const model = await toModelMessages([
      ui('user', [{ type: 'text', text: 'Q' }], 'u1'),
      ui('assistant', [{ type: 'data-error', data: {} }], 'a1'),
      ui('user', [{ type: 'text', text: '继续' }], 'u2')
    ])
    expect(model).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Q' }] },
      { role: 'assistant', content: [{ type: 'text', text: '...' }] },
      { role: 'user', content: [{ type: 'text', text: '继续' }] }
    ])
  })

  it('drops an empty-parts assistant turn and coalesces the surrounding user turns', async () => {
    const model = await toModelMessages([
      ui('user', [{ type: 'text', text: 'Q' }], 'u1'),
      ui('assistant', [], 'a1'),
      ui('user', [{ type: 'text', text: '继续' }], 'u2')
    ])
    expect(model).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Q' },
          { type: 'text', text: '继续' }
        ]
      }
    ])
  })

  it('drops an incomplete tool call (ignoreIncompleteToolCalls)', async () => {
    const model = await toModelMessages([
      ui('user', [{ type: 'text', text: 'Q' }], 'u1'),
      ui('assistant', [{ type: 'tool-test', toolCallId: '1', state: 'input-available', input: {} }], 'a1'),
      ui('user', [{ type: 'text', text: '继续' }], 'u2')
    ])
    expect(model).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Q' },
          { type: 'text', text: '继续' }
        ]
      }
    ])
  })

  it('strips media the model cannot accept', async () => {
    const model = await toModelMessages(
      [ui('user', [{ type: 'file', mediaType: 'image/png', url: 'data:application/octet-stream;base64,AA' }])],
      { image: false, video: true, audio: true }
    )
    expect(model).toEqual([
      { role: 'user', content: [{ type: 'text', text: expect.stringContaining('image attachment omitted') }] }
    ])
  })

  it('uses the tool model-output formatter when replaying completed tool results', async () => {
    const imageData = 'A'.repeat(1024)
    const rawOutput = {
      content: [{ type: 'image', data: imageData, mimeType: 'image/png' }]
    }
    const messages = [
      ui('assistant', [
        {
          type: 'tool-screenshot',
          toolCallId: 'call-1',
          state: 'output-available',
          input: {},
          output: rawOutput
        }
      ]),
      ui('user', [{ type: 'text', text: 'continue' }], 'u1')
    ]
    const originalMessages = structuredClone(messages)
    const tools = {
      screenshot: tool({
        inputSchema: z.object({}),
        toModelOutput: () => ({ type: 'text', value: '[Image: image/png, delivered to user]' })
      })
    }

    const model = await toModelMessages(messages, undefined, tools)

    expect(model[1]).toEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'screenshot',
          output: { type: 'text', value: '[Image: image/png, delivered to user]' }
        }
      ]
    })
    expect(JSON.stringify(model)).not.toContain(imageData)
    expect(messages).toEqual(originalMessages)
  })
})

describe('ensureNonEmptyAssistantContent', () => {
  it('replaces an assistant message with empty content with a placeholder', () => {
    expect(ensureNonEmptyAssistantContent([{ role: 'assistant', content: [] }])).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: '...' }] }
    ])
  })

  it('leaves non-empty and non-assistant messages untouched (same reference)', () => {
    const msgs = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }
    ] as ModelMessage[]
    const out = ensureNonEmptyAssistantContent(msgs)
    expect(out[0]).toBe(msgs[0])
    expect(out[1]).toBe(msgs[1])
  })
})

describe('coalesceConsecutiveSameRole', () => {
  it('merges adjacent same-role messages by concatenating content', () => {
    const out = coalesceConsecutiveSameRole([
      { role: 'user', content: [{ type: 'text', text: 'a' }] },
      { role: 'user', content: [{ type: 'text', text: 'b' }] }
    ] as ModelMessage[])
    expect(out).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' }
        ]
      }
    ])
  })

  it('does not merge across an intervening tool message', () => {
    const msgs = [
      { role: 'assistant', content: [{ type: 'text', text: 'x' }] },
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: '1', toolName: 't', output: { type: 'json', value: {} } }]
      },
      { role: 'assistant', content: [{ type: 'text', text: 'y' }] }
    ] as ModelMessage[]
    expect(coalesceConsecutiveSameRole(msgs)).toHaveLength(3)
  })

  it('joins string content (e.g. consecutive system messages)', () => {
    const out = coalesceConsecutiveSameRole([
      { role: 'system', content: 'a' },
      { role: 'system', content: 'b' }
    ] as ModelMessage[])
    expect(out).toEqual([{ role: 'system', content: 'a\n\nb' }])
  })
})
