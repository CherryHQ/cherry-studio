import { randomUUID } from 'node:crypto'

import type { SDKAssistantMessage, SDKPartialAssistantMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk'
import { expect, it, vi } from 'vitest'

import { runtimeId, ThreadFeed, type ObservationPayload } from '@cherrystudio/agent-runtime'

import { claudeThread, type ClaudeObservation } from '../src'
import { ClaudeProjection } from '../src/projection'
import { assistantMessage } from './wireFixture'

type NativeBlock = SDKAssistantMessage['message']['content'][number]

it('retains an omitted background prompt through compaction until its native message is retracted', () => {
  const thread = claudeThread(runtimeId('backend'), randomUUID(), 'child')
  const projection = new ClaudeProjection(thread, (error) => {
    throw error
  })
  projection.publish(projection.startBackgroundTask('spawn', 'Check the logs'))
  const opening = { type: 'user', uuid: randomUUID(), childOpening: true } as const

  projection.restore([], [opening])
  expect(projection.committed().content).toMatchObject([{ role: 'user', parts: [{ text: 'Check the logs' }] }])

  projection.restore([], [opening, { type: 'assistant', retracted_message_uuids: [opening.uuid] }])
  expect(projection.feed.snapshot.messages).toEqual([])
  expect(projection.committed().content).toEqual([])
})

it('publishes legacy bindings only when changed and retains an isolated complete late-observer baseline', async () => {
  const sessionId = randomUUID()
  const projection = new ClaudeProjection(claudeThread(runtimeId('backend'), sessionId), (error) => {
    throw error
  })
  const batches: ClaudeObservation[] = []
  const observed = projection.feed.observe((batch) => {
    batches.push(batch)
  })
  await observed.drain()
  const committed = assistantMessage(sessionId, [{ type: 'text', text: 'saved', citations: [] }])
  projection.publish(projection.message(committed))
  await observed.drain()
  const key = `${committed.uuid}:0`
  expect(batches.at(-1)?.legacy?.[key]).toEqual({ messageId: committed.uuid, parts: [0] })
  expect(() => (batches.at(-1)!.legacy![key].parts[0] = 99)).toThrow(TypeError)
  projection.publish([{ type: 'activity.changed', activity: { state: 'active' } }])
  await observed.drain()
  expect(batches.at(-1)?.legacy).toBeUndefined()
  const late: ClaudeObservation[] = []
  const returning = projection.feed.observe((batch) => {
    late.push(batch)
  })
  await returning.drain()
  expect(late[0].legacy?.[key]).toEqual({ messageId: committed.uuid, parts: [0] })
  await observed.stop()
  await returning.stop()
  await projection.close()
})

const providerErrors = [
  {
    type: 'web_search_tool_result',
    tool_use_id: 'call',
    content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' }
  },
  {
    type: 'web_fetch_tool_result',
    tool_use_id: 'call',
    content: { type: 'web_fetch_tool_result_error', error_code: 'unavailable' }
  },
  {
    type: 'code_execution_tool_result',
    tool_use_id: 'call',
    content: { type: 'code_execution_tool_result_error', error_code: 'execution_time_exceeded' }
  },
  {
    type: 'bash_code_execution_tool_result',
    tool_use_id: 'call',
    content: { type: 'bash_code_execution_tool_result_error', error_code: 'execution_time_exceeded' }
  },
  {
    type: 'text_editor_code_execution_tool_result',
    tool_use_id: 'call',
    content: {
      type: 'text_editor_code_execution_tool_result_error',
      error_code: 'file_not_found',
      error_message: null
    }
  },
  {
    type: 'tool_search_tool_result',
    tool_use_id: 'call',
    content: {
      type: 'tool_search_tool_result_error',
      error_code: 'too_many_requests',
      error_message: 'Try again later'
    }
  }
] satisfies NativeBlock[]

it.each(providerErrors)('preserves $type failures in live and archived tool state', (block) => {
  const sessionId = randomUUID()
  const projection = new ClaudeProjection(claudeThread(runtimeId('backend'), sessionId), (error) => {
    throw error
  })
  const call = assistantMessage(sessionId, [{ type: 'server_tool_use', id: 'call', name: 'web_search', input: {} }])
  const result = assistantMessage(sessionId, [block])
  for (const message of [call, result]) projection.publish(projection.message(message))
  expect(projection.feed.snapshot.messages[0].parts[0]).toMatchObject({
    type: 'dynamic-tool',
    state: 'output-error',
    errorText: expect.stringContaining(block.content.error_code),
    resultProviderMetadata: { anthropic: { result: block.content } }
  })
  const archived = new ClaudeProjection(projection.thread, (error) => {
    throw error
  })
  const archive = archived.restore(
    [call, result].map((message) => ({ ...message, parent_agent_id: null })),
    []
  )
  expect(archive.content[0].parts).toEqual(projection.feed.snapshot.messages[0].parts)
})

it('retains streaming metadata for a late observer before a complete message', async () => {
  const sessionId = randomUUID()
  const projection = new ClaudeProjection(claudeThread(runtimeId('backend'), sessionId), (error) => {
    throw error
  })
  const partial = async (event: SDKPartialAssistantMessage['event']) => {
    projection.publish(
      await projection.partial({
        type: 'stream_event',
        event,
        uuid: randomUUID(),
        session_id: sessionId,
        parent_tool_use_id: null
      })
    )
  }
  const initialCitation = {
    type: 'char_location' as const,
    cited_text: 'quote',
    document_index: 0,
    document_title: 'doc',
    start_char_index: 0,
    end_char_index: 5,
    file_id: null
  }
  const sdkCitation = { ...initialCitation }
  const citation = { ...initialCitation, cited_text: 'second quote', start_char_index: 6, end_char_index: 18 }
  await partial({ type: 'message_start', message: assistantMessage(sessionId, []).message })
  await partial({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'redacted_thinking', data: 'ciphertext' }
  })
  await partial({ type: 'content_block_stop', index: 0 })
  await partial({
    type: 'content_block_start',
    index: 1,
    content_block: { type: 'thinking', thinking: '', signature: 'initial-signature' }
  })
  await partial({ type: 'content_block_stop', index: 1 })
  await partial({
    type: 'content_block_start',
    index: 2,
    content_block: { type: 'text', text: 'Answer', citations: [sdkCitation] }
  })
  sdkCitation.cited_text = 'Changed after the block was published'
  await partial({ type: 'content_block_delta', index: 2, delta: { type: 'citations_delta', citation } })
  await partial({ type: 'content_block_stop', index: 2 })
  await partial({
    type: 'content_block_start',
    index: 3,
    content_block: { type: 'thinking', thinking: 'Plan', signature: '' }
  })
  await partial({
    type: 'content_block_delta',
    index: 3,
    delta: { type: 'signature_delta', signature: 'streamed-signature' }
  })
  await partial({ type: 'content_block_stop', index: 3 })
  await partial({
    type: 'content_block_start',
    index: 4,
    content_block: { type: 'mcp_tool_use', id: 'lookup', name: 'lookup', input: {}, server_name: 'catalog' }
  })
  await partial({
    type: 'content_block_delta',
    index: 4,
    delta: { type: 'input_json_delta', partial_json: '{"query":"topic"}' }
  })
  await partial({ type: 'content_block_stop', index: 4 })
  const received: ObservationPayload[] = []
  const subscription = projection.feed.observe((batch) => {
    received.push(...batch.events)
  })
  await expect.poll(() => received.length).toBe(1)
  expect(received[0]).toMatchObject({
    messages: [
      {
        parts: [
          { type: 'reasoning', providerMetadata: { anthropic: { redactedData: 'ciphertext' } } },
          { type: 'reasoning', providerMetadata: { anthropic: { signature: 'initial-signature' } } },
          {
            type: 'text',
            text: 'Answer',
            providerMetadata: { anthropic: { citations: [initialCitation, citation] } }
          },
          { type: 'reasoning', text: 'Plan', providerMetadata: { anthropic: { signature: 'streamed-signature' } } },
          {
            type: 'dynamic-tool',
            toolCallId: 'lookup',
            state: 'input-available',
            input: { query: 'topic' },
            callProviderMetadata: { anthropic: { type: 'mcp_tool_use', serverName: 'catalog' } }
          }
        ]
      }
    ]
  })
  await subscription.stop()
  await projection.close()
})

