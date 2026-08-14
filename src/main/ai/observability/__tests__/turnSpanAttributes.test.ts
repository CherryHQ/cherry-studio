import type { Span } from '@opentelemetry/api'
import type { UniqueModelId } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { applyTurnInputAttributes, applyTurnOutputAttributes } from '../turnSpanAttributes'

function fakeSpan() {
  const attributes: Record<string, unknown> = {}
  const span = {
    setAttribute: (key: string, value: unknown) => {
      attributes[key] = value
    }
  } as unknown as Span
  return { span, attributes }
}

describe('applyTurnInputAttributes', () => {
  it('sets gen_ai identity + the last user message as the inputs', () => {
    const { span, attributes } = fakeSpan()
    applyTurnInputAttributes(span, {
      modelId: 'openai::gpt-4' as UniqueModelId,
      topicId: 'topic-1',
      operation: 'invoke_agent',
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'first' }] },
        { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'answer' }] },
        { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'second question' }] }
        // biome-ignore lint/suspicious/noExplicitAny: minimal UIMessage fixture
      ] as any
    })

    expect(attributes['gen_ai.operation.name']).toBe('invoke_agent')
    expect(attributes['gen_ai.conversation.id']).toBe('topic-1')
    expect(attributes['gen_ai.provider.name']).toBe('openai')
    expect(attributes['gen_ai.request.model']).toBe('gpt-4')
    expect(attributes.inputs).toBe('second question')
    expect(attributes['gen_ai.agent.name']).toBeUndefined() // not provided
  })

  it('sets gen_ai.agent.name when an agent name is provided', () => {
    const { span, attributes } = fakeSpan()
    applyTurnInputAttributes(span, {
      modelId: 'anthropic::claude' as UniqueModelId,
      topicId: 't',
      operation: 'invoke_agent',
      agentName: 'Research Agent'
    })
    expect(attributes['gen_ai.agent.name']).toBe('Research Agent')
  })

  it('does NOT set token usage (that is message.stats job)', () => {
    const { span, attributes } = fakeSpan()
    applyTurnInputAttributes(span, { modelId: 'openai::gpt-4' as UniqueModelId, topicId: 't', operation: 'chat' })
    expect(Object.keys(attributes)).not.toContain('gen_ai.usage.input_tokens')
    expect(attributes.inputs).toBeUndefined() // no messages → no prompt
  })
})

describe('applyTurnOutputAttributes', () => {
  it('sets the final answer text + counts tool-call parts', () => {
    const { span, attributes } = fakeSpan()
    applyTurnOutputAttributes(span, {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'the ' },
        { type: 'tool-search', state: 'output-available' },
        { type: 'text', text: 'answer' },
        { type: 'dynamic-tool' }
      ]
      // biome-ignore lint/suspicious/noExplicitAny: minimal CherryUIMessage fixture
    } as any)

    expect(attributes.outputs).toBe('the answer')
    expect(attributes['cs.tool_calls']).toBe(2)
  })

  it('omits tool-call count when there are no tool parts', () => {
    const { span, attributes } = fakeSpan()
    // biome-ignore lint/suspicious/noExplicitAny: minimal fixture
    applyTurnOutputAttributes(span, { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'hi' }] } as any)
    expect(attributes.outputs).toBe('hi')
    expect(attributes['cs.tool_calls']).toBeUndefined()
  })
})
