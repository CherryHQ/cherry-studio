import { convertToModelMessages, type UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { ensureNonEmptyAssistantParts, normalizeUIMessages } from '../messageRules'

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