it('does not interpret unknown archive blocks as tool results or discard their valid neighbors', () => {
  const sessionId = randomUUID()
  const projection = new ClaudeProjection(claudeThread(runtimeId('backend'), sessionId), (error) => {
    throw error
  })
  const call: SessionMessage = {
    ...assistantMessage(sessionId, [{ type: 'tool_use', id: 'call', name: 'Read', input: {} }]),
    parent_agent_id: null
  }
  const mixed: SessionMessage = {
    ...call,
    uuid: randomUUID(),
    message: {
      content: [
        { type: 'future_block', tool_use_id: 'call', content: 'Not a tool result' },
        null,
        { type: 'text', text: 42 },
        { type: 'document', source: { type: 'file', file_id: 'native-file' } },
        { type: 'text', text: 'Still readable' }
      ]
    }
  }
  const archive = projection.restore([call, mixed], [])
  expect(archive.content[0].parts[0]).toMatchObject({ type: 'dynamic-tool', state: 'input-available' })
  expect(archive.content[0].parts[0]).not.toHaveProperty('output')
  expect(archive.content[1].parts).toEqual([{ type: 'text', text: 'Still readable', state: 'done' }])
  expect(archive.legacy?.[`${mixed.uuid}:4`]).toEqual({ messageId: mixed.uuid, parts: [0] })
})

