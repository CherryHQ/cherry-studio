import { randomUUID } from 'node:crypto'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'

import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKPermissionDeniedMessage,
  SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'

import { claudeThread, type ClaudeObservation } from '../src'
import { ClaudeFeed } from '../src/observation'
import { confirmed, observe, textOf } from './nativeFixture'
import { assistantMessage, wireFixture } from './wireFixture'

it('does not multiply unchanged tool-result containers behind a slow observer', async () => {
  setFlagsFromString('--expose_gc')
  const gc = runInNewContext('gc') as () => void
  const heap = async () => {
    await nextTurn()
    gc()
    await nextTurn()
    gc()
    return process.memoryUsage().heapUsed
  }
  const failures: unknown[] = []
  const feed = new ClaudeFeed((error) => failures.push(error))
  const content = Array.from({ length: 16000 }, (_, index) => ({ type: 'text' as const, text: `block ${index}` }))
  feed.publish(
    [
      {
        type: 'message.upsert',
        message: {
          id: 'tool',
          role: 'assistant',
          metadata: { completeness: 'complete' },
          parts: [
            {
              type: 'dynamic-tool',
              toolName: 'test',
              toolCallId: 'call',
              state: 'output-available',
              input: {},
              output: content
            }
          ]
        }
      }
    ],
    [
      {
        source: 'live',
        message: {
          type: 'user',
          uuid: randomUUID(),
          session_id: 'test',
          parent_tool_use_id: null,
          message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call', content }] }
        }
      }
    ]
  )
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let received = 0,
    controls = 0,
    closed = false
  const observation = feed.observe(async (batch) => {
    controls += batch.controls?.length ?? 0
    closed ||= batch.events.some((event) => event.type === 'closed')
    if (++received === 1) await gate
  })
  try {
    await nextTurn()
    const before = await heap()
    for (let index = 0; index < 40; index++)
      feed.publish([], [], undefined, [], [{ type: 'background-work-state', active: index % 2 === 0 }])
    expect((await heap()) - before).toBeLessThan(16 * 1024 * 1024)
    release()
    await observation.drain()
    expect(controls).toBe(40)
    expect(closed).toBe(false)
    expect(failures).toEqual([])
  } finally {
    release()
    await observation.stop()
  }
})

it('reports critical byte pressure before a stalled consumer resumes', async () => {
  const failures: unknown[] = []
  const feed = new ClaudeFeed((error) => failures.push(error))
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const received: string[] = []
  const observation = feed.observe(async (batch) => {
    received.push(...batch.events.map((event) => event.type))
    if (received.length === 1) await gate
  })
  try {
    await nextTurn()
    for (let index = 0; index < 12; index++)
      feed.publish([], [], undefined, [], [{ type: 'diagnostic', message: `${index}:${'x'.repeat(1024 * 1024)}` }])
    expect(failures).toEqual([
      expect.objectContaining({ message: 'Claude observer exceeded recoverable control backlog' })
    ])
    expect(received).toEqual(['snapshot'])
    release()
    await observation.drain()
    expect(received).toEqual(['snapshot', 'gap', 'closed'])
  } finally {
    release()
    await observation.stop()
  }
})

it('keeps a complete oversized baseline first when byte pressure closes before delivery starts', async () => {
  const feed = new ClaudeFeed(() => {})
  const body = 'x'.repeat(9 * 1024 * 1024)
  feed.publish([
    {
      type: 'message.upsert',
      message: {
        id: 'large',
        role: 'assistant',
        metadata: { completeness: 'complete' },
        parts: [{ type: 'text', text: body }]
      }
    }
  ])
  const received: ClaudeObservation[] = []
  const observation = feed.observe((batch) => {
    received.push(batch)
  })
  for (let index = 0; index < 12; index++)
    feed.publish([], [], undefined, [], [{ type: 'diagnostic', message: `${index}:${'y'.repeat(1024 * 1024)}` }])
  await observation.drain()
  expect(received.flatMap((batch) => batch.events.map((event) => event.type))).toEqual(['snapshot', 'gap', 'closed'])
  expect(received[0].events[0]).toMatchObject({ messages: [{ parts: [{ type: 'text', text: body }] }] })
})

