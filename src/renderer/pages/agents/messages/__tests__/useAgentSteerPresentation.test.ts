import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { ActiveExecution } from '@shared/ai/transport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'

import { useAgentSteerPresentation } from '../useAgentSteerPresentation'

const answer = (text: string, parts: CherryMessagePart[] = []): CherryUIMessage => ({
  id: 'answer',
  role: 'assistant',
  parts: [{ type: 'text', text, state: 'streaming' }, ...parts],
  metadata: { status: 'pending' }
})
const steer: CherryUIMessage = { id: 'steer', role: 'user', parts: [{ type: 'text', text: 'Use Python' }] }
const execution: ActiveExecution = {
  executionId: createUniqueModelId('provider', 'model'),
  attemptId: 1,
  anchorMessageId: 'answer'
}
const runningTool: CherryMessagePart = {
  type: 'dynamic-tool',
  toolName: 'bash',
  toolCallId: 'tool-1',
  state: 'output-available',
  preliminary: true,
  output: '',
  input: { command: 'sleep 15' }
}
const completedTool: CherryMessagePart = {
  ...runningTool,
  state: 'output-available',
  preliminary: false,
  output: 'TOOL_DONE'
}
const props = (messages: CherryUIMessage[], activeExecutions: readonly ActiveExecution[] = [execution]) => ({
  topicId: 'topic',
  messages,
  partsByMessageId: {},
  activeExecutions
})

// Protect the visible transfer: ongoing tools and late output must never disappear behind a waiting label.
describe('steer presentation', () => {
  it('moves the ongoing tool and new text after steer, retaining the completed prefix', () => {
    const initial = answer('Before steer', [runningTool])
    const { result, rerender } = renderHook(useAgentSteerPresentation, { initialProps: props([initial]) })
    rerender(props([initial, steer]))
    const continuation = result.current.messages.at(-1)!
    expect(result.current.messages.map((row) => row.role)).toEqual(['assistant', 'user', 'assistant'])
    expect(result.current.partsByMessageId.answer).toEqual([{ type: 'text', text: 'Before steer', state: 'done' }])
    expect(result.current.partsByMessageId[continuation.id]).toEqual([runningTool])
    expect(result.current.liveMessageIds).toEqual([continuation.id])

    const late = answer('Before steer. Late output.', [completedTool])
    rerender(props([late, steer]))
    expect(result.current.partsByMessageId.answer).toEqual([{ type: 'text', text: 'Before steer', state: 'done' }])
    expect(result.current.partsByMessageId[continuation.id]).toEqual([
      { type: 'text', text: '. Late output.', state: 'streaming' },
      completedTool
    ])
    expect(initial.parts).toEqual([{ type: 'text', text: 'Before steer', state: 'streaming' }, runningTool])
    expect(late.parts[0]).toMatchObject({ text: 'Before steer. Late output.' })
  })

  it('keeps completed tools before steer and merges the continuation into the native reply exactly once', () => {
    const initial = answer('Initial', [completedTool, { ...runningTool, toolCallId: 'tool-2' }])
    const { result, rerender } = renderHook(useAgentSteerPresentation, { initialProps: props([initial, steer]) })
    const nativeReply: CherryUIMessage = {
      id: 'successor',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Python' }]
    }
    const source = answer('Initial', [completedTool, { ...completedTool, toolCallId: 'tool-2' }])
    rerender(props([source, steer, nativeReply], [{ ...execution, anchorMessageId: 'successor' }]))
    expect(result.current.messages.map((row) => row.id)).toEqual(['answer', 'steer', 'successor'])
    expect(result.current.partsByMessageId.answer).toEqual([
      { type: 'text', text: 'Initial', state: 'done' },
      completedTool
    ])
    expect(result.current.partsByMessageId.successor).toEqual([
      { ...completedTool, toolCallId: 'tool-2' },
      { type: 'text', text: 'Python' }
    ])
    expect(result.current.liveMessageIds).toEqual(['successor'])
    rerender(props([source, steer, nativeReply], []))
    expect(result.current.partsByMessageId.successor).toHaveLength(2)
  })

  it('retains a late compaction anchor before steer rather than moving it with the ongoing turn', () => {
    const initial: CherryUIMessage = { id: 'answer', role: 'assistant', parts: [], metadata: { status: 'pending' } }
    const { result, rerender } = renderHook(useAgentSteerPresentation, { initialProps: props([initial, steer]) })
    const anchor: CherryMessagePart = {
      type: 'data-compaction-anchor',
      id: 'compact',
      data: { status: 'done', phase: 'agent-session', completedAt: '2026-11-09T00:00:00Z', trigger: 'manual' }
    }
    rerender(props([{ ...initial, parts: [anchor], metadata: { status: 'success' } }, steer], []))
    expect(result.current.partsByMessageId.answer).toEqual([anchor])
    expect(result.current.messages.map((row) => row.id)).toEqual(['answer', 'steer'])
  })

  it('keeps the same text split when acknowledgment replaces the optimistic user id', () => {
    const { result, rerender } = renderHook(useAgentSteerPresentation, {
      initialProps: props([answer('Prefix'), steer])
    })
    rerender(props([answer('Prefix continued'), { ...steer, id: 'persisted-steer' }]))
    const tail = result.current.messages.at(-1)!
    expect(result.current.partsByMessageId.answer).toEqual([{ type: 'text', text: 'Prefix', state: 'done' }])
    expect(result.current.partsByMessageId[tail.id]).toEqual([{ type: 'text', text: ' continued', state: 'streaming' }])
  })

  it('restores the original live reply when the optimistic steer is rejected', () => {
    const { result, rerender } = renderHook(useAgentSteerPresentation, {
      initialProps: props([answer('Initial'), steer])
    })
    const live = answer('Still running')
    rerender(props([live]))
    expect(result.current.messages).toEqual([live])
    expect(result.current.heldPartsByMessageId).toEqual({})
    expect(result.current.sourceMessageIds).toEqual({})
  })

  it('does not leak the split into a different topic', () => {
    const { result, rerender } = renderHook(useAgentSteerPresentation, {
      initialProps: props([answer('Prefix'), steer])
    })
    const unrelated = answer('Unrelated')
    rerender({ ...props([unrelated]), topicId: 'another-topic' })
    expect(result.current.messages).toEqual([unrelated])
    expect(result.current.heldPartsByMessageId).toEqual({})
  })
})