it.each([false, true])('keeps omitted tool output retracted after archive reconciliation (error: %s)', (isError) => {
  const sessionId = randomUUID()
  const projection = new ClaudeProjection(claudeThread(runtimeId('backend'), sessionId), (error) => {
    throw error
  })
  const call: SessionMessage = {
    type: 'assistant',
    uuid: 'call-message',
    session_id: sessionId,
    parent_tool_use_id: null,
    parent_agent_id: null,
    message: { content: [{ type: 'tool_use', id: 'call', name: 'Read', input: { path: '/document' } }] }
  }
  const result: SessionMessage = {
    ...call,
    type: 'user',
    uuid: 'result-message',
    message: { content: [{ type: 'tool_result', tool_use_id: 'call', content: 'Withdrawn output', is_error: isError }] }
  }
  const summary: SessionMessage = {
    ...call,
    uuid: 'summary',
    message: { content: [{ type: 'text', text: 'Selected summary' }] }
  }
  projection.restore([call, result], [])
  expect(projection.feed.snapshot.messages[0].parts[0]).toMatchObject({
    state: isError ? 'output-error' : 'output-available'
  })

  const archive = projection.restore([summary], [{ type: 'assistant', retracted_message_uuids: [result.uuid] }])
  expect(archive.retracted).toEqual([result.uuid])
  expect(archive.content.map((message) => message.id)).toEqual([summary.uuid])
  expect(projection.feed.snapshot.messages.map((message) => message.id)).toEqual([call.uuid, summary.uuid])
  expect(projection.feed.snapshot.messages[0].parts[0]).toMatchObject({
    type: 'dynamic-tool',
    toolCallId: 'call',
    input: { path: '/document' },
    state: 'input-available'
  })
  expect(projection.feed.snapshot.messages[0].parts[0]).not.toHaveProperty('output')
  expect(projection.feed.snapshot.messages[0].parts[0]).not.toHaveProperty('errorText')

  projection.restore([call, result, summary], [])
  expect(projection.feed.snapshot.messages[0].parts[0]).toMatchObject({ state: 'input-available' })
  expect(projection.feed.snapshot.messages[0].parts[0]).not.toHaveProperty('output')
  expect(projection.feed.snapshot.messages[0].parts[0]).not.toHaveProperty('errorText')
})