it('recovers small typed views that retain oversized backing buffers', async () => {
  const feed = new ClaudeFeed((error) => {
    throw error
  })
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const received: ClaudeObservation[] = []
  const observation = feed.observe(async (batch) => {
    received.push(batch)
    if (received.length === 1) await gate
  })
  try {
    await nextTurn()
    for (let index = 0; index < 3; index++) {
      const output = new Uint8Array(new ArrayBuffer(9 * 1024 * 1024), 0, 1)
      output[0] = index
      feed.publish([
        {
          type: 'message.upsert',
          message: {
            id: 'buffer',
            role: 'assistant',
            metadata: { completeness: 'complete' },
            parts: [
              {
                type: 'dynamic-tool',
                toolName: 'test',
                toolCallId: 'call',
                state: 'output-available',
                input: {},
                output
              }
            ]
          }
        }
      ])
    }
    release()
    await observation.drain()
    expect(received.some((batch) => batch.events.some((event) => event.type === 'gap'))).toBe(true)
    expect(received.at(-1)?.events).toContainEqual(
      expect.objectContaining({
        type: 'snapshot',
        messages: [expect.objectContaining({ parts: [expect.objectContaining({ output: new Uint8Array([2]) })] })]
      })
    )
  } finally {
    release()
    await observation.stop()
  }
})

it('recovers the captured revision and usage once despite publisher and observer edits', async () => {
  const feed = new ClaudeFeed((error) => {
    throw error
  })
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const batches: ClaudeObservation[] = []
  const held = feed.observe(async (batch) => {
    batches.push(batch)
    if (batches.length === 1) await gate
  })
  const mutating = feed.observe((batch) => {
    for (const event of batch.events) {
      if (event.type === 'snapshot') for (const message of event.messages) message.parts.length = 0
      if (event.type === 'message.upsert') event.message.parts.length = 0
    }
    for (const value of batch.native)
      if (value.source === 'live' && value.message.type === 'assistant') value.message.message.content = []
  })
  try {
    await nextTurn()
    const nativeId = randomUUID()
    for (let revision = 1; revision <= 3; revision++) {
      const native = assistantMessage('test', [{ type: 'text', text: `revision ${revision}`, citations: null }], {
        uuid: nativeId
      })
      const message = {
        id: 'answer',
        role: 'assistant' as const,
        metadata: { completeness: 'complete' as const },
        parts: [{ type: 'text' as const, text: `revision ${revision}` }]
      }
      feed.publish(
        [{ type: 'message.upsert', message }],
        [{ source: 'live', message: native }],
        undefined,
        [{ responseId: `response-${revision}` }],
        [{ type: 'response-start', responseId: `response-${revision}` }]
      )
      message.parts[0].text = 'publisher edit'
      native.message.content = []
      await mutating.drain()
    }
    for (let index = 0; index < 110; index++) feed.publish([{ type: 'activity.changed', activity: { state: 'idle' } }])
    release()
    await held.drain()
    const recovered = batches.filter((batch) => batch.invocations?.length)
    expect(recovered.flatMap((batch) => batch.invocations!.map((invocation) => invocation.responseId))).toEqual([
      'response-1',
      'response-2',
      'response-3'
    ])
    for (const [index, batch] of recovered.entries()) {
      expect(batch.events).toContainEqual(
        expect.objectContaining({
          type: 'snapshot',
          messages: [expect.objectContaining({ parts: [{ type: 'text', text: `revision ${index + 1}` }] })]
        })
      )
      expect(batch.native[0].message).toMatchObject({
        message: { content: [{ type: 'text', text: `revision ${index + 1}` }] }
      })
    }
    expect(feed.snapshot.messages[0].parts).toEqual([{ type: 'text', text: 'revision 3' }])
  } finally {
    release()
    await held.stop()
    await mutating.stop()
  }
})

