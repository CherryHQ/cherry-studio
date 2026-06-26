/**
 * Regression net for PR 2 identity stability work.
 *
 * The structural-sharing producer (`useStablePartsByMessageId`) preserves the
 * inner array ref for any message whose parts didn't change. PartsContext
 * propagation still wakes every direct subscriber (that's how React context
 * works), but **memoized downstream renderers receiving the parts as a prop**
 * bail out — they're the components that do the expensive work in production
 * (markdown, code blocks, etc.). This test asserts that exact downstream
 * bailout: across 10 streaming chunks, the memoized downstream renderer for
 * non-streaming messages must be invoked exactly once (initial mount), and
 * the streaming one must be invoked 11 times (mount + 10 chunks).
 *
 * If `useStablePartsByMessageId` regresses (e.g. someone re-introduces
 * `Object.entries` + array spread inside the producer), the per-id ref breaks
 * and this test catches it.
 */

import { PartsContext, useMessageParts } from '@renderer/components/chat/messages/blocks/MessagePartsContext'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { act, render, renderHook } from '@testing-library/react'
import { memo, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import { useStablePartsByMessageId } from '../hooks/useStablePartsByMessageId'

function makeMessage(id: string, parts: CherryMessagePart[]): CherryUIMessage {
  return { id, role: id.startsWith('user') ? 'user' : 'assistant', parts } as unknown as CherryUIMessage
}

const text = (s: string): CherryMessagePart => ({ type: 'text', text: s }) as CherryMessagePart

/**
 * Downstream-renderer mock — receives `parts` as a prop and is wrapped in
 * React.memo with default shallow comparison. The render count is incremented
 * inside the render body (test-only abuse of side effects during render —
 * deterministic enough in this non-strict-mode harness). When parts ref is
 * stable, this memo bails out and the body does not run, so the count stays
 * flat. That is the load-bearing assertion of this test.
 */
const renderCount: Record<string, number> = {}
const DownstreamRenderer = memo(function DownstreamRenderer({ parts, id }: { parts: CherryMessagePart[]; id: string }) {
  renderCount[id] = (renderCount[id] ?? 0) + 1
  return <span>{parts.length}</span>
})

/**
 * Leaf consumer subscribed to PartsContext via the production hook. Always
 * re-renders on context change (that's intrinsic to React context); the
 * memoized DownstreamRenderer below is what we measure.
 */
function PartsConsumer({ messageId }: { messageId: string }) {
  const parts = useMessageParts(messageId)
  return <DownstreamRenderer parts={parts} id={messageId} />
}

describe('streaming render count (PR 2 regression net)', () => {
  it('keeps memoized downstream renderers stable for non-streaming messages across 10 chunks', () => {
    const STREAMING_ID = 'm5'
    const ids = ['m1', 'm2', 'm3', 'm4', STREAMING_ID]
    for (const id of ids) renderCount[id] = 0

    // Derive partsByMessageId via the production hook in a controlled rerender
    // loop. Non-streaming messages keep the same `CherryUIMessage` ref across
    // renders (mirrors `useTopicMessages`'s WeakMap projection cache). The
    // streaming message gets a new ref each chunk.
    const stableMessages: CherryUIMessage[] = ids.slice(0, -1).map((id) => makeMessage(id, [text(`${id}:0`)]))

    const initialMessages = [...stableMessages, makeMessage(STREAMING_ID, [text(`${STREAMING_ID}:0`)])]

    const { result, rerender } = renderHook(
      ({ messages }: { messages: CherryUIMessage[] }) => useStablePartsByMessageId(messages, {}, {}),
      { initialProps: { messages: initialMessages } }
    )

    const Tree = ({ partsByMessageId }: { partsByMessageId: Record<string, CherryMessagePart[]> }): ReactNode => (
      <PartsContext value={partsByMessageId}>
        {ids.map((id) => (
          <PartsConsumer key={id} messageId={id} />
        ))}
      </PartsContext>
    )

    const view = render(<Tree partsByMessageId={result.current} />)

    // Initial mount — every id rendered once.
    for (const id of ids) {
      expect(renderCount[id]).toBe(1)
    }

    for (let chunk = 1; chunk <= 10; chunk++) {
      const streamingParts: CherryMessagePart[] = []
      for (let i = 0; i <= chunk; i++) {
        streamingParts.push(text(`${STREAMING_ID}:${i}`))
      }
      const nextMessages: CherryUIMessage[] = [...stableMessages, makeMessage(STREAMING_ID, streamingParts)]

      act(() => {
        rerender({ messages: nextMessages })
      })

      view.rerender(<Tree partsByMessageId={result.current} />)
    }

    expect(renderCount[STREAMING_ID]).toBe(11)
    for (const id of ['m1', 'm2', 'm3', 'm4']) {
      // Non-streaming downstream renderers must stay at 1 (no extra commits
      // despite 10 PartsContext value changes upstream).
      expect(renderCount[id]).toBe(1)
    }
  })

  it('preserves the partsByMessageId container ref when no message id changed', () => {
    // Load-bearing invariant for context propagation: when no message id's
    // parts changed across a render, `useStablePartsByMessageId` must return
    // the same record reference so PartsContext doesn't invalidate.
    const messages = [makeMessage('m1', [text('a')]), makeMessage('m2', [text('b')])]

    const { result, rerender } = renderHook(
      ({ msgs }: { msgs: CherryUIMessage[] }) => useStablePartsByMessageId(msgs, {}, {}),
      { initialProps: { msgs: messages } }
    )

    const first = result.current
    rerender({ msgs: messages })
    expect(result.current).toBe(first)

    // Same per-message refs, fresh outer array — container still preserved.
    rerender({ msgs: [...messages] })
    expect(result.current).toBe(first)
  })
})
