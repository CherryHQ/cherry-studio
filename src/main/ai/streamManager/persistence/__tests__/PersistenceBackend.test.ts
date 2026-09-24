/**
 * Unit tests for `finalizeInterruptedParts` — the listener runs this helper
 * over `finalMessage.parts` before composing stats and calling a backend, so
 * an interrupted or errored turn does not leave a part stuck in a non-terminal
 * (in-progress) state.
 *
 * The function is pure, so it is tested directly with no mocks.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { mergeAgentSessionTaskEvent } from '@shared/ai/agentSessionBackgroundTasks'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { AgentTaskEventPartData } from '@shared/data/types/uiParts'

import { dropEmptyContentParts, finalizeInterruptedParts, stripTransientStatusParts } from '../PersistenceBackend'

type AgentTaskEventPart = CherryMessagePart & { data: AgentTaskEventPartData }

const taskEventPart = (data: AgentTaskEventPartData): AgentTaskEventPart =>
  ({ type: 'data-agent-task-event', data }) as unknown as AgentTaskEventPart

/** Folds a message's task events the way the status pane does: per task, in order, first terminal wins. */
function mergeTaskEventParts(parts: CherryMessagePart[]): Map<string, AgentTaskEventPartData> {
  const merged = new Map<string, AgentTaskEventPartData>()
  for (const part of parts) {
    if (part.type !== 'data-agent-task-event') continue
    const { data } = part as AgentTaskEventPart
    merged.set(data.taskId, mergeAgentSessionTaskEvent(merged.get(data.taskId), data))
  }
  return merged
}

// AI SDK tool-call UIMessagePart shapes. The non-terminal states the helper
// targets are anything NOT in {output-available, output-error, output-denied}.
function inProgressToolPart(state: 'input-streaming' | 'input-available'): CherryMessagePart {
  return {
    type: 'tool-search',
    toolCallId: 'tc-1',
    toolName: 'search',
    state,
    input: { q: 'hello' }
  } as unknown as CherryMessagePart
}

function inProgressDynamicToolPart(): CherryMessagePart {
  return {
    type: 'dynamic-tool',
    toolCallId: 'tc-dyn',
    toolName: 'mcp_tool',
    state: 'input-available',
    input: { foo: 'bar' }
  } as unknown as CherryMessagePart
}

const textPart = (text: string): CherryMessagePart => ({ type: 'text', text }) as unknown as CherryMessagePart