function denied(sessionId: string, toolUseId: string): SDKPermissionDeniedMessage {
  return {
    type: 'system',
    subtype: 'permission_denied',
    tool_use_id: toolUseId,
    tool_name: 'Bash',
    message: 'Permission denied',
    uuid: randomUUID(),
    session_id: sessionId
  }
}

it('attaches current background occupancy without replaying an earlier completion or charge', async () => {
  const test = await wireFixture()
  try {
    test.send(test.assistant('Earlier reply'))
    test.send({
      type: 'result',
      subtype: 'success',
      uuid: randomUUID(),
      session_id: test.sessionId,
      result: 'Earlier reply',
      is_error: false,
      usage: { input_tokens: 1, output_tokens: 1 },
      modelUsage: {},
      permission_denials: []
    } as unknown as SDKMessage)
    test.send({
      type: 'system',
      subtype: 'background_tasks_changed',
      uuid: randomUUID(),
      session_id: test.sessionId,
      tasks: [{ task_id: 'child', task_type: 'local_agent', description: 'Still working' }]
    })
    await expect
      .poll(() =>
        test.view.batches.flatMap((batch) => batch.controls ?? []).some((fact) => fact.type === 'background-tasks')
      )
      .toBe(true)
    expect(test.view.batches.flatMap((batch) => batch.controls ?? []).some((fact) => fact.type === 'result')).toBe(true)
    const batches: ClaudeObservation[] = []
    const observation = confirmed(
      await test.root.claude.observe((batch) => {
        batches.push(batch)
      })
    )
    await observation.drain()
    expect(batches[0].controls).toEqual(
      expect.arrayContaining([
        {
          type: 'background-tasks',
          tasks: [{ task_id: 'child', task_type: 'local_agent', description: 'Still working' }]
        },
        { type: 'background-work-state', active: true }
      ])
    )
    expect(batches[0].controls).not.toContainEqual(expect.objectContaining({ type: 'result' }))
    expect(batches[0].invocations ?? []).toEqual([])
    expect(batches[0].live).toEqual([])
    await observation.stop()
  } finally {
    await test.close()
  }
})

it('delivers queued final content before close without waiting for a detached or slow consumer', async () => {
  const test = await wireFixture()
  let resume!: () => void
  const gate = new Promise<void>((resolve) => {
    resume = resolve
  })
  try {
    const events: ClaudeObservation[] = []
    const observation = confirmed(
      await test.root.claude.observe(async (batch) => {
        events.push(batch)
        if (events.length === 1) await gate
      })
    )
    await expect.poll(() => events.length).toBe(1)
    test.send(test.assistant('Last content'))
    await expect.poll(() => textOf(test.view.snapshot)).toContain('Last content')
    confirmed(await test.runtime.shutdown())
    let drained = false
    const barrier = observation.drain().then(() => {
      drained = true
    })
    expect(events).toHaveLength(1)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(drained).toBe(false)
    resume()
    await barrier
    expect(events.at(-1)?.events.at(-1)?.type).toBe('closed')
    expect(
      events
        .slice(0, -1)
        .flatMap((batch) => batch.events)
        .some(
          (event) =>
            event.type === 'message.upsert' &&
            event.message.parts.some((part) => 'text' in part && part.text === 'Last content')
        )
    ).toBe(true)
  } finally {
    resume()
    await test.close()
  }
})

