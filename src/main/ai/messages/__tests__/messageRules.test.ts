import { type ModelMessage, tool, type UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import {
  coalesceConsecutiveSameRole,
  ensureNonEmptyAssistantContent,
  stripHistoryReasoning,
  toModelMessages
} from '../messageRules'

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

  it('strips historical reasoning parts when stripReasoning is enabled', async () => {
    const model = await toModelMessages(
      [
        ui('user', [{ type: 'text', text: 'Q' }], 'u1'),
        ui(
          'assistant',
          [
            { type: 'reasoning', text: 'let me think about this…' },
            { type: 'text', text: 'A' }
          ],
          'a1'
        ),
        ui('user', [{ type: 'text', text: 'next' }], 'u2')
      ],
      undefined,
      undefined,
      { stripReasoning: true }
    )
    expect(model).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Q' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'A' }] },
      { role: 'user', content: [{ type: 'text', text: 'next' }] }
    ])
  })

  it('keeps historical reasoning parts by default', async () => {
    const model = await toModelMessages([
      ui('user', [{ type: 'text', text: 'Q' }], 'u1'),
      ui(
        'assistant',
        [
          { type: 'reasoning', text: 'let me think about this…' },
          { type: 'text', text: 'A' }
        ],
        'a1'
      )
    ])
    const assistant = model[1]
    expect(assistant.role).toBe('assistant')
    expect(JSON.stringify(assistant)).toContain('let me think about this…')
  })

  it('drops an assistant turn that only had reasoning when stripping', async () => {
    const model = await toModelMessages(
      [
        ui('user', [{ type: 'text', text: 'Q' }], 'u1'),
        ui('assistant', [{ type: 'reasoning', text: 'draft only' }], 'a1'),
        ui('user', [{ type: 'text', text: 'next' }], 'u2')
      ],
      undefined,
      undefined,
      { stripReasoning: true }
    )
    // a parts-emptied assistant turn converts to nothing and is dropped, so the
    // surrounding user turns coalesce (same as the empty-parts case above)
    expect(model).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Q' },
          { type: 'text', text: 'next' }
        ]
      }
    ])
  })

  it('does not mutate or rebuild the input when there is nothing to strip', async () => {
    const messages = [
      ui('user', [{ type: 'text', text: 'Q' }], 'u1'),
      ui('assistant', [{ type: 'text', text: 'A' }], 'a1')
    ]
    const model = await toModelMessages(messages, undefined, undefined, { stripReasoning: true })
    expect(model).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Q' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'A' }] }
    ])
    expect(stripHistoryReasoning(messages)).toBe(messages)
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
