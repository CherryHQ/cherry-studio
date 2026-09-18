import { describe, expect, it } from 'vitest'

import type { CherryMessagePart } from '@shared/data/types/message'

import {
  appendNoResponseErrorPart,
  hasVisibleAgentSessionPart,
  isVisibleAgentSessionPart
} from '../agentSessionNoResponse'

describe('isVisibleAgentSessionPart', () => {
  it('treats hidden part types as invisible', () => {
    expect(isVisibleAgentSessionPart({ type: 'step-start' })).toBe(false)
    expect(
      isVisibleAgentSessionPart({ type: 'data-agent-task-event', data: { event: 'started', taskId: 'task-1' } })
    ).toBe(false)
    expect(isVisibleAgentSessionPart({ type: 'data-knowledge-scope', data: { baseIds: ['kb-1'] } })).toBe(false)
  })

  it('filters empty text and non-streaming empty reasoning, but keeps real content', () => {
    expect(isVisibleAgentSessionPart({ type: 'text', text: '   ' })).toBe(false)
    expect(isVisibleAgentSessionPart({ type: 'text', text: 'answer' })).toBe(true)
    expect(isVisibleAgentSessionPart({ type: 'reasoning', state: 'done', text: '' })).toBe(false)
    expect(isVisibleAgentSessionPart({ type: 'reasoning', state: 'streaming', text: '' })).toBe(true)
    expect(
      isVisibleAgentSessionPart({
        type: 'tool-read_file',
        state: 'output-available',
        toolCallId: 't1',
        input: {},
        output: {}
      })
    ).toBe(true)
  })

  it('judges whole part arrays with the same rule the renderer uses for the fallback', () => {
    const hiddenOnly: CherryMessagePart[] = [
      { type: 'data-agent-task-event', data: { event: 'started', taskId: 'task-1' } },
      { type: 'step-start' }
    ]
    const emptyOnly: CherryMessagePart[] = [{ type: 'text', text: ' ' }]
    const normal: CherryMessagePart[] = [{ type: 'step-start' }, { type: 'text', text: 'answer' }]
    expect(hasVisibleAgentSessionPart(hiddenOnly)).toBe(false)
    expect(hasVisibleAgentSessionPart(emptyOnly)).toBe(false)
    expect(hasVisibleAgentSessionPart(normal)).toBe(true)
    expect(hasVisibleAgentSessionPart(undefined)).toBe(false)
  })
})

describe('appendNoResponseErrorPart', () => {
  it('appends exactly one no-response error part and preserves the rest of the data', () => {
    const data = { parts: [{ type: 'text', text: 'partial' }] as CherryMessagePart[], turnOptions: {} }
    const result = appendNoResponseErrorPart(data, {
      message: 'no output',
      i18nKey: 'agent_turn_no_output',
      reason: 'empty-success-terminal'
    })

    expect(result.parts).toHaveLength(2)
    expect(result.parts?.[1]).toMatchObject({
      type: 'data-error',
      data: {
        name: 'AgentRuntimeError',
        message: 'no output',
        stack: null,
        i18nKey: 'agent_turn_no_output',
        reason: 'empty-success-terminal'
      }
    })
    expect(result.turnOptions).toBe(data.turnOptions)
  })

  it('leaves data that already carries a data-error part untouched', () => {
    const data = { parts: [{ type: 'data-error', data: { message: 'boom' } }] as CherryMessagePart[] }
    expect(appendNoResponseErrorPart(data, { message: 'no output' })).toBe(data)
  })
})