it('does not turn an interrupted tool-input block into a completed call at message_stop', async () => {
  const test = await wireFixture()
  try {
    const assistant = test.assistant('')
    const partial = (event: SDKPartialAssistantMessage['event']) =>
      test.send({
        type: 'stream_event',
        uuid: randomUUID(),
        session_id: test.sessionId,
        parent_tool_use_id: null,
        event
      })
    partial({ type: 'message_start', message: { ...assistant.message, content: [] } })
    partial({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'call', name: 'Bash', input: {} }
    })
    partial({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":' } })
    partial({ type: 'message_stop' })
    await expect
      .poll(() => test.view.snapshot.messages[0])
      .toMatchObject({
        metadata: { completeness: 'partial' },
        parts: [{ type: 'dynamic-tool', toolCallId: 'call', state: 'input-streaming' }]
      })
    expect(test.view.snapshot.inputs.every((input) => input.outcome === undefined)).toBe(true)
  } finally {
    await test.close()
  }
})

it('upserts repeated UUIDs, retains same-API distinct blocks, and never resurrects retracted sources', async () => {
  const test = await wireFixture()
  try {
    const first = test.assistant('First')
    const second = test.assistant('Second')
    test.send(first)
    test.send(second)
    test.send(first)
    await expect.poll(() => textOf(test.view.snapshot)).toEqual(['First', 'Second'])
    const replacement = test.assistant('Replacement', { supersedes: [first.uuid] })
    test.send(replacement)
    test.send(first)
    await expect.poll(() => textOf(test.view.snapshot)).toEqual(['Second', 'Replacement'])
    const resultId = randomUUID()
    test.send({
      type: 'user',
      uuid: resultId,
      session_id: test.sessionId,
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'old_call', content: 'Retracted result' }]
      }
    })
    test.send({
      type: 'system',
      subtype: 'model_refusal_fallback',
      uuid: randomUUID(),
      session_id: test.sessionId,
      scope: 'session',
      trigger: 'refusal',
      direction: 'retry',
      original_model: 'original',
      fallback_model: 'fallback',
      request_id: null,
      content: '',
      retracted_message_uuids: [second.uuid, resultId]
    })
    await expect.poll(() => test.view.snapshot.messages).toHaveLength(1)
    const reopened = await observe(confirmed(await test.runtime.open(test.root.thread)))
    await expect.poll(() => textOf(reopened.snapshot)).toEqual(['Replacement'])
    expect(reopened.batches[0].retracted).toEqual(expect.arrayContaining([first.uuid, second.uuid, resultId]))
    expect(reopened.native.filter((event) => event.type === 'assistant').map((event) => event.uuid)).toEqual([
      replacement.uuid
    ])
  } finally {
    await test.close()
  }
})

it('keeps a missing parent unresolved and rejects older run state after continuation', async () => {
  const test = await wireFixture()
  try {
    const start = (id: string, run: string, extra: object = {}): SDKMessage => ({
      type: 'system',
      subtype: 'task_started',
      uuid: randomUUID(),
      session_id: test.sessionId,
      task_id: id,
      run_id: run,
      task_type: 'local_agent',
      description: 'Child',
      ...extra
    })
    test.send(start('unresolved', '001'))
    test.send(start('child', '001', { spawn_depth: 1 }))
    await expect.poll(() => test.view.snapshot.subagents?.length).toBe(1)
    const child = confirmed(await test.runtime.open(claudeThread(test.root.thread.backendId, test.sessionId, 'child')))
    const view = await observe(child)
    test.send({
      type: 'system',
      subtype: 'task_notification',
      uuid: randomUUID(),
      session_id: test.sessionId,
      task_id: 'child',
      run_id: '001',
      status: 'completed',
      output_file: '',
      summary: 'First completed'
    })
    await expect.poll(() => view.snapshot.activity.state).toBe('idle')
    test.send(start('child', '002', { parent_task_id: 'unresolved' }))
    test.send({
      type: 'system',
      subtype: 'task_notification',
      uuid: randomUUID(),
      session_id: test.sessionId,
      task_id: 'child',
      run_id: '001',
      status: 'stopped',
      output_file: '',
      summary: 'Late stop'
    })
    await expect.poll(() => view.snapshot.activity.state).toBe('active')
    const latest = await observe(confirmed(await test.runtime.open(child.thread)))
    await expect.poll(() => latest.snapshot.activity.state).toBe('active')
    expect(latest.native.some((event) => event.type === 'system' && event.subtype === 'task_notification')).toBe(false)
    const unresolved = await observe(
      confirmed(await test.runtime.open(claudeThread(test.root.thread.backendId, test.sessionId, 'unresolved')))
    )
    await expect.poll(() => unresolved.batches.length).toBeGreaterThan(0)
    expect(unresolved.snapshot.subagents).toEqual([])
    expect(test.view.snapshot.subagents?.[0].parent).toEqual(test.root.thread)
  } finally {
    await test.close()
  }
})

