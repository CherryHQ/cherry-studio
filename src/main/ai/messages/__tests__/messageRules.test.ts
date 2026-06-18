import { convertToModelMessages, type ModelMessage, type UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { coalesceConsecutiveSameRole, ensureNonEmptyAssistantParts, normalizeUIMessages } from '../messageRules'

const ui = (role: UIMessage['role'], parts: UIMessage['parts'], id = 'm'): UIMessage => ({ id, role, parts })

describe('ensureNonEmptyAssistantParts', () => {
  it('adds a placeholder to an assistant message with empty parts (#16195)', () => {
    const [out] = ensureNonEmptyAssistantParts([ui('assistant', [])])
    expect(out.parts).toEqual([{ type: 'text', text: '...' }])
  })

  it('treats a step-start-only assistant message as empty', () => {
    const [out] = ensureNonEmptyAssistantParts([ui('assistant', [{ type: 'step-start' }])])
    expect(out.parts).toEqual([{ type: 'step-start' }, { type: 'text', text: '...' }])
  })

  it('leaves an assistant message with content parts untouched (same reference)', () => {
    const msg = ui('assistant', [{ type: 'text', text: 'hi' }])
    expect(ensureNonEmptyAssistantParts([msg])[0]).toBe(msg)
  })

  it('leaves user messages untouched even when empty', () => {
    const msg = ui('user', [])
    expect(ensureNonEmptyAssistantParts([msg])[0]).toBe(msg)
  })
})

describe('normalizeUIMessages', () => {
  it('keeps the empty assistant turn as non-empty model content, preserving the turn (#16195)', async () => {
    // The exact issue flow: question → empty assistant turn → "继续".
    const messages: UIMessage[] = [
      ui('user', [{ type: 'text', text: 'Q' }], 'u1'),
      ui('assistant', [], 'a1'),
      ui('user', [{ type: 'text', text: '继续' }], 'u2')
    ]

    // Without normalization the AI SDK drops the empty assistant turn (2 turns);
    // with it the turn survives with non-empty content (3 turns).
    expect(await convertToModelMessages(messages)).toHaveLength(2)
    expect(await convertToModelMessages(normalizeUIMessages(messages))).toEqual([
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
