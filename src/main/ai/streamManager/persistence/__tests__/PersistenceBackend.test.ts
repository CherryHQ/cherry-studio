/**
 * Unit tests for `finalizeInterruptedParts` — the helper every persistence
 * backend (MessageService / TemporaryChat / AgentSessionMessage) runs over
 * `finalMessage.parts` before writing, so an interrupted or errored turn does
 * not leave a tool part stuck in a non-terminal (in-progress) state.
 *
 * The function is pure, so it is tested directly with no mocks.
 */

import type { CherryMessagePart } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { finalizeInterruptedParts } from '../PersistenceBackend'

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
})