it('retains permission denials for every invocation in a late observer baseline', async () => {
  const test = await wireFixture()
  try {
    const denials = [denied(test.sessionId, 'call-a'), denied(test.sessionId, 'call-b')]
    for (const denial of denials) test.send(denial)
    await test.view.event((message) => message.uuid === denials[1].uuid)
    const assistant = test.assistant('')
    assistant.message.content = [
      { type: 'tool_use', id: 'call-a', name: 'Bash', input: { command: 'pwd' } },
      { type: 'tool_use', id: 'call-b', name: 'Bash', input: { command: 'whoami' } }
    ]
    test.send(assistant)
    await expect
      .poll(() => test.view.snapshot.messages.flatMap((message) => message.parts))
      .toMatchObject([
        { type: 'dynamic-tool', toolCallId: 'call-a', state: 'output-denied', approval: { approved: false } },
        { type: 'dynamic-tool', toolCallId: 'call-b', state: 'output-denied', approval: { approved: false } }
      ])
    const late = await observe(test.root)
    await expect.poll(() => late.batches.length).toBeGreaterThan(0)
    expect(
      late.native.filter((message) => message.type === 'system' && message.subtype === 'permission_denied')
    ).toEqual(denials)
    expect(late.snapshot.messages.flatMap((message) => message.parts)).toEqual(
      test.view.snapshot.messages.flatMap((message) => message.parts)
    )
  } finally {
    await test.close()
  }
})

