import { randomUUID } from 'node:crypto'

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'

import { confirmed } from '../../../../../packages/agent-runtime-claude-code/tests/nativeFixture'
import { assistantMessage, wireFixture } from '../../../../../packages/agent-runtime-claude-code/tests/wireFixture'
import { ThreadMessageProjection } from '../ThreadMessageProjection'

it('keeps projecting root continuations after repeated unmapped child frames', async () => {
  const test = await wireFixture()
  const projection = new ThreadMessageProjection(test.root.thread)
  const subscription = confirmed(
    await test.root.claude.observe((batch) => projection.accept(batch.events).then(() => {}))
  )
  try {
    const first = assistantMessage(test.sessionId, [
      { type: 'text', text: 'Before', citations: null },
      { type: 'tool_use', id: 'parent-tool', name: 'Agent', input: {} }
    ])
    const next = test.assistant('Main continues')
    const last = test.assistant('Main finishes')
    test.send(first)
    test.send(test.assistant('Child hidden', { parent_tool_use_id: 'unknown' }))
    test.send(test.assistant('Child hidden again', { parent_tool_use_id: 'unknown' }))
    test.send(next)
    test.send(last)
    test.send(first)
    await test.view.event((message) => 'uuid' in message && message.uuid === last.uuid)
    await subscription.drain()
    const state = projection.snapshot()
    expect(state.messages.map((message) => message.id)).toEqual([first.uuid, next.uuid, last.uuid])
    expect(JSON.stringify(state.messages)).not.toContain('Child hidden')
    expect(
      state.messages
        .flatMap((message) => message.parts)
        .filter((part) => part.type === 'dynamic-tool' && part.toolCallId === 'parent-tool')
    ).toHaveLength(1)
    expect(state.gap).toBeUndefined()
  } finally {
    await subscription.stop()
    await projection.close()
    await test.close()
  }
})

it('restores the current root baseline and compacted context in the compaction batch', async () => {
  const test = await wireFixture({ model: 'test', contextWindow: { model: 'test', tokens: 100000 } })
  const projection = new ThreadMessageProjection(test.root.thread)
  const batches: Parameters<Parameters<typeof test.root.claude.observe>[0]>[0][] = []
  const subscription = confirmed(
    await test.root.claude.observe(async (batch) => {
      batches.push(batch)
      await projection.accept(batch.events)
    })
  )
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
    const continuation = test.assistant('After compaction')
    test.send(continuation)
    await test.view.event((message) => 'uuid' in message && message.uuid === continuation.uuid)
    await subscription.drain()
    const batch = batches.find((entry) =>
      entry.native.some(({ message }) => 'uuid' in message && message.uuid === boundary.uuid)
    )!
    expect(batch.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['context.changed', 'gap', 'snapshot'])
    )
    expect(batch.events.map((event) => event.type).slice(-3)).toEqual(['context.changed', 'gap', 'snapshot'])
    const baseline = batch.events.find((event) => event.type === 'snapshot')!
    expect(baseline).toMatchObject({
      messages: expect.arrayContaining([expect.objectContaining({ id: history.uuid })]),
      inputs: before.inputs,
      subagents: before.subagents,
      activity: before.activity,
      contextUsage: { status: 'unknown', error: { code: 'compacted' } }
    })
    expect(projection.snapshot().messages.map((message) => message.id)).toEqual([history.uuid, continuation.uuid])
    expect(test.view.snapshot.contextUsage).toMatchObject({ status: 'unknown', error: { code: 'compacted' } })
    expect(projection.snapshot().gap).toBeUndefined()
  } finally {
    await subscription.stop()
    await projection.close()
    await test.close()
  }
})