it.each([true, false, 'true', 1, undefined, 'other-uuid'])(
  'only restores a matching assistant native boolean rejection marker (%s)',
  async (marker) => {
    const sessionId = randomUUID()
    const source = assistantMessage(sessionId, [
      { type: 'text', text: 'API Error: Request rejected (429) · quoted', citations: null }
    ])
    const projection = new ClaudeProjection(claudeThread(runtimeId('backend'), sessionId), (error) => {
      throw error
    })
    projection.restore(
      [
        {
          type: 'assistant',
          uuid: source.uuid,
          session_id: sessionId,
          parent_tool_use_id: null,
          parent_agent_id: null,
          message: source.message
        }
      ],
      [
        {
          type: 'assistant',
          uuid: marker === 'other-uuid' ? randomUUID() : source.uuid,
          isApiErrorMessage: marker === 'other-uuid' ? true : marker
        }
      ]
    )
    const batches: ClaudeObservation[] = []
    const observation = projection.feed.observe((batch) => {
      batches.push(batch)
    })
    await observation.drain()
    expect(
      batches.flatMap((batch) => batch.native).find((entry) => entry.message.uuid === source.uuid)?.isApiErrorMessage
    ).toBe(marker === true ? true : undefined)
    expect(projection.feed.snapshot.messages[0].parts).toMatchObject([
      { type: 'text', text: 'API Error: Request rejected (429) · quoted' }
    ])
    await observation.stop()
  }
)

it.each([
  [20, 20],
  [20_000, 20],
  [20, 20_000]
])(
  'routes one SDK suffix with %i historical messages and %i settled blocks',
  async (history, siblings) => {
    const sessionId = randomUUID()
    const projection = new ClaudeProjection(claudeThread(runtimeId('bench'), sessionId), (error) => {
      throw error
    })
    const partial = async (event: SDKPartialAssistantMessage['event']) => {
      const message = {
        type: 'stream_event',
        event,
        uuid: randomUUID(),
        session_id: sessionId,
        parent_tool_use_id: null
      } as const
      projection.publish(await projection.partial(message), { source: 'live', message })
    }
    const messages = Array.from({ length: history }, () => {
      const source = assistantMessage(sessionId, [{ type: 'text', text: 'archived', citations: [] }])
      const [event] = projection.message(source)
      if (event.type !== 'message.reconcile') throw new Error('Missing historical source')
      return event.message
    })
    projection.publish([{ type: 'snapshot', activity: { state: 'active' }, inputs: [], messages }])
    await partial({ type: 'message_start', message: assistantMessage(sessionId, []).message })
    for (let index = 0; index <= siblings; index++) {
      await partial({ type: 'content_block_start', index, content_block: { type: 'text', text: 'a', citations: [] } })
      if (index < siblings) await partial({ type: 'content_block_stop', index })
    }
    const seen: ClaudeObservation[] = []
    const subscription = projection.feed.observe((batch) => {
      seen.push(batch)
    })
    await subscription.drain()
    const initial = seen[0].events[0]
    expect(initial.type === 'snapshot' && initial.messages.length).toBe(history + 1)
    seen.length = 0
    const reads = vi.spyOn(ThreadFeed.prototype, 'part')
    const whole = vi.spyOn(ThreadFeed.prototype, 'message')
    const snapshots = vi.spyOn(ThreadFeed.prototype, 'snapshot', 'get')
    try {
      await partial({ type: 'content_block_delta', index: siblings, delta: { type: 'text_delta', text: 'b' } })
      await subscription.drain()
      expect(seen.flatMap((batch) => batch.events)).toMatchObject([
        { type: 'message.text-append', part: siblings, text: 'b' }
      ])
      expect(reads.mock.calls.map(([, index]) => index)).toEqual([siblings])
      expect(whole).not.toHaveBeenCalled()
      expect(snapshots).not.toHaveBeenCalled()
    } finally {
      reads.mockRestore()
      whole.mockRestore()
      snapshots.mockRestore()
      await subscription.stop()
      await projection.close()
    }
  },
  30_000
)