it('recovers a slow observer with a paired native baseline while other observers keep receiving', async () => {
  const test = await wireFixture()
  let resume!: () => void
  const gate = new Promise<void>((resolve) => {
    resume = resolve
  })
  try {
    const partial = (event: SDKPartialAssistantMessage['event']) =>
      test.send({
        type: 'stream_event',
        uuid: randomUUID(),
        session_id: test.sessionId,
        parent_tool_use_id: null,
        event
      })
    partial({ type: 'message_start', message: { ...test.assistant('').message, content: [] } })
    partial({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '', citations: [] } })
    partial({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Uncommitted' } })
    await expect.poll(() => textOf(test.view.snapshot)).toEqual(['Uncommitted'])
    const provisional = test.view.snapshot.messages[0].id
    const batches: ClaudeObservation[] = []
    confirmed(
      await test.root.claude.observe(async (batch) => {
        batches.push(batch)
        if (batches.length === 1) await gate
      })
    )
    await expect.poll(() => batches.length).toBe(1)
    const denials = [denied(test.sessionId, 'call-a'), denied(test.sessionId, 'call-b')]
    for (const denial of denials) test.send(denial)
    for (let index = 0; index < 150; index++) test.send(test.assistant(`Block ${index}`))
    await expect.poll(() => test.view.snapshot.messages.length).toBe(150)
    expect(batches).toHaveLength(1)
    resume()
    await expect
      .poll(() =>
        batches.some((batch) => batch.events.some((event) => event.type === 'gap' && event.reason === 'overflow'))
      )
      .toBe(true)
    const baseline = batches.find(
      (batch, index) => index > 0 && batch.events.some((event) => event.type === 'snapshot')
    )!
    const snapshot = baseline.events.find((event) => event.type === 'snapshot')!
    expect(baseline.native.filter((entry) => entry.message.type === 'assistant')).toHaveLength(snapshot.messages.length)
    expect(new Set(snapshot.messages.map((item) => item.id)).size).toBe(snapshot.messages.length)
    expect(batches[0].live).toEqual([])
    expect(baseline.live).toEqual(
      snapshot.messages.map((message) => message.id).filter((id) => id !== baseline.replaces?.[provisional])
    )
    expect(baseline.replaces?.[provisional]).toBe(snapshot.messages[0].id)
    expect(baseline.live).not.toContain(provisional)
    expect(
      baseline.native.flatMap(({ message }) =>
        message.type === 'system' && 'subtype' in message && message.subtype === 'permission_denied' ? [message] : []
      )
    ).toEqual(denials)
  } finally {
    resume()
    await test.close()
  }
})

it('isolates a throwing observer and leaves uncorrelated commands and ambiguous child content unattributed', async () => {
  const test = await wireFixture()
  try {
    confirmed(
      await test.root.observe(() => {
        throw new Error('Consumer failed')
      })
    )
    test.send({
      type: 'system',
      subtype: 'local_command_output',
      uuid: randomUUID(),
      session_id: test.sessionId,
      content: 'Local output'
    })
    test.send(test.assistant('Before'))
    test.send({
      type: 'system',
      subtype: 'task_started',
      uuid: randomUUID(),
      session_id: test.sessionId,
      task_id: 'known-child',
      run_id: '001',
      task_type: 'local_agent',
      description: 'Known child',
      spawn_depth: 1
    })
    await expect.poll(() => test.view.snapshot.subagents?.length).toBe(1)
    const relations = test.view.snapshot.subagents
    test.send(test.assistant('Unknown child', { parent_tool_use_id: 'unknown_parent' }))
    test.send(test.assistant('Another unknown child', { parent_tool_use_id: 'unknown_parent' }))
    test.send(test.assistant('Root still receives'))
    await expect.poll(() => textOf(test.view.snapshot)).toEqual(['Before', 'Root still receives'])
    expect(test.view.snapshot.inputs.every((input) => input.outcome === undefined)).toBe(true)
    expect(test.view.snapshot.subagents).toEqual(relations)
    expect(
      test.view.batches.some((batch) =>
        batch.events.some((event) => event.type === 'gap' && event.reason === 'mapping-reset')
      )
    ).toBe(false)
    expect(
      test.view.batches
        .slice(1)
        .flatMap((batch) => batch.events)
        .some((event) => event.type === 'snapshot')
    ).toBe(false)
    await expect
      .poll(() => test.failures.some((error) => error instanceof Error && error.message === 'Consumer failed'))
      .toBe(true)
  } finally {
    await test.close()
  }
})

// Structured output is native content too; the desktop must not need a second result-to-text path.
it('projects structured result content before the terminal activity event', async () => {
  const test = await wireFixture()
  try {
    test.send({
      type: 'result',
      subtype: 'success',
      uuid: randomUUID(),
      session_id: test.sessionId,
      structured_output: { answer: ['one', 'two'] },
      result: 'duplicate prose',
      is_error: false,
      usage: { input_tokens: 1, output_tokens: 1 },
      modelUsage: {},
      permission_denials: []
    } as unknown as SDKMessage)
    await expect.poll(() => textOf(test.view.snapshot)).toEqual([JSON.stringify({ answer: ['one', 'two'] })])
    expect(test.view.snapshot.activity.state).toBe('idle')
  } finally {
    await test.close()
  }
})

// Rich blocks must survive the public protocol; a tool result must not create a separate reply.
it('preserves rich native blocks and retracts a result without removing the tool call', async () => {
  const test = await wireFixture()
  try {
    const assistant = test.assistant('')
    const blocks = [
      { type: 'thinking', thinking: 'Reason', signature: 'native-signature' },
      {
        type: 'text',
        text: 'Before',
        citations: [
          {
            type: 'char_location',
            cited_text: 'quote',
            document_index: 0,
            document_title: 'doc',
            start_char_index: 0,
            end_char_index: 5,
            file_id: null
          }
        ]
      },
      { type: 'tool_use', id: 'rich-call', name: 'Read', input: { path: '/tmp/doc' } },
      { type: 'text', text: 'After', citations: null },
      { type: 'redacted_thinking', data: 'opaque-reasoning' }
    ] satisfies SDKAssistantMessage['message']['content']
    test.send({ ...assistant, message: { ...assistant.message, content: blocks } })
    const attachments = {
      type: 'user',
      uuid: randomUUID(),
      session_id: test.sessionId,
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AQID' } },
          { type: 'document', source: { type: 'url', url: 'https://example.org/doc.pdf' } }
        ]
      }
    } satisfies SDKUserMessage
    test.send(attachments)
    const result = randomUUID()
    test.send({
      type: 'user',
      uuid: result,
      session_id: test.sessionId,
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'rich-call', content: [{ type: 'text', text: 'Result' }] }]
      }
    })
    await expect
      .poll(() => test.view.snapshot.messages[0]?.parts[2])
      .toMatchObject({ state: 'output-available', toolCallId: 'rich-call', output: [{ type: 'text', text: 'Result' }] })
    expect(test.view.snapshot.messages).toHaveLength(2)
    const message = test.view.snapshot.messages[0]
    expect(message.id).toBe(assistant.uuid)
    expect(message.parts.map((part) => part.type)).toEqual(['reasoning', 'text', 'dynamic-tool', 'text', 'reasoning'])
    expect(message.parts[0]).toMatchObject({ providerMetadata: { anthropic: { signature: 'native-signature' } } })
    expect(message.parts[1]).toMatchObject({ providerMetadata: { anthropic: { citations: blocks[1].citations } } })
    expect(message.parts[4]).toMatchObject({
      text: '',
      providerMetadata: { anthropic: { redactedData: 'opaque-reasoning' } }
    })
    expect(test.view.snapshot.messages[1]).toMatchObject({ id: attachments.uuid, role: 'user' })
    expect(test.view.snapshot.messages[1].parts).toEqual([
      { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AQID' },
      { type: 'file', mediaType: 'application/pdf', url: 'https://example.org/doc.pdf' }
    ])
    test.send({ ...test.assistant('Retry'), supersedes: [result] })
    await expect
      .poll(() => test.view.snapshot.messages[0]?.parts[2])
      .toMatchObject({ state: 'input-available', toolCallId: 'rich-call' })
    expect(test.view.snapshot.messages[0].parts.filter((part) => part.type !== 'dynamic-tool')).toEqual(
      message.parts.filter((part) => part.type !== 'dynamic-tool')
    )
    expect(test.failures).toEqual([])
  } finally {
    await test.close()
  }
})

