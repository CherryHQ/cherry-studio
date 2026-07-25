/**
 * Regression net for PR 2 identity stability work.
 *
 * The structural-sharing producer (`useStablePartsByMessageId`) preserves the
 * inner array ref for any message whose parts didn't change. A message-scoped
 * provider then changes context only for the message whose array changed.
 * Across 10 streaming chunks, non-streaming consumers must render exactly once
 * (initial mount), and the streaming one 11 times.
 *
 * If `useStablePartsByMessageId` regresses (e.g. someone re-introduces
 * `Object.entries` + array spread inside the producer), the per-id ref breaks
 * and this test catches it.
 */

import {
  MessagePartsScopeProvider,
  useMessageParts
} from '@renderer/components/chat/messages/blocks/MessagePartsContext'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { act, render, renderHook } from '@testing-library/react'
import { memo, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import { useStablePartsByMessageId } from '../hooks/useStablePartsByMessageId'

function makeMessage(id: string, parts: CherryMessagePart[]): CherryUIMessage {
  return { id, role: id.startsWith('user') ? 'user' : 'assistant', parts } as unknown as CherryUIMessage
}

const text = (s: string): CherryMessagePart => ({ type: 'text', text: s }) as CherryMessagePart

const renderCount: Record<string, number> = {}
const observedPartCounts: Record<string, number[]> = {}
const PartsConsumer = memo(function PartsConsumer({
  messageId,
  renderVersion
}: {
  messageId: string
  renderVersion: number
}) {
  const parts = useMessageParts(messageId)
  renderCount[messageId] = (renderCount[messageId] ?? 0) + 1
  observedPartCounts[messageId] ??= []
  observedPartCounts[messageId].push(parts.length)
  return <span data-render-version={renderVersion}>{parts.length}</span>
})

describe('streaming render count (PR 2 regression net)', () => {
  it('only rerenders the message-scoped consumer whose parts change across 10 chunks', () => {
    const STREAMING_ID = 'm5'
    const ids = ['m1', 'm2', 'm3', 'm4', STREAMING_ID]
    for (const id of ids) {
      renderCount[id] = 0
      observedPartCounts[id] = []
    }

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

    const Tree = ({
      partsByMessageId,
      streamingVersion
    }: {
      partsByMessageId: Record<string, CherryMessagePart[]>
      streamingVersion: number
    }): ReactNode => (
      <>
        {ids.map((id) => (
          <MessagePartsScopeProvider key={id} messageId={id} parts={partsByMessageId[id]}>
            <PartsConsumer messageId={id} renderVersion={id === STREAMING_ID ? streamingVersion : 0} />
          </MessagePartsScopeProvider>
        ))}
      </>
    )

    const view = render(<Tree partsByMessageId={result.current} streamingVersion={0} />)

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

      view.rerender(<Tree partsByMessageId={result.current} streamingVersion={chunk} />)
    }

    expect(renderCount[STREAMING_ID]).toBe(11)
    expect(observedPartCounts[STREAMING_ID]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    for (const id of ['m1', 'm2', 'm3', 'm4']) {
      // Non-streaming consumers must stay at 1 despite 10 updates for m5.
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