it('does not repeat identical same-message parentless reasoning as text', () => {
  const sessionId = randomUUID()
  const projection = new ClaudeProjection(claudeThread(runtimeId('backend'), sessionId), (error) => {
    throw error
  })
  const snapshot = assistantMessage(sessionId, [
    { type: 'thinking', thinking: 'inspect the file', signature: 'signed' },
    { type: 'text', text: ' inspect the file ', citations: null }
  ])
  projection.publish(projection.message(snapshot, { live: true }))
  expect(projection.feed.snapshot.messages.flatMap((m) => m.parts).filter((p) => p.type === 'reasoning')).toHaveLength(
    1
  )
  expect(projection.feed.snapshot.messages.flatMap((m) => m.parts).filter((p) => p.type === 'text')).toHaveLength(0)
})

it('trims duplicate text but keeps distinct answers and other API messages', () => {
  const sessionId = randomUUID()
  const projection = new ClaudeProjection(claudeThread(runtimeId('backend'), sessionId), (error) => {
    throw error
  })
  const reasoning = assistantMessage(sessionId, [{ type: 'thinking', thinking: '  Plan  ', signature: 'signed' }])
  projection.publish(projection.message(reasoning))
  const duplicate = assistantMessage(sessionId, [{ type: 'text', text: '\nPlan\n', citations: null }])
  projection.publish(projection.message(duplicate))
  expect(projection.feed.snapshot.messages.flatMap((m) => m.parts).filter((p) => p.type === 'text')).toHaveLength(0)
  const distinct = assistantMessage(sessionId, [{ type: 'text', text: 'Plan then answer', citations: null }])
  projection.publish(projection.message(distinct))
  const other = assistantMessage(sessionId, [{ type: 'text', text: 'Plan', citations: null }])
  other.message.id = 'other-api-id'
  projection.publish(projection.message(other))
  expect(
    projection.feed.snapshot.messages
      .flatMap((m) => m.parts)
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
  ).toEqual(['Plan then answer', 'Plan'])
})

it.each([false, true])(
  'replaces a streamed duplicate at authoritative commit (snapshot before stop: %s)',
  async (beforeStop) => {
    const sessionId = randomUUID()
    const projection = new ClaudeProjection(claudeThread(runtimeId('backend'), sessionId), (error) => {
      throw error
    })
    const snapshot = assistantMessage(sessionId, [
      { type: 'thinking', thinking: 'Plan', signature: 'signed' },
      { type: 'text', text: 'Plan', citations: null }
    ])
    const partial = async (event: SDKPartialAssistantMessage['event']) =>
      projection.publish(
        await projection.partial({
          type: 'stream_event',
          event,
          uuid: randomUUID(),
          session_id: sessionId,
          parent_tool_use_id: null
        })
      )
    await partial({ type: 'message_start', message: assistantMessage(sessionId, []).message })
    for (const [index, content_block] of snapshot.message.content.entries()) {
      if (content_block.type !== 'thinking' && content_block.type !== 'text') continue
      await partial({ type: 'content_block_start', index, content_block })
      if (!beforeStop) await partial({ type: 'content_block_stop', index })
    }
    projection.publish(projection.message(snapshot, { live: true }))
    if (beforeStop) for (const index of [0, 1]) await partial({ type: 'content_block_stop', index })
    const parts = projection.feed.snapshot.messages.flatMap((m) => m.parts)
    expect(parts.filter((p) => p.type === 'reasoning').map((p) => p.text)).toEqual(['Plan'])
    expect(parts.filter((p) => p.type === 'text')).toHaveLength(0)
    expect(projection.feed.snapshot.messages.some((m) => m.id.startsWith('live:'))).toBe(false)
    await projection.close()
  }
)

it('preserves a distinct answer suffix and complete fallback reasoning, including archives', () => {
  const sessionId = randomUUID()
  const snapshot = assistantMessage(sessionId, [
    { type: 'thinking', thinking: 'Complete fallback reasoning', signature: 'signed' },
    { type: 'text', text: 'Complete fallback reasoning', citations: null },
    { type: 'text', text: 'The answer is 42', citations: null }
  ])
  const projection = new ClaudeProjection(claudeThread(runtimeId('backend'), sessionId), (error) => {
    throw error
  })
  projection.publish(projection.message(snapshot, { live: true }))
  expect(projection.feed.snapshot.messages[0].parts.map((p) => ('text' in p ? p.text : ''))).toEqual([
    'Complete fallback reasoning',
    'The answer is 42'
  ])
  const archived = new ClaudeProjection(projection.thread, (error) => {
    throw error
  })
  expect(archived.restore([{ ...snapshot, parent_agent_id: null }], []).content[0].parts).toEqual(
    projection.feed.snapshot.messages[0].parts
  )
})

