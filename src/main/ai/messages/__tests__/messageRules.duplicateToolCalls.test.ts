import { createOpenAI } from '@ai-sdk/openai'
import { generateText, type ModelMessage, type UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { deduplicateLocalToolParts, toModelMessages } from '../messageRules'

const assistant = (parts: UIMessage['parts'], id = 'assistant'): UIMessage => ({ id, role: 'assistant', parts })
const completed = (label: string, kind: 'static' | 'dynamic' = 'dynamic', toolCallId = 'call_dup') =>
  ({
    ...(kind === 'static' ? { type: 'tool-lookup' } : { type: 'dynamic-tool', toolName: 'lookup' }),
    toolCallId,
    state: 'output-available',
    input: { query: label },
    output: { answer: label }
  }) as UIMessage['parts'][number]
const pending = {
  type: 'dynamic-tool',
  toolName: 'lookup',
  toolCallId: 'call_dup',
  state: 'input-available',
  input: { query: 'pending' }
} satisfies UIMessage['parts'][number]
const failed = {
  type: 'tool-lookup',
  toolCallId: 'call_dup',
  state: 'output-error',
  input: { query: 'interrupted' },
  rawInput: '{"query":"interrupted"}',
  errorText: 'Execution interrupted'
} satisfies UIMessage['parts'][number]
const answered = {
  ...pending,
  state: 'approval-responded',
  input: { query: 'approved' },
  approval: { id: 'approval', approved: true }
} satisfies UIMessage['parts'][number]
const unanswered = {
  ...pending,
  state: 'approval-requested',
  approval: { id: 'approval' }
} satisfies UIMessage['parts'][number]

const modelParts = (messages: ModelMessage[]) =>
  messages.flatMap<Exclude<ModelMessage['content'], string>[number]>((message) =>
    Array.isArray(message.content) ? message.content : []
  )

async function expectPair(parts: UIMessage['parts'], input: unknown, output: unknown) {
  const converted = modelParts(await toModelMessages([assistant(parts)]))
  expect(converted.filter((part) => part.type === 'tool-call')).toEqual([
    expect.objectContaining({ toolCallId: 'call_dup', toolName: 'lookup', input })
  ])
  expect(converted.filter((part) => part.type === 'tool-result')).toEqual([
    expect.objectContaining({ toolCallId: 'call_dup', toolName: 'lookup', output })
  ])
}

interface WireMessage {
  role: string
  content?: string
  tool_call_id?: string
  tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[]
}

async function serialize(messages: UIMessage[]): Promise<WireMessage[]> {
  let body: { messages: WireMessage[] } = { messages: [] }
  const model = createOpenAI({
    apiKey: 'test',
    baseURL: 'https://example.com/v1',
    fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return new Response(
        JSON.stringify({
          id: 'completion',
          object: 'chat.completion',
          created: 1,
          model: 'test-model',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        }),
        { headers: { 'content-type': 'application/json' } }
      )
    }
  }).chat('test-model')
  await generateText({ model, messages: await toModelMessages(messages) })
  return body.messages
}