it('retains native-only content and advisory events in the late baseline without inventing display parts', async () => {
  const test = await wireFixture()
  try {
    const assistant = assistantMessage(test.sessionId, [
      { type: 'compaction', content: 'Native context summary', encrypted_content: 'opaque-compaction' },
      { type: 'container_upload', file_id: 'native-file' },
      { type: 'text', text: 'Visible answer', citations: null }
    ])
    const user = {
      type: 'user',
      uuid: randomUUID(),
      session_id: test.sessionId,
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [
          {
            type: 'search_result',
            source: 'native-source',
            title: 'Source',
            content: [{ type: 'text', text: 'Match' }]
          },
          { type: 'document', source: { type: 'content', content: [{ type: 'text', text: 'Embedded document' }] } }
        ]
      }
    } satisfies SDKUserMessage
    const progress = {
      type: 'tool_progress',
      tool_use_id: 'native-tool',
      tool_name: 'Bash',
      parent_tool_use_id: null,
      elapsed_time_seconds: 1,
      uuid: randomUUID(),
      session_id: test.sessionId
    } satisfies SDKMessage
    for (const message of [assistant, user, progress]) test.send(message)
    await expect
      .poll(() => test.view.batches.flatMap((batch) => batch.native))
      .toContainEqual({
        source: 'live',
        message: progress
      })
    const late: ClaudeObservation[] = []
    const subscription = confirmed(
      await test.root.claude.observe((batch) => {
        late.push(batch)
      })
    )
    await expect.poll(() => late.length).toBe(1)
    expect(late[0].native).toEqual(
      expect.arrayContaining([assistant, user, progress].map((message) => ({ source: 'live', message })))
    )
    expect(test.view.snapshot.messages).toHaveLength(1)
    expect(test.view.snapshot.messages[0].parts).toEqual([{ type: 'text', text: 'Visible answer', state: 'done' }])
    await subscription.stop()
    expect(test.failures).toEqual([])
  } finally {
    await test.close()
  }
})