describe('finalizeInterruptedParts', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns parts unchanged (by reference) on success', () => {
    const parts: CherryMessagePart[] = [textPart('hi'), inProgressToolPart('input-available')]

    const result = finalizeInterruptedParts(parts, 'success')

    // success short-circuits: same array, untouched in-progress tool part.
    expect(result).toBe(parts)
  })

  describe("status='paused' (interrupted by user)", () => {
    it('rewrites an in-progress tool part to output-error with the paused reason', () => {
      const parts: CherryMessagePart[] = [inProgressToolPart('input-available')]

      const result = finalizeInterruptedParts(parts, 'paused')

      expect(result[0]).toMatchObject({
        type: 'tool-search',
        toolCallId: 'tc-1',
        toolName: 'search',
        state: 'output-error',
        errorText: 'Interrupted by user',
        // original fields are preserved
        input: { q: 'hello' }
      })
    })

    it('rewrites an in-progress input-streaming tool part too', () => {
      const parts: CherryMessagePart[] = [inProgressToolPart('input-streaming')]

      const result = finalizeInterruptedParts(parts, 'paused')

      expect(result[0]).toMatchObject({ state: 'output-error', errorText: 'Interrupted by user' })
    })

    it('rewrites an in-progress dynamic-tool part', () => {
      const parts: CherryMessagePart[] = [inProgressDynamicToolPart()]

      const result = finalizeInterruptedParts(parts, 'paused')

      expect(result[0]).toMatchObject({
        type: 'dynamic-tool',
        state: 'output-error',
        errorText: 'Interrupted by user'
      })
    })

    it('does not mutate the original part (returns a copy)', () => {
      const original = inProgressToolPart('input-available')
      const parts: CherryMessagePart[] = [original]

      const result = finalizeInterruptedParts(parts, 'paused')

      expect(result[0]).not.toBe(original)
      expect((original as { state: string }).state).toBe('input-available')
    })
  })

  describe("status='error' (stream errored before tool completed)", () => {
    it('rewrites an in-progress tool part to output-error with the error reason', () => {
      const parts: CherryMessagePart[] = [inProgressToolPart('input-available')]

      const result = finalizeInterruptedParts(parts, 'error')

      expect(result[0]).toMatchObject({
        state: 'output-error',
        errorText: 'Stream errored before tool completed'
      })
    })
  })

  it('leaves terminal tool parts untouched on paused/error', () => {
    const completed = {
      type: 'tool-search',
      toolCallId: 'done',
      toolName: 'search',
      state: 'output-available',
      output: { hits: 3 }
    } as unknown as CherryMessagePart
    const errored = {
      type: 'tool-search',
      toolCallId: 'err',
      toolName: 'search',
      state: 'output-error',
      errorText: 'tool blew up'
    } as unknown as CherryMessagePart
    const denied = {
      type: 'tool-fs',
      toolCallId: 'denied',
      toolName: 'fs',
      state: 'output-denied'
    } as unknown as CherryMessagePart

    const parts: CherryMessagePart[] = [completed, errored, denied]
    const result = finalizeInterruptedParts(parts, 'paused')

    // identical objects returned by reference — no rewrite of terminal states.
    expect(result[0]).toBe(completed)
    expect(result[1]).toBe(errored)
    expect(result[2]).toBe(denied)
  })

  it('preserves an existing errorText instead of overwriting with the generic reason', () => {
    const parts: CherryMessagePart[] = [
      {
        type: 'tool-search',
        toolCallId: 'x',
        toolName: 'search',
        state: 'input-available',
        errorText: 'earlier diagnostic'
      } as unknown as CherryMessagePart
    ]

    const result = finalizeInterruptedParts(parts, 'paused')

    expect(result[0]).toMatchObject({ state: 'output-error', errorText: 'earlier diagnostic' })
  })

  it('leaves non-tool parts (text/reasoning) untouched while rewriting the tool part', () => {
    const text = textPart('partial answer')
    const reasoning = { type: 'reasoning', text: 'thinking…' } as unknown as CherryMessagePart
    const parts: CherryMessagePart[] = [text, reasoning, inProgressToolPart('input-available')]

    const result = finalizeInterruptedParts(parts, 'error')

    // text + reasoning returned by reference, untouched
    expect(result[0]).toBe(text)
    expect(result[1]).toBe(reasoning)
    // only the tool part is rewritten
    expect(result[2]).toMatchObject({ state: 'output-error', errorText: 'Stream errored before tool completed' })
  })

  it('terminalizes an in-progress Agent task event when the stream errors', () => {
    const taskEvent = {
      type: 'data-agent-task-event',
      data: {
        event: 'progress',
        taskId: 'task-7',
        status: 'in_progress',
        title: 'Implementing TTS adapters'
      }
    } as unknown as CherryMessagePart

    const result = finalizeInterruptedParts([taskEvent], 'error')

    expect(result[0]).toMatchObject({
      type: 'data-agent-task-event',
      data: {
        event: 'progress',
        taskId: 'task-7',
        status: 'error',
        // Marked synthetic so a real terminal edge from the runtime can still supersede this guess.
        synthetic: true,
        error: 'Stream errored before task completed'
      }
    })
    expect(result[0]).not.toBe(taskEvent)
  })

  it('keeps completed and pending Agent task events unchanged', () => {
    const completed = {
      type: 'data-agent-task-event',
      data: { event: 'notification', taskId: 'task-1', status: 'completed' }
    } as unknown as CherryMessagePart
    const pending = {
      type: 'data-agent-task-event',
      data: { event: 'started', taskId: 'task-2', status: 'pending' }
    } as unknown as CherryMessagePart

    const result = finalizeInterruptedParts([completed, pending], 'error')

    expect(result[0]).toBe(completed)
    expect(result[1]).toBe(pending)
  })

  it('keeps a task that already reported its terminal edge while terminalizing the task the crash interrupted', () => {
    const completedStart = taskEventPart({ event: 'started', taskId: 'task-done', status: 'in_progress' })
    const completedEnd = taskEventPart({
      event: 'notification',
      taskId: 'task-done',
      status: 'completed',
      completedAt: '2026-06-16T10:00:03.400Z'
    })
    const interrupted = taskEventPart({ event: 'started', taskId: 'task-lost', status: 'in_progress' })

    const result = finalizeInterruptedParts([completedStart, completedEnd, interrupted], 'error')

    // Consumers fold a task's parts first-terminal-wins, so the merged row status is the contract:
    // rewriting a finished task's stale `in_progress` part to `error` wins that fold and shows a
    // task that completed normally as abnormally interrupted.
    const merged = mergeTaskEventParts(result)
    expect(merged.get('task-done')?.status).toBe('completed')
    expect(merged.get('task-done')).toEqual(completedEnd.data)
    expect(merged.get('task-lost')?.status).toBe('error')
    // The finished task's parts survive untouched, including its stale in_progress edge.
    expect(result[0]).toBe(completedStart)
    expect(result[1]).toBe(completedEnd)
    expect(result[2]).toMatchObject({ data: { status: 'error', error: 'Stream errored before task completed' } })
  })

  it('keeps an in-progress task a sibling row of the same Session already settled', () => {
    const settledElsewhere = taskEventPart({ event: 'progress', taskId: 'task-done', status: 'in_progress' })
    const interrupted = taskEventPart({ event: 'started', taskId: 'task-lost', status: 'in_progress' })

    const result = finalizeInterruptedParts([settledElsewhere, interrupted], 'error', new Set(['task-done']))

    // Async notifications land in their own assistant row, so the terminal edge of `task-done` is
    // invisible here; without the Session-wide set it would be rewritten and win the merge.
    expect(result[0]).toBe(settledElsewhere)
    expect(result[1]).toMatchObject({ data: { status: 'error', error: 'Stream errored before task completed' } })
  })

  it('rewrites a streaming reasoning part to done and calculates thinkingMs if startedAt is provided', () => {
    const baseTime = 1780913860106
    vi.spyOn(Date, 'now').mockReturnValue(baseTime)
    const startedAt = baseTime - 5000 // 5 seconds ago
    const streamingReasoning = {
      type: 'reasoning',
      text: 'thinking...',
      state: 'streaming',
      providerMetadata: {
        cherry: {
          startedAt
        }
      }
    } as unknown as CherryMessagePart

    const result = finalizeInterruptedParts([streamingReasoning], 'paused')

    expect(result[0]).toMatchObject({
      type: 'reasoning',
      state: 'done'
    })
    const cherryMeta = (result[0] as any).providerMetadata?.cherry
    expect(cherryMeta?.thinkingMs).toBe(5000)
  })

  it('rewrites a streaming reasoning part to done but leaves thinkingMs undefined if startedAt is missing', () => {
    const streamingReasoning = {
      type: 'reasoning',
      text: 'thinking...',
      state: 'streaming'
    } as unknown as CherryMessagePart

    const result = finalizeInterruptedParts([streamingReasoning], 'paused')

    expect(result[0]).toMatchObject({
      type: 'reasoning',
      state: 'done'
    })
    const cherryMeta = (result[0] as any).providerMetadata?.cherry
    expect(cherryMeta?.thinkingMs).toBeUndefined()
  })
})

