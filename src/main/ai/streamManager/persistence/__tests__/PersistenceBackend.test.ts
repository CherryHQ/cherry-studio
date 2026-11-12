/**
 * Unit tests for `finalizeInterruptedParts` — the listener runs this helper
 * over `finalMessage.parts` before composing stats and calling a backend, so
 * an interrupted or errored turn does not leave a part stuck in a non-terminal
 * (in-progress) state.
 *
 * The function is pure, so it is tested directly with no mocks.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CherryMessagePart } from '@shared/data/types/message'

import {
  dropEmptyContentParts,
  finalizeInterruptedParts,
  interruptedReplyData,
  stripTransientStatusParts
} from '../PersistenceBackend'

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
      expect((original as { state: string }).state).toBe('input-available')
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
    expect(result[0]).toEqual(completed)
    expect(result[1]).toEqual(errored)
    expect(result[2]).toEqual(denied)
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
    } as unknown as CherryMessagePart

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
    } as unknown as CherryMessagePart
    const pending = {
      type: 'data-agent-task-event',
      data: { event: 'started', taskId: 'task-2', status: 'pending' }
    } as unknown as CherryMessagePart

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

    expect(result).toEqual(parts)
  })

  it('drops a trailing empty text part next to a reasoning part', () => {
    const reasoning = reasoningPart('deep thought')
    const result = dropEmptyContentParts([reasoning, textPart('')])

    expect(result).toEqual([reasoning])
  })
})

describe('interruptedReplyData', () => {
  const isInterruptedNotice = (part: CherryMessagePart) =>
    part.type === 'data-error' && (part as { data: { i18nKey?: string } }).data.i18nKey === 'reply_interrupted'

  it('keeps the checkpointed text instead of the empty placeholder and drops the checkpoint', () => {
    const settled = interruptedReplyData({
      parts: [],
      streamCheckpoint: [textPart('half a sen')],
      turnOptions: { temperature: 0.5 } as never
    })

    expect(settled.parts.at(-1)).toSatisfy(isInterruptedNotice)
    expect(settled).not.toHaveProperty('streamCheckpoint')
    expect(settled.parts[0]).toEqual(textPart('half a sen'))
    // Main-authoritative keys beside the parts must survive the settle.
    expect(settled.turnOptions).toEqual({ temperature: 0.5 })
  })

  it('falls back to the row parts when no checkpoint was saved', () => {
    const settled = interruptedReplyData({ parts: [textPart('already there')] })

    expect(settled.parts[0]).toEqual(textPart('already there'))
    expect(settled.parts.at(-1)).toSatisfy(isInterruptedNotice)
  })

  it('still reports the interruption when neither checkpoint nor parts exist', () => {
    expect(interruptedReplyData({ parts: [] }).parts).toSatisfy((parts: CherryMessagePart[]) =>
      isInterruptedNotice(parts[0])
    )
  })
})
