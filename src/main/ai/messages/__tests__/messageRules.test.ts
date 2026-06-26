import { convertToModelMessages, type ModelMessage, type UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { coalesceConsecutiveSameRole, ensureNonEmptyAssistantContent, normalizeUIMessages } from '../messageRules'

const ui = (role: UIMessage['role'], parts: UIMessage['parts'], id = 'm'): UIMessage => ({ id, role, parts })

describe('normalizeUIMessages', () => {
  it('applies media gating as part of the pipeline', () => {
    const msgs: UIMessage[] = [
      ui('user', [{ type: 'file', mediaType: 'image/png', url: 'data:application/octet-stream;base64,AA' }])
    ]
    const [out] = normalizeUIMessages(msgs, { mediaCapabilities: { image: false, video: true, audio: true } })
    expect(out.parts).toEqual([{ type: 'text', text: expect.stringContaining('image attachment omitted') }])
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

  it('a data-error-only assistant turn converts to empty content, then gets rescued (#16195)', async () => {
    const msg = ui('assistant', [{ type: 'data-error', data: { message: 'boom' } }])
    const converted = await convertToModelMessages(normalizeUIMessages([msg]))
    expect(converted).toEqual([{ role: 'assistant', content: [] }]) // the Gemini-400 shape
    expect(ensureNonEmptyAssistantContent(converted)).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: '...' }] }
    ])
  })

  it('the full pipeline produces no empty assistant content for the #16195 interrupted-reply flow', async () => {
    // user Q → interrupted assistant turn persisted as data-error → user 继续
    const messages: UIMessage[] = [
      ui('user', [{ type: 'text', text: 'Q' }], 'u1'),
      ui('assistant', [{ type: 'data-error', data: {} }], 'a1'),
      ui('user', [{ type: 'text', text: '继续' }], 'u2')
    ]
    const model = ensureNonEmptyAssistantContent(
      coalesceConsecutiveSameRole(await convertToModelMessages(normalizeUIMessages(messages)))
    )
    expect(model).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Q' }] },
      { role: 'assistant', content: [{ type: 'text', text: '...' }] },
      { role: 'user', content: [{ type: 'text', text: '继续' }] }
    ])
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

  it('leaves an alternating sequence unchanged', () => {
    const msgs = [
      { role: 'user', content: [{ type: 'text', text: 'a' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'b' }] }
    ] as ModelMessage[]
    expect(coalesceConsecutiveSameRole(msgs)).toHaveLength(2)
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
