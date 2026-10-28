import { normalizeContext, type AssistantMessage, type Message, type ToolResultMessage } from '@earendil-works/pi-ai'
import type { ProviderConfig } from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vitest'

import { normalizePiToolResultReplay, withPiToolResultReplay } from './piToolResultReplay'

function assistant(calls: [unknown, string][], stopReason: AssistantMessage['stopReason'] = 'toolUse'): Message {
  return {
    role: 'assistant',
    content: calls.map(([id, name]) => ({ type: 'toolCall', id: id as string, name, arguments: { path: 'same' } })),
    api: 'openai-completions',
    provider: 'fixture',
    model: 'fixture',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason,
    timestamp: 1
  }
}

function result(id?: unknown, toolName: unknown = 'read'): Message {
  return {
    role: 'toolResult',
    ...(id === undefined ? {} : { toolCallId: id }),
    toolName,
    content: [
      { type: 'text', text: 'REAL_OUTPUT' },
      { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }
    ],
    details: { path: 'same' },
    isError: false,
    timestamp: 2
  } as ToolResultMessage
}

function normalize(messages: Message[]) {
  return normalizePiToolResultReplay(normalizeContext({ messages })).messages
}

function freeze(value: unknown): void {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
}

describe('Pi tool result replay', () => {
  it.each([false, true])('repairs a unique name without changing output or metadata (own undefined: %s)', (own) => {
    const output = result() as ToolResultMessage
    if (own) output.toolCallId = undefined as never
    const input = normalizeContext({ messages: [assistant([['call_a', 'read']]), output] })
    freeze(input)
    const repaired = normalizePiToolResultReplay(input)
    expect(repaired).not.toBe(input)
    expect(repaired.messages).not.toBe(input.messages)
    expect(repaired.messages[0]).toBe(input.messages[0])
    expect(repaired.messages[1]).toEqual({ ...output, toolCallId: 'call_a' })
    const tool = repaired.messages[1] as ToolResultMessage
    expect(tool.content).toBe(output.content)
    expect(tool.details).toBe(output.details)
    expect(output.toolCallId).toBeUndefined()
    expect(Object.hasOwn(output, 'toolCallId')).toBe(own)
  })

  it('associates reversed parallel completions by exact name without reordering', () => {
    const write = result(undefined, 'write')
    const read = result()
    const messages = normalize([
      assistant([
        ['call_a', 'read'],
        ['call_b', 'write']
      ]),
      write,
      read
    ])
    expect(messages.slice(1)).toEqual([
      { ...write, toolCallId: 'call_b' },
      { ...read, toolCallId: 'call_a' }
    ])
  })

  it('reserves a later explicit answer before associating the anonymous result', () => {
    const explicit = result('call_a')
    const messages = normalize([
      assistant([
        ['call_a', 'read'],
        ['call_b', 'read']
      ]),
      result(),
      explicit
    ])
    expect(messages[1]).toMatchObject({ toolCallId: 'call_b' })
    expect(messages[2]).toBe(explicit)
  })

  it('drops an earlier anonymous duplicate of a later explicit answer', () => {
    const call = assistant([['call_a', 'read']])
    const explicit = result('call_a')
    expect(normalize([call, result(), explicit])).toEqual([call, explicit])
  })

  it.each([
    {
      calls: [
        ['call_a', 'read'],
        ['call_b', 'read']
      ],
      count: 1
    },
    {
      calls: [
        ['call_a', 'read'],
        ['call_b', 'read']
      ],
      count: 2
    },
    {
      calls: [
        ['', 'read'],
        ['call_a', 'read']
      ],
      count: 1
    },
    {
      calls: [
        [undefined, 'read'],
        ['call_a', 'read']
      ],
      count: 1
    },
    {
      calls: [
        ['dup', 'read'],
        ['dup', 'read'],
        ['call_a', 'read']
      ],
      count: 1
    },
    { calls: [['', 'read']], count: 1 },
    { calls: [[undefined, 'read']], count: 1 }
  ])('drops ambiguous or unusable sources: $calls / $count outputs', ({ calls, count }) => {
    const call = assistant(calls as [unknown, string][])
    expect(normalize([call, ...Array.from({ length: count }, () => result())])).toEqual([call])
  })

  it('does not treat a duplicate id as definitely answered', () => {
    const call = assistant([
      ['dup', 'read'],
      ['dup', 'read'],
      ['call_a', 'read']
    ])
    const explicit = result('dup')
    expect(normalize([call, result(), explicit])).toEqual([call, explicit])
  })

  it('never borrows calls across assistant or user boundaries', () => {
    const call = assistant([['call_a', 'read']])
    const user: Message = { role: 'user', content: 'next', timestamp: 3 }
    const next = assistant([['call_b', 'write']])
    expect(normalize([result(), call, user, result(), next, result()])).toEqual([call, user, next])
  })

  it.each(['error', 'aborted'] as const)('drops results after a %s assistant', (reason) => {
    const call = assistant([['call_a', 'read']], reason)
    expect(normalize([call, result()])).toEqual([call])
  })

  it('keeps a system message transparent to association', () => {
    const system: Message = { role: 'system', content: 'instruction', timestamp: 2 }
    const messages = normalize([assistant([['call_a', 'read']]), system, result()])
    expect(messages[1]).toBe(system)
    expect(messages[2]).toMatchObject({ toolCallId: 'call_a' })
  })

  it.each([undefined, ''])('drops an output with missing or empty name: %s', (name) => {
    const call = assistant([['call_a', 'read']])
    const output = result() as ToolResultMessage
    if (name === undefined) delete (output as Partial<ToolResultMessage>).toolName
    else output.toolName = name
    expect(normalize([call, output])).toEqual([call])
  })

  it('uses exact names and preserves whitespace ids', () => {
    expect(normalize([assistant([[' ', ' read ']]), result(undefined, ' read ')])[1]).toMatchObject({ toolCallId: ' ' })
    const call = assistant([['call_a', 'read']])
    expect(normalize([call, result(undefined, ' read ')])).toEqual([call])
  })

  it.each(['', 'unmatched', null, 42])('preserves explicit ids without interpreting them: %s', (id) => {
    for (const callId of ['', 'call_a']) {
      const context = normalizeContext({ messages: [assistant([[callId, 'read']]), result(id)] })
      freeze(context)
      expect(normalizePiToolResultReplay(context)).toBe(context)
      expect(normalizePiToolResultReplay(context).messages).toBe(context.messages)
    }
  })

  it('returns the exact frozen valid context, array and message objects', () => {
    const context = normalizeContext({ messages: [assistant([['call_a', 'read']]), result('call_a')] })
    freeze(context)
    const output = normalizePiToolResultReplay(context)
    expect(output).toBe(context)
    expect(output.messages).toBe(context.messages)
    output.messages.forEach((message, index) => expect(message).toBe(context.messages[index]))
  })

  it('delegates synchronously with repaired history, preserving model, options and stream identity', () => {
    type Stream = NonNullable<ProviderConfig['streamSimple']>
    const stream = {} as ReturnType<Stream>
    const delegate = vi.fn<Stream>(() => stream)
    const model = {} as Parameters<Stream>[0]
    const options = { signal: new AbortController().signal, onPayload: vi.fn() }
    const context = normalizeContext({ messages: [assistant([['call_a', 'read']]), result()] })
    expect(withPiToolResultReplay(delegate)(model, context, options)).toBe(stream)
    const [receivedModel, receivedContext, receivedOptions] = delegate.mock.calls[0]
    expect(receivedModel).toBe(model)
    expect(receivedOptions).toBe(options)
    expect(receivedContext.messages[1]).toMatchObject({ toolCallId: 'call_a' })
    expect(context.messages[1]).not.toHaveProperty('toolCallId')
  })
})
