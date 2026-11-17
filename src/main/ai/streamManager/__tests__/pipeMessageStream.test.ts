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

// Only the content owner composes host parts; controls cannot restore a removed body.
it('forwards authoritative replacement and empty bodies while retaining message metadata', async () => {
  const test = replay([
    { type: 'message', parts: [{ type: 'text', text: 'Withdrawn' }] },
    { type: 'control', chunk: { type: 'message-metadata', messageMetadata: { stats: { outputTokens: 7 } } } },
    {
      type: 'message',
      parts: [
        { type: 'text', text: 'Replacement' },
        { type: 'data-knowledge-scope', data: { baseIds: ['kb'] } }
      ]
    },
    { type: 'message', parts: [] }
  ])
  const result = await test.done
  expect(result.finalMessage?.parts).toEqual([])
  expect(result.finalMessage?.metadata?.stats?.outputTokens).toBe(7)
  expect(test.views[2].parts[0]).toMatchObject({ type: 'text', text: 'Replacement' })
})