it('removes an all-duplicate streamed snapshot using earlier same-API reasoning', async () => {
  const sessionId = randomUUID()
  const projection = new ClaudeProjection(claudeThread(runtimeId('backend'), sessionId), (error) => {
    throw error
  })
  projection.publish(
    projection.message(assistantMessage(sessionId, [{ type: 'thinking', thinking: 'Plan', signature: 'signed' }]))
  )
  const partial = async (event: SDKPartialAssistantMessage['event']) =>
    projection.publish(
      await projection.partial({
        type: 'stream_event',
        event,
        uuid: randomUUID(),
        session_id: sessionId,
        parent_tool_use_id: null
      })
    )
  await partial({ type: 'message_start', message: assistantMessage(sessionId, []).message })
  await partial({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: 'Plan', citations: null }
  })
  await partial({ type: 'content_block_stop', index: 0 })
  projection.publish(
    projection.message(assistantMessage(sessionId, [{ type: 'text', text: 'Plan', citations: null }]), { live: true })
  )
  expect(projection.feed.snapshot.messages.flatMap((m) => m.parts).filter((p) => p.type === 'text')).toHaveLength(0)
  expect(projection.feed.snapshot.messages.some((m) => m.id.startsWith('live:'))).toBe(false)
  expect(projection.feed.snapshot.messages.every((m) => m.parts.length > 0)).toBe(true)
  expect(projection.committed().content.every((m) => m.parts.length > 0)).toBe(true)
  await projection.close()
})

it.each(['Let me inspect', '  Let me inspect'])('preserves full fallback after streamed prefix %j', async (prefix) => {
  const sessionId = randomUUID()
  const projection = new ClaudeProjection(claudeThread(runtimeId('backend'), sessionId), (error) => {
    throw error
  })
  const partial = async (event: SDKPartialAssistantMessage['event']) =>
    projection.publish(
      await projection.partial({
        type: 'stream_event',
        event,
        uuid: randomUUID(),
        session_id: sessionId,
        parent_tool_use_id: null
      })
    )
  await partial({ type: 'message_start', message: assistantMessage(sessionId, []).message })
  await partial({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'thinking', thinking: prefix, signature: '' }
  })
  const complete = 'Let me inspect the file first, then run the tests.'
  projection.publish(
    projection.message(
      assistantMessage(sessionId, [
        { type: 'thinking', thinking: complete, signature: 'signed' },
        { type: 'text', text: complete, citations: null }
      ]),
      { live: true }
    )
  )
  const parts = projection.feed.snapshot.messages.flatMap((m) => m.parts)
  expect(parts.filter((p) => p.type === 'reasoning').map((p) => p.text)).toEqual([complete])
  expect(parts.filter((p) => p.type === 'text')).toHaveLength(0)
  await partial({ type: 'content_block_stop', index: 0 })
  expect(
    projection.feed.snapshot.messages
      .flatMap((m) => m.parts)
      .filter((p) => p.type === 'reasoning')
      .map((p) => p.text)
  ).toEqual([complete])
  await projection.close()
})