describe('stripTransientStatusParts', () => {
  const retryPart = (): CherryMessagePart =>
    ({
      type: 'data-retry',
      id: 'retry',
      data: { state: 'retrying', modelId: 'gpt-4', attempt: 2, reason: 'http 429' }
    }) as unknown as CherryMessagePart

  it('removes data-retry parts, preserving order of the rest', () => {
    const text = textPart('answer')
    const result = stripTransientStatusParts([retryPart(), text])

    expect(result).toEqual([text])
  })

  it('returns the same array reference when there is nothing to strip', () => {
    const parts: CherryMessagePart[] = [textPart('hi')]

    expect(stripTransientStatusParts(parts)).toBe(parts)
  })
})

const reasoningPart = (text: string): CherryMessagePart =>
  ({ type: 'reasoning', text, state: 'done' }) as unknown as CherryMessagePart

describe('dropEmptyContentParts', () => {
  it('drops empty and whitespace-only text parts', () => {
    const keep = textPart('answer')
    const result = dropEmptyContentParts([textPart(''), keep, textPart('   \n  ')])

    expect(result).toEqual([keep])
  })

  it('drops empty and whitespace-only reasoning parts', () => {
    const keep = reasoningPart('real thought')
    const result = dropEmptyContentParts([reasoningPart(''), keep, reasoningPart('  ')])

    expect(result).toEqual([keep])
  })

  it('keeps non-text/reasoning parts even when they look empty', () => {
    const parts: CherryMessagePart[] = [
      { type: 'data-translation', data: { content: '' } } as unknown as CherryMessagePart,
      {
        type: 'tool-search',
        toolCallId: 't',
        toolName: 'search',
        state: 'output-available',
        output: {}
      } as unknown as CherryMessagePart
    ]

    const result = dropEmptyContentParts(parts)

    expect(result).toBe(parts)
  })

  it('returns the original array by reference when nothing is dropped', () => {
    const parts: CherryMessagePart[] = [textPart('hi'), reasoningPart('thinking')]

    expect(dropEmptyContentParts(parts)).toBe(parts)
  })

  it('drops a trailing empty text part next to a reasoning part', () => {
    const reasoning = reasoningPart('deep thought')
    const result = dropEmptyContentParts([reasoning, textPart('')])

    expect(result).toEqual([reasoning])
  })
})
