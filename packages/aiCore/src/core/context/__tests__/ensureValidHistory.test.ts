import { describe, expect, it } from 'vitest'

import { ensureValidHistory } from '../ensureValidHistory'
import type { ContextMessage } from '../types'

describe('ensureValidHistory', () => {
  it('returns empty array for empty input', () => {
    expect(ensureValidHistory([])).toEqual([])
  })

  it('passes through valid history unchanged', () => {
    const history: ContextMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'search' },
      {
        role: 'assistant',
        content: 'searching',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 's', arguments: '{}' } }]
      },
      { role: 'tool', content: 'found', tool_call_id: 'c1' },
      { role: 'assistant', content: 'done' }
    ]

    const result = ensureValidHistory(history)
    expect(result).toEqual(history)
  })

  // ─── Orphan tool results ───

  it('removes orphan tool result with no matching assistant', () => {
    const history: ContextMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'tool', content: 'orphan result', tool_call_id: 'c_nonexistent' },
      { role: 'assistant', content: 'hi' }
    ]

    const result = ensureValidHistory(history)
    expect(result).toHaveLength(2)
    expect(result[0].content).toBe('hello')
    expect(result[1].content).toBe('hi')
  })

  it('replaces with placeholder when removing all messages', () => {
    const history: ContextMessage[] = [{ role: 'tool', content: 'orphan', tool_call_id: 'c1' }]

    const result = ensureValidHistory(history)
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('user')
  })

  // ─── Missing tool results ───

  it('injects synthetic tool result for missing tool_call_id', () => {
    const history: ContextMessage[] = [
      { role: 'user', content: 'do it' },
      {
        role: 'assistant',
        content: 'running',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'run', arguments: '{}' } }]
      },
      // Missing: tool { tool_call_id: 'c1' }
      { role: 'user', content: 'what happened?' }
    ]

    const result = ensureValidHistory(history)

    // Should have injected a tool result between assistant and next user
    const toolMsg = result.find((m) => m.role === 'tool' && m.tool_call_id === 'c1')
    expect(toolMsg).toBeDefined()
    expect(toolMsg?.content).toBe('[No tool result available]')
  })

  it('does not inject when tool result already exists', () => {
    const history: ContextMessage[] = [
      { role: 'user', content: 'do it' },
      {
        role: 'assistant',
        content: 'running',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'run', arguments: '{}' } }]
      },
      { role: 'tool', content: 'done', tool_call_id: 'c1' },
      { role: 'user', content: 'thanks' }
    ]

    const result = ensureValidHistory(history)
    expect(result).toEqual(history)
  })

  it('handles parallel tool_calls with partial results', () => {
    const history: ContextMessage[] = [
      { role: 'user', content: 'search both' },
      {
        role: 'assistant',
        content: 'searching',
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'a', arguments: '{}' } },
          { id: 'c2', type: 'function', function: { name: 'b', arguments: '{}' } }
        ]
      },
      { role: 'tool', content: 'result a', tool_call_id: 'c1' },
      // c2 is missing
      { role: 'assistant', content: 'got partial results' }
    ]

    const result = ensureValidHistory(history)

    const c2Tool = result.find((m) => m.role === 'tool' && m.tool_call_id === 'c2')
    expect(c2Tool).toBeDefined()
    expect(c2Tool?.content).toBe('[No tool result available]')
  })

  // ─── First message must be user ───

  it('prepends user placeholder when first non-system message is assistant', () => {
    const history: ContextMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'hi' }
    ]

    const result = ensureValidHistory(history)
    expect(result[0].role).toBe('system')
    expect(result[1].role).toBe('user')
    expect(result[2].role).toBe('assistant')
  })

  it('does not prepend when first non-system message is already user', () => {
    const history: ContextMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' }
    ]

    const result = ensureValidHistory(history)
    expect(result).toEqual(history)
  })

  it('does not modify input array', () => {
    const history: ContextMessage[] = [
      { role: 'tool', content: 'orphan', tool_call_id: 'c1' },
      { role: 'assistant', content: 'hi' }
    ]
    const original = [...history]

    ensureValidHistory(history)
    expect(history).toEqual(original)
  })
})
