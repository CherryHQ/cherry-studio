import { expect, it } from 'vitest'

import { Emitter } from '@main/core/lifecycle/event'
import type { CherryUIMessage } from '@shared/data/types/message'

import { pipeMessageStream } from '../pipeMessageStream'
import type { AgentPartChange, AgentMessageStreamSource, ExecutionPart, MessageStreamEvent } from '../types'

function replay(
  events: (AgentPartChange | { type: 'message'; entries: readonly ExecutionPart[] } | MessageStreamEvent)[],
  readParts: () => readonly ExecutionPart[]
) {
  const views: CherryUIMessage[] = []
  const patches: AgentPartChange[] = []
  const content = new Emitter<AgentPartChange>()
  const reconciled = new Emitter<readonly ExecutionPart[]>()
  let drained = false
  const source: AgentMessageStreamSource = {
    kind: 'messages',
    onPart: content.event,
    onMessageReconciled: reconciled.event,
    readParts: () => (drained ? readParts() : []),
    stream: new ReadableStream({
      start(controller) {
        queueMicrotask(() => {
          for (const event of events) {
            if (event.type === 'control' || event.type === 'error') controller.enqueue(event)
            else if (event.type === 'message') reconciled.fire(event.entries)
            else content.fire(event)
          }
          drained = true
          controller.close()
        })
      }
    })
  }
  const done = pipeMessageStream(
    source,
    new AbortController().signal,
    { id: 'reply', role: 'assistant' },
    (message) => views.push(message),
    () => {},
    (patch) => patches.push(patch)
  )
  return { views, patches, done }
}

// Source failures must not discard body views already queued before the error.
it('retains the last confirmed content and typed failure after a native error', async () => {
  const error = Object.assign(new Error('upstream'), { statusCode: 429 })
  const parts: CherryUIMessage['parts'] = [{ type: 'text', text: 'Partial answer', state: 'streaming' }]
  const entries = [{ partId: 'answer', pos: 1, payload: parts[0] }]
  const test = replay(
    [
      { type: 'message', entries },
      { type: 'error', error }
    ],
    () => entries
  )
  const result = await test.done
  expect(result.finalMessage?.parts).toEqual(parts)
  expect(result.threw?.error).toBe(error)
  expect(test.views.at(-1)?.parts).toEqual(parts)
})

// Only the content owner composes host parts; controls cannot restore a removed body.
it('forwards authoritative replacement and empty bodies while retaining message metadata', async () => {
  const test = replay(
    [
      { type: 'message', entries: [{ partId: 'withdrawn', pos: 1, payload: { type: 'text', text: 'Withdrawn' } }] },
      { type: 'control', chunk: { type: 'message-metadata', messageMetadata: { stats: { outputTokens: 7 } } } },
      {
        type: 'message',
        entries: [
          { partId: 'replacement', pos: 1, payload: { type: 'text', text: 'Replacement' } },
          { partId: 'scope', pos: 2, payload: { type: 'data-knowledge-scope', data: { baseIds: ['kb'] } } }
        ]
      },
      { type: 'message', entries: [] }
    ],
    () => []
  )
  const result = await test.done
  expect(result.finalMessage?.parts).toEqual([])
  expect(result.finalMessage?.metadata?.stats?.outputTokens).toBe(7)
  expect(test.views[2]?.parts).toMatchObject([{ type: 'text', text: 'Replacement' }, { type: 'data-knowledge-scope' }])
})

it('relays queued operations without reading the current body until terminal consumption', async () => {
  const first = { partId: 'first', pos: 4, payload: { type: 'text', text: 'First', state: 'streaming' } } as const
  const second = { partId: 'second', pos: 5, payload: { type: 'text', text: 'Second', state: 'streaming' } } as const
  const append = { type: 'part-append', partId: 'second', text: ' finished' } as const
  const finish = { type: 'part-finish', partId: 'second' } as const
  let reads = 0
  const test = replay(
    [{ type: 'message', entries: [first, second] }, { type: 'message', entries: [second, first] }, append, finish],
    () => {
      reads++
      return [{ ...second, payload: { ...second.payload, text: 'Second finished', state: 'done' } }, first]
    }
  )
  const { finalMessage } = await test.done
  expect(reads).toBe(1)
  expect(test.patches).toEqual([append, finish])
  expect(test.views[2].parts).toEqual([second.payload, first.payload])
  expect(finalMessage).toMatchObject({
    partIds: ['second', 'first'],
    parts: [{ ...second.payload, text: 'Second finished', state: 'done' }, first.payload]
  })
})