it('retains validated rejection identity for a late subscriber and overflow recovery', async () => {
  const feed = new ClaudeFeed((error) => {
    throw error
  })
  const source = assistantMessage(randomUUID(), [{ type: 'text', text: 'Refused request', citations: null }], {
    error: 'rate_limit'
  })
  feed.publish([], [{ source: 'live', message: source }])
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const batches: ClaudeObservation[] = []
  const observation = feed.observe(async (batch) => {
    batches.push(batch)
    if (batches.length === 1) await blocked
  })
  await Promise.resolve()
  for (let index = 0; index < 110; index++)
    feed.publish(
      [],
      [
        {
          source: 'live',
          message: assistantMessage(source.session_id, [{ type: 'text', text: `ordinary ${index}`, citations: null }])
        }
      ]
    )
  release()
  await observation.drain()
  expect(batches[0].native.find((entry) => entry.message.uuid === source.uuid)?.isApiErrorMessage).toBe(true)
  const gap = batches.findIndex((batch) => batch.events.some((event) => event.type === 'gap'))
  expect(gap).toBeGreaterThan(0)
  const recovery = batches.slice(gap + 1).find((batch) => batch.events.some((event) => event.type === 'snapshot'))
  expect(recovery?.native.find((entry) => entry.message.uuid === source.uuid)?.isApiErrorMessage).toBe(true)
  const late: ClaudeObservation[] = []
  const lateObservation = feed.observe((batch) => {
    late.push(batch)
  })
  await lateObservation.drain()
  expect(late[0].native.find((entry) => entry.message.uuid === source.uuid)?.isApiErrorMessage).toBe(true)
  await lateObservation.stop()
  await observation.stop()
})

it('retains root state with compacted context in the boundary publication', async () => {
  const test = await wireFixture({ model: 'test', contextWindow: { model: 'test', tokens: 100000 } })
  try {
    const nativeInput = test.view.snapshot.inputs[0].nativeInput!.id
    test.send({
      type: 'result',
      subtype: 'success',
      uuid: randomUUID(),
      session_id: test.sessionId,
      user_message_uuid: nativeInput,
      result: '',
      is_error: false,
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
      modelUsage: {},
      permission_denials: []
    } as unknown as SDKMessage)
    await expect.poll(() => test.view.snapshot.inputs[0].outcome).toBe('completed')
    const history = test.assistant('History')
    test.send(history)
    test.send({
      type: 'system',
      subtype: 'task_started',
      uuid: randomUUID(),
      session_id: test.sessionId,
      task_id: 'child',
      run_id: '001',
      task_type: 'local_agent',
      description: 'Child',
      spawn_depth: 1
    })
    test.send({
      type: 'stream_event',
      uuid: randomUUID(),
      session_id: test.sessionId,
      parent_tool_use_id: null,
      event: { type: 'message_start', message: { ...test.assistant('').message, content: [] } }
    })
    await expect.poll(() => test.view.snapshot.contextUsage?.status).toBe('confirmed')
    const before = test.view.snapshot
    expect(before.inputs.length).toBeGreaterThan(0)
    expect(before.subagents).toHaveLength(1)
    const boundary = {
      type: 'system',
      subtype: 'compact_boundary',
      uuid: randomUUID(),
      session_id: test.sessionId,
      compact_metadata: { trigger: 'manual', pre_tokens: 1 }
    } as SDKMessage
    test.send(boundary)
    await test.view.event((message) => 'uuid' in message && message.uuid === boundary.uuid)
    const batch = test.view.batches.find((entry) =>
      entry.native.some(({ message }) => 'uuid' in message && message.uuid === boundary.uuid)
    )!
    expect(batch.events.map((event) => event.type).slice(-3)).toEqual(['context.changed', 'gap', 'snapshot'])
    expect(batch.events.at(-1)).toMatchObject({
      type: 'snapshot',
      messages: before.messages,
      inputs: before.inputs,
      subagents: before.subagents,
      activity: before.activity,
      contextUsage: { status: 'unknown', error: { code: 'compacted' } }
    })
    expect(test.view.snapshot.contextUsage).toMatchObject({ status: 'unknown', error: { code: 'compacted' } })
  } finally {
    await test.close()
  }
})
