import { expect, it } from 'vitest'

import type { CherryUIMessage } from '@shared/data/types/message'

import { pipeMessageStream } from '../pipeMessageStream'
import type { MessageStreamEvent } from '../types'

function replay(events: MessageStreamEvent[]) {
  const views: CherryUIMessage[] = []
  const source = new ReadableStream<MessageStreamEvent>({
    start(controller) {
      events.forEach((event) => controller.enqueue(event))
      controller.close()
    }
  })
  const done = pipeMessageStream(
    source,
    new AbortController().signal,
    { id: 'reply', role: 'assistant', parts: [] },
    (message) => views.push(message),
    () => {}
  )
  return { views, done }
}

// Source failures must not discard body views already queued before the error.
it('retains the last confirmed content and typed failure after a native error', async () => {
  const error = Object.assign(new Error('upstream'), { statusCode: 429 })
  const parts: CherryUIMessage['parts'] = [{ type: 'text', text: 'Partial answer', state: 'streaming' }]
  const test = replay([
    { type: 'message', parts },
    { type: 'error', error }
  ])
  const result = await test.done
  expect(result.finalMessage?.parts).toEqual(parts)
  expect(result.threw?.error).toBe(error)
  expect(test.views.at(-1)?.parts).toEqual(parts)
})

// Repeated snapshots must neither duplicate host cards nor resurrect withdrawn native parts.
it('keeps host display metadata across native replacement and removal', async () => {
  const test = replay([
    { type: 'message', parts: [{ type: 'text', text: 'Withdrawn' }] },
    { type: 'control', chunk: { type: 'message-metadata', messageMetadata: { stats: { outputTokens: 7 } } } },
    { type: 'control', chunk: { type: 'data-knowledge-scope', data: { baseIds: ['kb'] } } },
    { type: 'message', parts: [{ type: 'text', text: 'Replacement' }] },
    { type: 'message', parts: [] }
  ])
  const result = await test.done
  expect(result.finalMessage?.parts).toEqual([{ type: 'data-knowledge-scope', data: { baseIds: ['kb'] } }])
  expect(result.finalMessage?.metadata?.stats?.outputTokens).toBe(7)
  expect(test.views[3].parts[0]).toMatchObject({ type: 'text', text: 'Replacement' })
})

// Native results, including denial, supersede an approval overlay without creating a second tool card.
it.each(['output-available', 'output-denied'] as const)(
  'settles an approval with %s in the single message view',
  async (state) => {
    const call = { type: 'dynamic-tool' as const, toolCallId: 'call', toolName: 'Bash', input: { command: 'pwd' } }
    const settled: CherryUIMessage['parts'][number] =
      state === 'output-available'
        ? { ...call, state, output: '/workspace' }
        : { ...call, state, approval: { id: 'approval', approved: false } }
    const test = replay([
      {
        type: 'control',
        chunk: { type: 'tool-input-available', toolCallId: 'call', toolName: 'Bash', input: call.input, dynamic: true }
      },
      { type: 'control', chunk: { type: 'tool-approval-request', approvalId: 'approval', toolCallId: 'call' } },
      { type: 'message', parts: [{ ...call, state: 'input-available' }] },
      { type: 'message', parts: [settled] }
    ])
    const result = await test.done
    expect(test.views[2].parts).toEqual([{ ...call, state: 'approval-requested', approval: { id: 'approval' } }])
    expect(result.finalMessage?.parts).toEqual([settled])
  }
)
