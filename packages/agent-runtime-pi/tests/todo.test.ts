import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import { createTodoExtension, type TranscriptEntry } from '../src'
import { createTestSession, finish, hostStore, plain, scriptedModel, streamTextPort, textParts } from './support'
import { textOf, toolOutputs, toolResults } from './toolResults'

const todoCall = (id: string, todos: unknown): LanguageModelV3StreamPart[] => [
  { type: 'tool-call', toolCallId: id, toolName: 'todo_write', input: JSON.stringify({ todos }) },
  finish('tool-calls')
]

/** Where a host reads the list back from its stored transcript: the last successful `todo_write` result. */
const latestStoredList = (entries: readonly TranscriptEntry[]) =>
  entries.findLast(
    (entry) =>
      entry.kind === 'message' &&
      entry.message.role === 'tool' &&
      entry.message.content.some(
        (part) => part.type === 'tool-result' && part.toolName === 'todo_write' && part.output.type === 'text'
      )
  )

describe('todo extension', () => {
  it('replaces the whole list on every call and reports its counts', async () => {
    const { model } = scriptedModel([
      todoCall('call_1', [
        { content: 'Book flights', status: 'in_progress' },
        { content: 'Book hotel', status: 'pending' }
      ]),
      todoCall('call_2', [
        { content: '  Pack bags ', status: 'in_progress' },
        { content: 'Book flights', status: 'completed' }
      ]),
      todoCall('call_3', []),
      [...textParts('t', 'Done.'), finish('stop')]
    ])
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      extensionFactories: [createTodoExtension()]
    })
    await session.prompt('Plan the trip')

    const [first, second, cleared] = toolResults(session)
    expect(textOf(first)).toBe('Updated todo list: 1 pending, 1 in progress, 0 completed.')
    expect(second.isError).toBe(false)
    expect(textOf(second)).toBe('Updated todo list: 0 pending, 1 in progress, 1 completed.')
    expect(second.details).toEqual({
      todos: [
        { content: 'Pack bags', status: 'in_progress' },
        { content: 'Book flights', status: 'completed' }
      ],
      counts: { pending: 0, inProgress: 1, completed: 1 }
    })
    expect(cleared.details).toEqual({ todos: [], counts: { pending: 0, inProgress: 0, completed: 0 } })
  })

  it.each([
    {
      name: 'an unknown status',
      todos: [{ content: 'Ship', status: 'done' }],
      reason: /todos\.0\.status: must be equal to one of/
    },
    {
      name: 'two todos in progress',
      todos: [
        { content: 'A', status: 'in_progress' },
        { content: 'B', status: 'in_progress' }
      ],
      reason: /at most one todo may be in_progress/
    },
    {
      name: 'duplicate content after trimming',
      todos: [
        { content: 'A', status: 'pending' },
        { content: ' A ', status: 'pending' }
      ],
      reason: /duplicate content "A"/
    },
    { name: 'blank content', todos: [{ content: '   ', status: 'pending' }], reason: /non-empty/ },
    {
      name: 'an extra item field',
      todos: [{ content: 'A', status: 'pending', priority: 'high' }],
      reason: /todos\.0: must not have additional properties/
    }
  ])('rejects $name and tells the model why', async ({ todos, reason }) => {
    const { model, calls } = scriptedModel([todoCall('call_bad', todos), [...textParts('t', 'Sorry.'), finish('stop')]])
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      extensionFactories: [createTodoExtension()]
    })
    await session.prompt('Plan it')

    const [result] = toolResults(session)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(reason)
    expect(toolOutputs(calls[1].prompt).call_bad).toEqual({ type: 'error-text', value: textOf(result) })
  })

  it('keeps the latest accepted list across a rebuild, for the host and for the model', async () => {
    const latest = [
      { content: 'Book flights', status: 'completed' },
      { content: 'Book hotel', status: 'in_progress' }
    ]
    const live = scriptedModel([
      todoCall('call_1', [
        { content: 'Book flights', status: 'in_progress' },
        { content: 'Book hotel', status: 'pending' }
      ]),
      [...textParts('a', 'Flights first.'), finish('stop')],
      todoCall('call_2', latest),
      todoCall('call_3', [
        { content: 'Book hotel', status: 'in_progress' },
        { content: 'Rent car', status: 'in_progress' }
      ]),
      [...textParts('b', 'Hotel next.'), finish('stop')]
    ])
    const host = hostStore()
    const earlier = await createTestSession({
      port: streamTextPort(live.model).port,
      extensionFactories: [createTodoExtension()],
      onEvent: host.onEvent
    })
    await earlier.session.prompt('Plan the trip')
    await earlier.session.prompt('Flights are booked')
    await earlier.dispose()

    expect(latestStoredList(host.entries)).toMatchObject({
      message: { content: [{ toolCallId: 'call_2' }] },
      details: { todos: latest }
    })

    const rebuilt = scriptedModel([[...textParts('c', 'Still on the hotel.'), finish('stop')]])
    const { session } = await createTestSession({
      port: streamTextPort(rebuilt.model).port,
      extensionFactories: [createTodoExtension()],
      transcript: plain(host.entries)
    })
    await session.prompt('Where are we?')

    const prompt = rebuilt.calls[0].prompt
    const sentCalls = prompt.flatMap((message) =>
      message.role === 'assistant' ? message.content.filter((part) => part.type === 'tool-call') : []
    )
    expect(sentCalls.map((part) => part.toolCallId)).toEqual(['call_1', 'call_2', 'call_3'])
    expect(sentCalls[1].input).toEqual({ todos: latest })
    expect(toolOutputs(prompt)).toMatchObject({
      call_2: { type: 'text', value: 'Updated todo list: 0 pending, 1 in progress, 1 completed.' },
      call_3: { type: 'error-text' }
    })
    expect(rebuilt.calls[0].tools?.map((tool) => tool.name)).toContain('todo_write')
  })
})