for (const split of [false, true]) {
  it(`preserves parented child text equal to reasoning (split=${split}) in live and archive projections`, () => {
    const sessionId = randomUUID()
    const thread = claudeThread(runtimeId('backend'), sessionId, 'child')
    const blocks: SDKAssistantMessage['message']['content'] = [
      { type: 'thinking', thinking: '42', signature: 'signed' },
      { type: 'text', text: '42', citations: null }
    ]
    const snapshots = (split ? blocks.map((block) => [block]) : [blocks]).map((content) => ({
      ...assistantMessage(sessionId, content, { parent_tool_use_id: 'spawn-child' }),
      agent_id: 'child'
    }))
    const live = new ClaudeProjection(thread, (error) => {
      throw error
    })
    for (const snapshot of snapshots) live.publish(live.message(snapshot))
    expect(
      live.feed.snapshot.messages
        .flatMap((m) => m.parts)
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
    ).toEqual(['42'])
    for (const parent_agent_id of [null, 'parent-agent']) {
      const archived = new ClaudeProjection(thread, (error) => {
        throw error
      })
      expect(
        archived
          .restore(
            snapshots.map((m) => ({ ...m, parent_agent_id })),
            []
          )
          .content.flatMap((m) => m.parts)
          .filter((p) => p.type === 'text')
          .map((p) => p.text)
      ).toEqual(['42'])
    }
  })
}

it.each([null, 'parent-agent'])(
  'preserves archived child answers independently of live projection (parent=%s)',
  (parent_agent_id) => {
    const sessionId = randomUUID()
    const snapshot = assistantMessage(
      sessionId,
      [
        { type: 'thinking', thinking: '42', signature: 'signed' },
        { type: 'text', text: '42', citations: null }
      ],
      { parent_tool_use_id: 'spawn-child' }
    )
    const archived = new ClaudeProjection(claudeThread(runtimeId('backend'), sessionId, 'child'), (error) => {
      throw error
    })
    expect(
      archived
        .restore([{ ...snapshot, parent_agent_id }], [])
        .content.flatMap((m) => m.parts)
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
    ).toEqual(['42'])
  }
)

it('preserves a known child answer even if a producer omits its parent-tool link', () => {
  const sessionId = randomUUID()
  const snapshot = assistantMessage(sessionId, [
    { type: 'thinking', thinking: '42', signature: 'signed' },
    { type: 'text', text: '42', citations: null }
  ])
  const thread = claudeThread(runtimeId('backend'), sessionId, 'child')
  const live = new ClaudeProjection(thread, (error) => {
    throw error
  })
  live.publish(live.message(snapshot))
  expect(
    live.feed.snapshot.messages
      .flatMap((m) => m.parts)
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
  ).toEqual(['42'])
  const archived = new ClaudeProjection(thread, (error) => {
    throw error
  })
  expect(
    archived
      .restore([{ ...snapshot, parent_agent_id: null }], [])
      .content.flatMap((m) => m.parts)
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
  ).toEqual(['42'])
})

it.each([
  ['42', false],
  ['42', true],
  ['The complete fallback answer is 42', false],
  ['The complete fallback answer is 42', true]
] as const)('preserves fallback %j after synthetic-user continuation (new stream: %s)', async (answer, newStream) => {
  const sessionId = randomUUID()
  const projection = new ClaudeProjection(claudeThread(runtimeId('backend'), sessionId), (error) => {
    throw error
  })
  const partial = async (event: SDKPartialAssistantMessage['event']) =>
    projection.publish(
      await projection.partial({
        type: 'stream_event',
        event,
        uuid: randomUUID(),
        session_id: sessionId,
        parent_tool_use_id: null
      })
    )
  await partial({ type: 'message_start', message: assistantMessage(sessionId, []).message })
  await partial({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'thinking', thinking: 'Plan', signature: 'signed' }
  })
  await partial({ type: 'content_block_stop', index: 0 })
  await partial({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '', citations: null } })
  await partial({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Let me ' } })
  projection.publish(
    projection.message({
      type: 'user',
      uuid: randomUUID(),
      session_id: sessionId,
      parent_tool_use_id: null,
      message: { role: 'user', content: 'Continue from where you left off.' },
      isSynthetic: true
    })
  )
  const fallback = assistantMessage(sessionId, [{ type: 'text', text: answer, citations: null }])
  fallback.message.id = 'fallback-api'
  if (newStream) await partial({ type: 'message_start', message: fallback.message })
  projection.publish(projection.message(fallback, { live: true }))
  expect(
    projection.feed.snapshot.messages
      .flatMap((m) => m.parts)
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
  ).toContain(answer)
  expect(
    projection
      .committed()
      .content.flatMap((m) => m.parts)
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
  ).toContain(answer)
  await projection.close()
})
