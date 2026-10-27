import { randomUUID } from 'node:crypto'

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'

import { claudeThread, type ClaudeObservation } from '../src'
import { confirmed, observe, textOf } from './nativeFixture'
import { wireFixture } from './wireFixture'

it('delivers queued final content before close without waiting for a detached or slow consumer', async () => {
  const test = await wireFixture()
  let resume!: () => void
  const gate = new Promise<void>((resolve) => {
    resume = resolve
  })
  try {
    const events: ClaudeObservation[] = []
    confirmed(
      await test.root.claude.observe(async (batch) => {
        events.push(batch)
        if (events.length === 1) await gate
      })
    )
    await expect.poll(() => events.length).toBe(1)
    test.send(test.assistant('Last content'))
    await expect.poll(() => textOf(test.view.snapshot)).toContain('Last content')
    confirmed(await test.runtime.shutdown())
    expect(events).toHaveLength(1)
    resume()
    await expect.poll(() => events.at(-1)?.events.at(-1)?.type).toBe('closed')
    expect(
      events
        .slice(0, -1)
        .flatMap((batch) => batch.events)
        .some(
          (event) =>
            event.type === 'item.upsert' &&
            event.item.type === 'message' &&
            event.item.parts.some((part) => part.text === 'Last content')
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
    const partial = (event: object) =>
      test.send({
        type: 'stream_event',
        uuid: randomUUID(),
        session_id: test.sessionId,
        parent_tool_use_id: null,
        event
      } as SDKMessage)
    partial({ type: 'message_start', message: { ...assistant.message, content: [] } })
    partial({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'call', name: 'Bash', input: {} }
    })
    partial({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":' } })
    partial({ type: 'message_stop' })
    await expect
      .poll(() => test.view.snapshot.items[0])
      .toMatchObject({ type: 'tool-call', argumentsText: '{"command":', completeness: 'partial' })
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
    await expect.poll(() => test.view.snapshot.items).toHaveLength(1)
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

it('recovers a slow observer with a paired native baseline while other observers keep receiving', async () => {
  const test = await wireFixture()
  let resume!: () => void
  const gate = new Promise<void>((resolve) => {
    resume = resolve
  })
  try {
    const batches: ClaudeObservation[] = []
    confirmed(
      await test.root.claude.observe(async (batch) => {
        batches.push(batch)
        if (batches.length === 1) await gate
      })
    )
    await expect.poll(() => batches.length).toBe(1)
    for (let index = 0; index < 150; index++) test.send(test.assistant(`Block ${index}`))
    await expect.poll(() => test.view.snapshot.items.length).toBe(150)
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
    expect(baseline.native.filter((entry) => entry.message.type === 'assistant')).toHaveLength(snapshot.items.length)
    expect(new Set(snapshot.items.map((item) => item.ref.id)).size).toBe(snapshot.items.length)
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
    test.send(test.assistant('Unknown child', { parent_tool_use_id: 'unknown_parent' }))
    test.send(test.assistant('Root still receives'))
    await expect.poll(() => textOf(test.view.snapshot)).toEqual(['Root still receives'])
    expect(test.view.snapshot.inputs.every((input) => input.outcome === undefined)).toBe(true)
    expect(
      test.view.batches.some((batch) =>
        batch.events.some((event) => event.type === 'gap' && event.reason === 'mapping-reset')
      )
    ).toBe(true)
    await expect
      .poll(() => test.failures.some((error) => error instanceof Error && error.message === 'Consumer failed'))
      .toBe(true)
  } finally {
    await test.close()
  }
})