describe('local tool identity', () => {
  it.each([
    ['static', 'static'],
    ['dynamic', 'dynamic'],
    ['static', 'dynamic'],
    ['dynamic', 'static']
  ] as const)('#22441 serializes %s/%s duplicates with the first complete pair intact', async (first, second) => {
    const parts = [completed('first', first), completed('second', second)]
    await expectPair(parts, { query: 'first' }, { type: 'json', value: { answer: 'first' } })
    const wire = await serialize([assistant(parts)])
    expect(wire.flatMap((message) => message.tool_calls ?? [])).toEqual([
      { id: 'call_dup', type: 'function', function: { name: 'lookup', arguments: '{"query":"first"}' } }
    ])
    expect(wire.filter((message) => message.role === 'tool')).toEqual([
      { role: 'tool', tool_call_id: 'call_dup', content: '{"answer":"first"}' }
    ])
  })

  it.each([false, true])('#22441 terminal beats incomplete at its own position (reverse=%s)', async (reverse) => {
    const terminal = completed('terminal')
    const parts = reverse ? [terminal, pending] : [pending, terminal]
    const marker = { type: 'text', text: 'between' } as const
    const input = [assistant([parts[0], marker, parts[1]])]
    expect(deduplicateLocalToolParts(input)[0].parts).toEqual(reverse ? [terminal, marker] : [marker, terminal])
    await expectPair(parts, { query: 'terminal' }, { type: 'json', value: { answer: 'terminal' } })
  })

  it('#22441 keeps the interrupted-only terminal input and rawInput with one error result', async () => {
    const input = [assistant([pending, failed, pending])]
    expect(deduplicateLocalToolParts(input)[0].parts[0]).toBe(failed)
    expect(failed.rawInput).toBe('{"query":"interrupted"}')
    await expectPair(input[0].parts, { query: 'interrupted' }, { type: 'error-text', value: 'Execution interrupted' })
  })

  it.each([false, true])('#22441 first conflicting error/success terminal wins (reverse=%s)', async (reverse) => {
    const parts = reverse ? [completed('success'), failed] : [failed, completed('success')]
    await expectPair(
      parts,
      { query: reverse ? 'success' : 'interrupted' },
      reverse ? { type: 'json', value: { answer: 'success' } } : { type: 'error-text', value: 'Execution interrupted' }
    )
  })

  it.each([false, true])('#22441 first conflicting success wins (reverse=%s)', async (reverse) => {
    const labels = reverse ? ['second', 'first'] : ['first', 'second']
    await expectPair(
      labels.map((label) => completed(label)),
      { query: labels[0] },
      {
        type: 'json',
        value: { answer: labels[0] }
      }
    )
  })

  it.each([false, true])('#22441 finalized output outranks preliminary output (reverse=%s)', async (reverse) => {
    const preliminary = { ...completed('preview'), preliminary: true } as UIMessage['parts'][number]
    const final = completed('final')
    await expectPair(
      reverse ? [final, preliminary] : [preliminary, final],
      { query: 'final' },
      {
        type: 'json',
        value: { answer: 'final' }
      }
    )
    const singleton = [assistant([preliminary])]
    expect(deduplicateLocalToolParts(singleton)).toBe(singleton)
    await expectPair([preliminary], { query: 'preview' }, { type: 'json', value: { answer: 'preview' } })
  })

  it.each([false, true])(
    '#22441 answered approval outranks incomplete, but not terminal (reverse=%s)',
    async (reverse) => {
      const parts = reverse ? [answered, pending] : [pending, answered]
      expect(deduplicateLocalToolParts([assistant(parts)])[0].parts).toEqual([answered])
      const converted = modelParts(await toModelMessages([assistant(parts)]))
      expect(converted.filter((part) => part.type === 'tool-call')).toEqual([
        expect.objectContaining({ toolCallId: 'call_dup', input: { query: 'approved' } })
      ])
      expect(converted.filter((part) => part.type === 'tool-approval-response')).toEqual([
        expect.objectContaining({ approvalId: 'approval', approved: true })
      ])
      expect(converted.filter((part) => part.type === 'tool-result')).toHaveLength(0)
      await expectPair(
        reverse ? [completed('final'), answered] : [answered, completed('final')],
        { query: 'final' },
        {
          type: 'json',
          value: { answer: 'final' }
        }
      )
    }
  )

  it('#22441 removes unanswered approvals before selecting a terminal, and drops unanswered-only groups', async () => {
    await expectPair(
      [unanswered, completed('final')],
      { query: 'final' },
      {
        type: 'json',
        value: { answer: 'final' }
      }
    )
    const parts = modelParts(await toModelMessages([assistant([unanswered, unanswered])]))
    expect(parts.filter((part) => part.type === 'tool-call' || part.type === 'tool-result')).toEqual([])
  })

  it.each([false, true])('#22441 denial and success have equal terminal priority (reverse=%s)', async (reverse) => {
    const denied = { ...answered, state: 'output-denied', approval: { id: 'approval', approved: false } } as const
    const parts = reverse ? [completed('success'), denied] : [denied, completed('success')]
    expect(deduplicateLocalToolParts([assistant(parts)])[0].parts).toEqual([parts[0]])
    const converted = modelParts(await toModelMessages([assistant(parts)]))
    expect(converted.filter((part) => part.type === 'tool-call')).toEqual([
      expect.objectContaining({ input: { query: reverse ? 'success' : 'approved' } })
    ])
    expect(converted.filter((part) => part.type === 'tool-result')).toEqual([
      expect.objectContaining({
        output: reverse
          ? { type: 'json', value: { answer: 'success' } }
          : {
              type: 'error-text',
              value:
                "The user doesn't want to proceed with this tool use. The tool use was rejected (it did not run). Wait for the user's instructions instead of retrying it."
            }
      })
    ])
  })

  it('#22441 groups across messages and steps without moving the winner or removing empty messages', async () => {
    const start = { type: 'step-start' } as const
    const terminal = completed('late')
    const user: UIMessage = { id: 'user', role: 'user', parts: [{ type: 'text', text: 'intervening' }] }
    const input = [assistant([pending], 'empty'), user, assistant([start, terminal, start], 'winner')]
    const output = deduplicateLocalToolParts(input)
    expect(output).toEqual([assistant([], 'empty'), user, assistant([start, terminal, start], 'winner')])
    expect(output[1]).toBe(user)
    expect(output[2]).toBe(input[2])
    const converted = await toModelMessages(input)
    expect(converted.map((message) => message.role)).toEqual(['user', 'assistant', 'tool'])
    expect(converted[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'intervening' }] })
    expect(modelParts(converted).filter((part) => part.type === 'tool-call')).toEqual([
      expect.objectContaining({ input: { query: 'late' } })
    ])
    expect(modelParts(converted).filter((part) => part.type === 'tool-result')).toEqual([
      expect.objectContaining({ output: { type: 'json', value: { answer: 'late' } } })
    ])
  })

  it('#22441 deduplicates completed calls globally across explicit steps and an intervening user', async () => {
    const start = { type: 'step-start' } as const
    const first = assistant([start, completed('first'), start], 'first')
    const user: UIMessage = { id: 'user', role: 'user', parts: [{ type: 'text', text: 'continue' }] }
    const last = assistant([start, completed('last'), start, { type: 'text', text: 'after' }], 'last')
    const shaped = deduplicateLocalToolParts([first, user, last])
    expect(shaped[0]).toBe(first)
    expect(shaped[1]).toBe(user)
    expect(shaped[2]).toEqual(assistant([start, start, { type: 'text', text: 'after' }], 'last'))
    const wire = await serialize([first, user, last])
    expect(wire.flatMap((message) => message.tool_calls ?? [])).toEqual([
      { id: 'call_dup', type: 'function', function: { name: 'lookup', arguments: '{"query":"first"}' } }
    ])
    expect(wire.filter((message) => message.role === 'tool')).toEqual([
      { role: 'tool', tool_call_id: 'call_dup', content: '{"answer":"first"}' }
    ])
    expect(wire.filter((message) => message.role === 'user')).toEqual([{ role: 'user', content: 'continue' }])
  })

  it.each([false, true])(
    '#22441 distinct identical calls survive parallel/sequential replay (sequential=%s)',
    async (sequential) => {
      const parts = [
        completed('same'),
        ...(sequential ? [{ type: 'step-start' } as const] : []),
        completed('same', 'dynamic', 'CALL_DUP')
      ]
      const wire = await serialize([assistant(parts)])
      expect(wire.flatMap((message) => message.tool_calls ?? [])).toEqual([
        { id: 'call_dup', type: 'function', function: { name: 'lookup', arguments: '{"query":"same"}' } },
        { id: 'CALL_DUP', type: 'function', function: { name: 'lookup', arguments: '{"query":"same"}' } }
      ])
      expect(wire.filter((message) => message.role === 'tool')).toEqual([
        { role: 'tool', tool_call_id: 'call_dup', content: '{"answer":"same"}' },
        { role: 'tool', tool_call_id: 'CALL_DUP', content: '{"answer":"same"}' }
      ])
    }
  )

  it.each([false, true])(
    '#22441 preserves whole provider-containing group, provider last (mixed=%s)',
    async (mixed) => {
      const first = { ...completed('first'), providerExecuted: !mixed } as UIMessage['parts'][number]
      const last = { ...completed('last'), providerExecuted: true } as UIMessage['parts'][number]
      const input = [assistant([first, last])]
      expect(deduplicateLocalToolParts(input)).toBe(input)
      const parts = modelParts(await toModelMessages(input))
      expect(parts.filter((part) => part.type === 'tool-call').map((part) => part.input)).toEqual([
        { query: 'first' },
        { query: 'last' }
      ])
      expect(parts.filter((part) => part.type === 'tool-result').map((part) => part.output)).toEqual([
        { type: 'json', value: { answer: mixed ? 'last' : 'first' } },
        { type: 'json', value: { answer: mixed ? 'first' : 'last' } }
      ])
    }
  )

  it('#22441 preserves frozen fields and references, is idempotent, and leaves non-assistant parts alone', async () => {
    const winner = {
      ...failed,
      title: 'Interrupted lookup',
      callProviderMetadata: { custom: { token: 'call' } },
      toolMetadata: { custom: { token: 'tool' } },
      extension: { nested: ['retained'] }
    }
    const user = { ...assistant([completed('user'), completed('user')]), role: 'user' } as UIMessage
    const input = [{ ...assistant([pending, winner]), metadata: { nested: ['metadata'] } }, user]
    function freeze(value: unknown): void {
      if (value !== null && typeof value === 'object') {
        Object.values(value).forEach(freeze)
        Object.freeze(value)
      }
    }
    freeze(input)
    const output = deduplicateLocalToolParts(input)
    expect(output[0].parts).toEqual([winner])
    expect(output[0].parts[0]).toBe(winner)
    expect(output[0].metadata).toBe(input[0].metadata)
    expect(output[1]).toBe(user)
    expect(input[0].parts).toEqual([pending, winner])
    expect(deduplicateLocalToolParts(output)).toBe(output)
    expect(deduplicateLocalToolParts([assistant([pending, pending])])[0].parts).toEqual([pending])
    const singleton = [assistant([winner])]
    expect(deduplicateLocalToolParts(singleton)).toBe(singleton)
    await toModelMessages([input[0]])
  })
})
