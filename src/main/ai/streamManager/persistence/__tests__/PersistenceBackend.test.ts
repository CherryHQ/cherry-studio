/**
 * Unit tests for `finalizeInterruptedParts` — the listener runs this helper
 * over `finalMessage.parts` before composing stats and calling a backend, so
 * an interrupted or errored turn does not leave a part stuck in a non-terminal
 * (in-progress) state.
 *
 * The function is pure, so it is tested directly with no mocks.
 */

import { afterEach, assert, describe, expect, it, vi } from 'vitest'

import { MessageDataSchema, type CherryMessagePart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'

import { dropEmptyContentParts, finalizeInterruptedParts, stripTransientStatusParts } from '../PersistenceBackend'

// AI SDK tool-call UIMessagePart shapes. The non-terminal states the helper
// targets are anything NOT in {output-available, output-error, output-denied}.
function inProgressToolPart(state: 'input-streaming' | 'input-available') {
  return {
    type: 'tool-search',
    toolCallId: 'tc-1',
    toolName: 'search',
    state,
    input: { q: 'hello' }
  } satisfies CherryMessagePart & { toolName: string }
}

function inProgressDynamicToolPart() {
  return {
    type: 'dynamic-tool',
    toolCallId: 'tc-dyn',
    toolName: 'mcp_tool',
    state: 'input-available',
    input: { foo: 'bar' }
  } satisfies CherryMessagePart
}

const textPart = (text: string) => ({ type: 'text', text }) satisfies CherryMessagePart

function storedParts(parts: unknown[]): CherryMessagePart[] {
  // Storage admits parts opaquely, including historical missing or transitional SDK fields.
  const stored = MessageDataSchema.parse({ parts }).parts
  assert.isDefined(stored, 'Expected stored message parts')
  return stored
}

describe('finalizeInterruptedParts', () => {
  afterEach(() => {
    vi.restoreAllMocks()
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
        errorText: expect.any(String),
        // original fields are preserved
        input: { q: 'hello' }
      })
    })

    it('rewrites an in-progress input-streaming tool part too', () => {
      const parts: CherryMessagePart[] = [inProgressToolPart('input-streaming')]

      const result = finalizeInterruptedParts(parts, 'paused')

      expect(result[0]).toMatchObject({ state: 'output-error', errorText: expect.any(String) })
    })

    it('rewrites an in-progress dynamic-tool part', () => {
      const parts: CherryMessagePart[] = [inProgressDynamicToolPart()]

      const result = finalizeInterruptedParts(parts, 'paused')

      expect(result[0]).toMatchObject({
        type: 'dynamic-tool',
        state: 'output-error',
        errorText: expect.any(String)
      })
    })

    it('does not mutate the original part (returns a copy)', () => {
      const original = inProgressToolPart('input-available')
      const parts: CherryMessagePart[] = [original]
      finalizeInterruptedParts(parts, 'paused')
      expect(original.state).toBe('input-available')
    })
  })

  describe("status='error' (stream errored before tool completed)", () => {
    it('rewrites an in-progress tool part to output-error with the error reason', () => {
      const parts: CherryMessagePart[] = [inProgressToolPart('input-available')]

      const result = finalizeInterruptedParts(parts, 'error')

      expect(result[0]).toMatchObject({
        state: 'output-error',
        errorText: expect.any(String)
      })
    })
  })

  it('preserves historical terminal tool parts missing input or approval fields', () => {
    const completed = {
      type: 'tool-search',
      toolCallId: 'done',
      toolName: 'search',
      state: 'output-available',
      output: { hits: 3 }
    }
    const errored = {
      type: 'tool-search',
      toolCallId: 'err',
      toolName: 'search',
      state: 'output-error',
      errorText: 'tool blew up'
    }
    const denied = {
      type: 'tool-fs',
      toolCallId: 'denied',
      toolName: 'fs',
      state: 'output-denied'
    }

    const parts = storedParts([completed, errored, denied])
    const result = finalizeInterruptedParts(parts, 'paused')

    // Terminal outcomes and historical fields survive interruption.
    expect(result[0]).toEqual(completed)
    expect(result[1]).toEqual(errored)
    expect(result[2]).toEqual(denied)
    expect(completed).toMatchObject({ state: 'output-available', output: { hits: 3 } })
    expect(errored).toMatchObject({ state: 'output-error', errorText: 'tool blew up' })
    expect(denied).toMatchObject({ state: 'output-denied' })
  })

  it('preserves an earlier errorText on a historical in-progress tool record', () => {
    const parts = storedParts([
      {
        type: 'tool-search',
        toolCallId: 'x',
        toolName: 'search',
        state: 'input-available',
        errorText: 'earlier diagnostic'
      }
    ])

    const result = finalizeInterruptedParts(parts, 'paused')

    expect(result[0]).toMatchObject({ state: 'output-error', errorText: 'earlier diagnostic' })
  })

  it('leaves non-tool parts (text/reasoning) untouched while rewriting the tool part', () => {
    const text = textPart('partial answer')
    const reasoning = { type: 'reasoning', text: 'thinking…' } satisfies CherryMessagePart
    const parts: CherryMessagePart[] = [text, reasoning, inProgressToolPart('input-available')]

    const result = finalizeInterruptedParts(parts, 'error')

    // text + reasoning returned by reference, untouched
    expect(result[0]).toEqual(text)
    expect(result[1]).toEqual(reasoning)
    // only the tool part is rewritten
    expect(result[2]).toMatchObject({ state: 'output-error', errorText: expect.any(String) })
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
    } satisfies CherryMessagePart

    const result = finalizeInterruptedParts([taskEvent], 'error')

    expect(result[0]).toMatchObject({
      type: 'data-agent-task-event',
      data: {
        event: 'progress',
        taskId: 'task-7',
        status: 'error',
        error: expect.any(String)
      }
    })
  })

  it('keeps completed and pending Agent task events unchanged', () => {
    const completed = {
      type: 'data-agent-task-event',
      data: { event: 'notification', taskId: 'task-1', status: 'completed' }
    } satisfies CherryMessagePart
    const pending = {
      type: 'data-agent-task-event',
      data: { event: 'started', taskId: 'task-2', status: 'pending' }
    } satisfies CherryMessagePart

    const result = finalizeInterruptedParts([completed, pending], 'error')

    expect(result[0]).toEqual(completed)
    expect(result[1]).toEqual(pending)
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
    } satisfies CherryMessagePart

    const result = finalizeInterruptedParts([streamingReasoning], 'paused')

    expect(result[0]).toMatchObject({
      type: 'reasoning',
      state: 'done'
    })
    const cherryMeta = readCherryMeta(result[0])
    expect(cherryMeta?.thinkingMs).toBe(5000)
  })

  it('rewrites a streaming reasoning part to done but leaves thinkingMs undefined if startedAt is missing', () => {
    const streamingReasoning = {
      type: 'reasoning',
      text: 'thinking...',
      state: 'streaming'
    } satisfies CherryMessagePart

    const result = finalizeInterruptedParts([streamingReasoning], 'paused')

    expect(result[0]).toMatchObject({
      type: 'reasoning',
      state: 'done'
    })
    const cherryMeta = readCherryMeta(result[0])
    expect(cherryMeta?.thinkingMs).toBeUndefined()
  })
})

describe('stripTransientStatusParts', () => {
  const retryPart = () =>
    ({
      type: 'data-retry',
      id: 'retry',
      data: { state: 'retrying', modelId: 'gpt-4', attempt: 2, reason: 'http 429' }
    }) satisfies CherryMessagePart

  it('removes data-retry parts, preserving order of the rest', () => {
    const text = textPart('answer')
    const result = stripTransientStatusParts([retryPart(), text])

    expect(result).toEqual([text])
  })
})

const reasoningPart = (text: string) => ({ type: 'reasoning', text, state: 'done' }) satisfies CherryMessagePart

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

  it('keeps historical non-text parts even when their payloads look empty or incomplete', () => {
    const parts = storedParts([
      { type: 'data-translation', data: { content: '' } },
      {
        type: 'tool-search',
        toolCallId: 't',
        toolName: 'search',
        state: 'output-available',
        output: {}
      }
    ])

    const result = dropEmptyContentParts(parts)

    expect(result).toEqual(parts)
  })

  it('drops a trailing empty text part next to a reasoning part', () => {
    const reasoning = reasoningPart('deep thought')
    const result = dropEmptyContentParts([reasoning, textPart('')])

    expect(result).toEqual([reasoning])
  })
})
