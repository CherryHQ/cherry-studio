import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'

import { startup } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'

import { runtimeId } from '@cherrystudio/agent-runtime'

import { claudeThread } from '../src'
import { confirmed, fixture, inputId, observe, spawnChild, textOf } from './nativeFixture'

it('claims one prewarmed native process for commands, input and confirmed shutdown', async () => {
  const test = await fixture()
  const sessionId = randomUUID()
  const warm = await startup({
    options: {
      ...test.options,
      sessionId,
      includePartialMessages: true,
      forwardSubagentText: true,
      env: { ...test.options.env, CLAUDE_CONFIG_DIR: test.configDir }
    }
  })
  try {
    const child = test.children[0]
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    const runtime = test.runtime()
    const root = confirmed(await runtime.create({ ...test.options, sessionId }))
    const view = await observe(root)
    confirmed(root.claude.start({ query: warm, exited }))
    const commands = confirmed(await root.claude.supportedCommands())
    expect(commands.some((command) => command.name === 'compact')).toBe(true)
    expect(root.thread.id).toBe(sessionId)
    const id = inputId()
    await root.input!.submit({ inputId: id, text: 'Use the warm process', whenBusy: 'steer' })
    const request = await test.request()
    request.reply.block({ type: 'text', text: 'Warm answer' })
    request.reply.finish()
    await expect.poll(() => view.snapshot.inputs.find((input) => input.inputId === id)?.outcome).toBe('completed')
    expect(textOf(view.snapshot)).toContain('Warm answer')
    expect(test.children).toHaveLength(1)
    confirmed(await runtime.shutdown())
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
  } finally {
    warm.close()
    await test.close()
  }
}, 30000)

it('reconciles an archive read overlapping live output without losing the committed tail or its aliases', async () => {
  const test = await fixture()
  try {
    const root = confirmed(await test.runtime().create(test.options))
    const view = await observe(root)
    const id = inputId()
    await root.input!.submit({ inputId: id, text: 'Archive while streaming', whenBusy: 'steer' })
    const request = await test.request()
    request.reply.block({ type: 'text', text: 'Before archive' })
    await expect.poll(() => textOf(view.snapshot)).toContain('Before archive')
    const reading = root.claude.archive()
    request.reply.block({ type: 'text', text: 'Concurrent tail' })
    request.reply.finish()
    confirmed(await reading)
    await expect.poll(() => view.snapshot.inputs.find((input) => input.inputId === id)?.outcome).toBe('completed')
    expect(textOf(view.snapshot).filter((text) => text === 'Before archive' || text === 'Concurrent tail')).toEqual([
      'Before archive',
      'Concurrent tail'
    ])
    expect(view.snapshot.items.some((item) => item.ref.id.startsWith('live:'))).toBe(false)
    const final = confirmed(await root.claude.archive())
    expect(final.sources.filter((source) => source.ref.id.startsWith('live:'))).toEqual([])
    expect(final.items.filter((item) => item.type === 'message' && item.role === 'assistant')).toHaveLength(2)
    await expect
      .poll(() => view.snapshot.items.map((item) => item.ref.id))
      .toEqual(final.items.map((item) => item.ref.id))
    expect(view.snapshot.items[0]).toMatchObject({ type: 'message', role: 'user' })
  } finally {
    await test.close()
  }
}, 30000)

it('places steer at a native tool boundary and associates one answer with both immutable inputs', async () => {
  const test = await fixture()
  try {
    const root = confirmed(await test.runtime().create(test.options))
    const view = await observe(root)
    const first = inputId()
    await root.input!.submit({ inputId: first, text: 'Run a child', whenBusy: 'steer' })
    const request = await test.request()
    request.reply.block(spawnChild('toolu_steer'))
    request.reply.finish('tool_use')
    const child = await test.request()
    const second = inputId()
    await root.input!.submit({ inputId: second, text: 'Use the revised requirement', whenBusy: 'steer' })
    await view.event(
      (event) => (event as { type: string }).type === 'command_lifecycle' && JSON.stringify(event).includes(second)
    )
    child.reply.block({ type: 'text', text: 'Child answer' })
    child.reply.finish()
    const reply = await test.request()
    expect(JSON.stringify(reply.body.messages)).toContain('Use the revised requirement')
    reply.reply.block({ type: 'text', text: 'Shared answer' })
    reply.reply.finish()
    await expect.poll(() => view.snapshot.inputs.find((input) => input.inputId === second)?.outcome).toBe('completed')
    const inputs = view.snapshot.inputs.filter((input) => input.inputId === first || input.inputId === second)
    expect(inputs.map((input) => input.outcome)).toEqual(['completed', 'completed'])
    expect(inputs[0].response).toEqual(inputs[1].response)
    expect(inputs[0].response).toBeDefined()
    expect(await root.input!.submit({ inputId: second, text: 'Changed payload', whenBusy: 'steer' })).toMatchObject({
      status: 'rejected',
      error: { code: 'duplicate-input' }
    })
  } finally {
    await test.close()
  }
}, 30000)

it('keeps end-boundary steer as the next turn instead of rejecting it', async () => {
  const test = await fixture()
  try {
    const root = confirmed(await test.runtime().create(test.options))
    const view = await observe(root)
    const firstId = inputId()
    await root.input!.submit({ inputId: firstId, text: 'First', whenBusy: 'steer' })
    const first = await test.request()
    first.reply.block({ type: 'text', text: 'First answer' })
    await view.event((event) => event.type === 'assistant' && event.user_message_uuid === firstId)
    const nextId = inputId()
    await root.input!.submit({ inputId: nextId, text: 'Next requirement', whenBusy: 'steer' })
    first.reply.finish()
    const next = await test.request()
    expect(JSON.stringify(next.body.messages)).toContain('Next requirement')
    next.reply.block({ type: 'text', text: 'Next answer' })
    next.reply.finish()
    await expect.poll(() => view.snapshot.inputs.find((input) => input.inputId === nextId)?.outcome).toBe('completed')
    expect(view.snapshot.inputs.find((input) => input.inputId === firstId)?.response).not.toEqual(
      view.snapshot.inputs.find((input) => input.inputId === nextId)?.response
    )
  } finally {
    await test.close()
  }
}, 30000)

it('stops only the addressed sibling and keeps the other child observable', async () => {
  const test = await fixture()
  try {
    const runtime = test.runtime()
    const root = confirmed(await runtime.create(test.options))
    const view = await observe(root)
    await root.input!.submit({ inputId: inputId(), text: 'Run siblings', whenBusy: 'steer' })
    const request = await test.request()
    request.reply.block(spawnChild('toolu_left', true))
    request.reply.block(spawnChild('toolu_right', true))
    request.reply.finish('tool_use')
    const requests = [await test.request(), await test.request(), await test.request()]
    const parent = requests.find((value) => JSON.stringify(value.body.messages).includes('tool_result'))!
    const leftRequest = requests.find(
      (value) => value !== parent && JSON.stringify(value.body.messages).includes('Child toolu_left')
    )!
    const rightRequest = requests.find((value) => value !== parent && value !== leftRequest)!
    parent.reply.block({ type: 'text', text: 'Parent remains usable' })
    parent.reply.finish()
    const task = await view.event(
      (event) => event.type === 'system' && event.subtype === 'task_started' && event.tool_use_id === 'toolu_left'
    )
    if (task.type !== 'system' || task.subtype !== 'task_started') throw new Error('Missing child task')
    expect(await root.claude.stopTask('unknown')).toMatchObject({ status: 'rejected', error: { code: 'unknown-task' } })
    expect(await root.claude.stopTask(task.task_id)).toMatchObject({
      status: 'confirmed',
      value: { effect: 'requested' }
    })
    await leftRequest.reply.closed
    rightRequest.reply.block({ type: 'text', text: 'Sibling survived' })
    rightRequest.reply.finish()
    const rightTask = await view.event(
      (event) => event.type === 'system' && event.subtype === 'task_started' && event.tool_use_id === 'toolu_right'
    )
    if (rightTask.type !== 'system' || rightTask.subtype !== 'task_started') throw new Error('Missing right task')
    const right = confirmed(
      await runtime.open(claudeThread(root.thread.backendId, root.claude.sessionId, rightTask.task_id))
    )
    const rightView = await observe(right)
    await expect.poll(() => textOf(rightView.snapshot)).toContain('Sibling survived')
    await view.event(
      (event) =>
        event.type === 'system' &&
        event.subtype === 'task_notification' &&
        event.task_id === task.task_id &&
        event.status === 'stopped'
    )
    expect(rightView.snapshot.activity.state).not.toBe('unknown')
  } finally {
    await test.close()
  }
}, 30000)

it('keeps nested relationships on the immediate parent across archive reopen', async () => {
  const test = await fixture({
    agents: {
      probe: { description: 'Nested child', prompt: 'Run the requested child', tools: ['Agent'], model: 'inherit' }
    }
  })
  try {
    const runtime = test.runtime()
    const root = confirmed(await runtime.create(test.options))
    const view = await observe(root)
    await root.input!.submit({ inputId: inputId(), text: 'Nested children', whenBusy: 'steer' })
    const request = await test.request()
    request.reply.block(spawnChild('toolu_child'))
    request.reply.finish('tool_use')
    const childRequest = await test.request()
    childRequest.reply.block(spawnChild('toolu_grandchild'))
    childRequest.reply.finish('tool_use')
    const grandchildRequest = await test.request()
    grandchildRequest.reply.block({ type: 'text', text: 'Grandchild answer' })
    grandchildRequest.reply.finish()
    const childReply = await test.request()
    childReply.reply.block({ type: 'text', text: 'Child answer' })
    childReply.reply.finish()
    const rootReply = await test.request()
    rootReply.reply.block({ type: 'text', text: 'Root answer' })
    rootReply.reply.finish()
    await view.event((event) => event.type === 'result')
    expect(view.snapshot.subagents).toHaveLength(1)
    const childThread = view.snapshot.subagents![0].child!
    const child = confirmed(await runtime.open(childThread))
    const childView = await observe(child)
    await expect.poll(() => childView.snapshot.subagents?.length).toBe(1)
    const grandchildThread = childView.snapshot.subagents![0].child!
    expect(childView.snapshot.subagents![0].parent).toEqual(childThread)
    const grandchildView = await observe(confirmed(await runtime.open(grandchildThread)))
    await expect.poll(() => textOf(grandchildView.snapshot)).toContain('Grandchild answer')
    expect(textOf(grandchildView.snapshot)).not.toContain('Root answer')
    confirmed(await runtime.shutdown())
    const reopened = test.runtime()
    const restored = await observe(confirmed(await reopened.open(childThread)))
    await expect.poll(() => restored.snapshot.subagents?.[0]?.child).toEqual(grandchildThread)
  } finally {
    await test.close()
  }
}, 30000)

it.each([false, true])(
  'continues the same child with a new native run (cold=%s)',
  async (cold) => {
    const test = await fixture()
    try {
      let runtime = test.runtime()
      let root = confirmed(await runtime.create(test.options))
      let view = await observe(root)
      await root.input!.submit({ inputId: inputId(), text: 'Start child', whenBusy: 'steer' })
      const request = await test.request()
      request.reply.block(spawnChild('toolu_original'))
      request.reply.finish('tool_use')
      const childRequest = await test.request()
      childRequest.reply.block({ type: 'text', text: 'Original child answer' })
      childRequest.reply.finish()
      const parent = await test.request()
      parent.reply.block({ type: 'text', text: 'Original parent answer' })
      parent.reply.finish()
      await view.event((event) => event.type === 'result')
      const task = await view.event((event) => event.type === 'system' && event.subtype === 'task_started')
      if (task.type !== 'system' || task.subtype !== 'task_started') throw new Error('Missing original task')
      const childThread = view.snapshot.subagents![0].child!
      if (cold) {
        confirmed(await runtime.shutdown())
        runtime = test.runtime()
        root = confirmed(await runtime.open(root.thread))
        view = await observe(root)
      }
      const child = confirmed(await runtime.open(childThread))
      const childView = await observe(child)
      await root.input!.submit({ inputId: inputId(), text: 'Continue the child', whenBusy: 'steer' })
      const followup = await test.request()
      followup.reply.block({
        type: 'tool_use',
        id: 'toolu_continue',
        name: 'SendMessage',
        input: { to: task.task_id, message: 'Continue with the old context', summary: 'Continue child' }
      })
      followup.reply.finish('tool_use')
      const requests = [await test.request(), await test.request()]
      const resumed = requests.find((value) => JSON.stringify(value.body.messages).includes('Original child answer'))!
      const parentReply = requests.find((value) => value !== resumed)!
      expect(JSON.stringify(resumed.body.messages)).toContain('Continue with the old context')
      parentReply.reply.block({ type: 'text', text: 'Parent continues independently' })
      parentReply.reply.finish()
      resumed.reply.block({ type: 'text', text: 'Continued child answer' })
      resumed.reply.finish()
      await expect.poll(() => textOf(childView.snapshot)).toContain('Continued child answer')
      const next = await view.event(
        (event) =>
          event.type === 'system' &&
          event.subtype === 'task_started' &&
          event.task_id === task.task_id &&
          event.run_id !== task.run_id
      )
      if (next.type !== 'system' || next.subtype !== 'task_started') throw new Error('Missing new run')
      expect(next.run_id! > task.run_id!).toBe(true)
      expect(child.thread).toEqual(childThread)
      expect(textOf(childView.snapshot)).toContain('Original child answer')
      expect(
        confirmed(await child.claude.archive()).messages.filter((message) => message.type === 'assistant')
      ).toHaveLength(2)
    } finally {
      await test.close()
    }
  },
  30000
)

it('retains product observation through compaction while the native archive selects the continuation view', async () => {
  const test = await fixture()
  try {
    const root = confirmed(await test.runtime().create(test.options))
    const view = await observe(root)
    await root.input!.submit({ inputId: inputId(), text: 'Original context. '.repeat(500), whenBusy: 'steer' })
    const request = await test.request()
    request.reply.block({ type: 'text', text: 'Original decision' })
    request.reply.finish()
    await view.event((event) => event.type === 'result')
    await root.input!.submit({ inputId: inputId(), text: '/compact Retain decision', whenBusy: 'follow-up' })
    const compact = await test.request()
    compact.reply.block({ type: 'text', text: '<summary>Retained decision.</summary>' })
    compact.reply.finish()
    await view.event((event) => event.type === 'system' && event.subtype === 'compact_boundary')
    const archive = confirmed(await root.claude.archive())
    expect(JSON.stringify(archive.messages)).toContain('Retained decision.')
    expect(textOf(view.snapshot)).toContain('Original decision')
    expect(archive.retracted).toEqual([])
  } finally {
    await test.close()
  }
}, 30000)

it('does not retry input after process loss or claim its successful completion', async () => {
  const test = await fixture()
  try {
    const runtime = test.runtime()
    const root = confirmed(await runtime.create(test.options))
    const view = await observe(root)
    const id = inputId()
    await root.input!.submit({ inputId: id, text: 'Uncertain turn', whenBusy: 'steer' })
    const request = await test.request()
    request.reply.startText('Partial before loss')
    await expect.poll(() => textOf(view.snapshot)).toContain('Partial before loss')
    test.children[0].kill('SIGTERM')
    await expect
      .poll(() =>
        view.batches.some((batch) =>
          batch.events.some((event) => event.type === 'closed' && event.reason === 'source-lost')
        )
      )
      .toBe(true)
    const input = view.snapshot.inputs.find((value) => value.inputId === id)
    expect(input?.outcome).toBeUndefined()
    expect(input?.error?.code).toBe('delivery-unknown')
    expect(await root.input!.submit({ inputId: id, text: 'Uncertain turn', whenBusy: 'steer' })).toMatchObject({
      status: 'rejected',
      error: { code: 'closed' }
    })
    expect(test.children).toHaveLength(1)
  } finally {
    await test.close()
  }
}, 30000)

it('shares a lazy Query, binds streamed blocks once, and retains archives after release and shutdown', async () => {
  const test = await fixture()
  try {
    const runtime = test.runtime()
    const first = confirmed(await runtime.create(test.options))
    const second = confirmed(await runtime.open(first.thread))
    const view = await observe(first)
    const other = await observe(second)
    expect(test.children).toHaveLength(0)
    const id = inputId()
    expect(await first.input!.submit({ inputId: id, text: 'Say two blocks', whenBusy: 'steer' })).toMatchObject({
      status: 'acknowledged',
      facts: ['dispatch-started']
    })
    const model = await test.request()
    model.reply.block({ type: 'text', text: 'First block' })
    model.reply.block({ type: 'text', text: 'Second block' })
    model.reply.finish()
    await view.event((message) => message.type === 'result')
    await expect.poll(() => view.snapshot.inputs.find((input) => input.inputId === id)?.outcome).toBe('completed')
    expect(textOf(view.snapshot).filter((text) => text === 'First block' || text === 'Second block')).toEqual([
      'First block',
      'Second block'
    ])
    expect(view.snapshot.items.some((item) => item.ref.id.startsWith('live:'))).toBe(false)
    expect(view.snapshot).toEqual(other.snapshot)
    expect(test.children).toHaveLength(1)
    await first.release()
    const nextId = inputId()
    await second.input!.submit({ inputId: nextId, text: 'Continue', whenBusy: 'follow-up' })
    const next = await test.request()
    next.reply.block({ type: 'text', text: 'Continued' })
    next.reply.finish()
    await other.event((message) => message.type === 'result' && message.user_message_uuid === nextId)
    expect(textOf(view.snapshot)).not.toContain('Continued')
    expect(await runtime.shutdown()).toMatchObject({ status: 'confirmed' })
    expect(test.children[0].exitCode !== null || test.children[0].signalCode !== null).toBe(true)
    const archive = confirmed(await second.claude.archive())
    expect(
      archive.items.some((item) => item.type === 'message' && item.parts.some((part) => part.text === 'Continued'))
    ).toBe(true)
    expect(await first.claude.archive()).toMatchObject({ status: 'rejected', error: { code: 'released' } })
  } finally {
    await test.close()
  }
}, 30000)

it('observes a background child after its parent result without adding child bodies to the root', async () => {
  const test = await fixture()
  try {
    const runtime = test.runtime()
    const root = confirmed(await runtime.create(test.options))
    const parent = await observe(root)
    await root.input!.submit({ inputId: inputId(), text: 'Start background child', whenBusy: 'steer' })
    const request = await test.request()
    request.reply.block(spawnChild('toolu_background', true))
    request.reply.finish('tool_use')
    const a = await test.request()
    const b = await test.request()
    const isParent = (value: typeof a) => JSON.stringify(value.body.messages).includes('tool_result')
    const parentRequest = isParent(a) ? a : b
    const childRequest = isParent(a) ? b : a
    parentRequest.reply.block({ type: 'text', text: 'Parent finished' })
    parentRequest.reply.finish()
    await parent.event((message) => message.type === 'result')
    await expect.poll(() => parent.snapshot.subagents?.length).toBe(1)
    const childThread = parent.snapshot.subagents![0].child!
    const child = confirmed(await runtime.open(childThread))
    expect(child.input).toBeUndefined()
    const childView = await observe(child)
    await root.release()
    childRequest.reply.block({ type: 'text', text: 'Child block one' })
    childRequest.reply.block({ type: 'text', text: 'Child block two' })
    childRequest.reply.finish()
    await expect.poll(() => textOf(childView.snapshot)).toEqual(['Child block one', 'Child block two'])
    expect(textOf(parent.snapshot)).not.toContain('Child block one')
    const archive = confirmed(await child.claude.archive())
    const assistant = archive.messages.filter((message) => message.type === 'assistant')
    expect(assistant).toHaveLength(2)
    expect(new Set(assistant.map((message) => message.uuid)).size).toBe(2)
    expect(
      archive.items.filter((item) => item.type === 'message' && item.role === 'assistant').map((item) => item.ref.id)
    ).toEqual(
      childView.snapshot.items
        .filter((item) => item.type === 'message' && item.role === 'assistant')
        .map((item) => item.ref.id)
    )
  } finally {
    await test.close()
  }
}, 30000)

it('preserves interrupted partial output and later queued input, without claiming busy rejection', async () => {
  const test = await fixture()
  try {
    const runtime = test.runtime()
    const root = confirmed(await runtime.create(test.options))
    const view = await observe(root)
    expect(root.input!.policies).toEqual(['steer', 'follow-up'])
    expect(await root.input!.submit({ inputId: inputId(), text: 'Reject', whenBusy: 'reject' })).toMatchObject({
      status: 'unsupported'
    })
    const firstId = inputId()
    await root.input!.submit({ inputId: firstId, text: 'Long answer', whenBusy: 'steer' })
    const first = await test.request()
    first.reply.startText('Unfinished')
    await expect.poll(() => textOf(view.snapshot)).toContain('Unfinished')
    const laterId = inputId()
    await root.input!.submit({ inputId: laterId, text: 'Answer later', whenBusy: 'follow-up' })
    await view.event(
      (event) => (event as { type: string }).type === 'command_lifecycle' && JSON.stringify(event).includes(laterId)
    )
    expect(await root.interrupt!()).toMatchObject({ status: 'confirmed', value: { effect: 'requested' } })
    const later = await test.request()
    later.reply.block({ type: 'text', text: 'Later answer' })
    later.reply.finish()
    await expect.poll(() => view.snapshot.inputs.find((input) => input.inputId === laterId)?.outcome).toBe('completed')
    expect(view.snapshot.inputs.find((input) => input.inputId === firstId)?.outcome).toBe('aborted')
    expect(view.snapshot.inputs.find((input) => input.inputId === laterId)?.facts).toEqual(
      expect.arrayContaining(['accepted', 'queued', 'placed'])
    )
    expect(
      view.snapshot.items.find(
        (item) => item.type === 'message' && item.parts.some((part) => part.text === 'Unfinished')
      )
    ).toMatchObject({ completeness: 'partial' })
    confirmed(await runtime.shutdown())
    const reopened = confirmed(await test.runtime().open(root.thread))
    const archive = confirmed(await reopened.claude.archive())
    expect(
      archive.items.find((item) => item.type === 'message' && item.parts.some((part) => part.text === 'Unfinished'))
    ).toMatchObject({ completeness: 'partial' })
  } finally {
    await test.close()
  }
}, 30000)

it('reopens native history without starting work and rejects missing storage or another backend', async () => {
  const test = await fixture()
  try {
    const runtime = test.runtime()
    const root = confirmed(await runtime.create(test.options))
    const view = await observe(root)
    await root.input!.submit({ inputId: inputId(), text: 'Save a message', whenBusy: 'steer' })
    const request = await test.request()
    request.reply.block({ type: 'text', text: 'Saved answer' })
    request.reply.finish()
    await view.event((message) => message.type === 'result')
    confirmed(await runtime.shutdown())
    const reopen = test.runtime()
    const [one, two] = await Promise.all([reopen.open(root.thread), reopen.open(root.thread)])
    const restored = await observe(confirmed(one))
    confirmed(two)
    await expect.poll(() => textOf(restored.snapshot)).toContain('Saved answer')
    expect(test.children).toHaveLength(1)
    expect(await reopen.open({ ...root.thread, backendId: runtimeId<'backend'>('other') })).toMatchObject({
      status: 'rejected',
      error: { code: 'backend-mismatch' }
    })
    await rm(test.configDir, { recursive: true })
    expect(await test.runtime().open(root.thread)).toMatchObject({ status: 'rejected' })
    expect(test.children).toHaveLength(1)
  } finally {
    await test.close()
  }
}, 30000)

it('closes stale admission on clear and binds the new native session to the same Query', async () => {
  const test = await fixture()
  try {
    const runtime = test.runtime()
    const root = confirmed(await runtime.create(test.options))
    const view = await observe(root)
    const firstId = inputId()
    await root.input!.submit({ inputId: firstId, text: 'Before clear', whenBusy: 'steer' })
    const request = await test.request()
    request.reply.block({ type: 'text', text: 'Old answer' })
    request.reply.finish()
    await view.event((event) => event.type === 'result')
    const clearId = inputId()
    await root.input!.submit({ inputId: clearId, text: '/clear', whenBusy: 'follow-up' })
    const reset = await view.event((event) => event.type === 'conversation_reset')
    const result = await view.event((event) => event.type === 'result' && event.user_message_uuid === clearId)
    if (result.type !== 'result' || reset.type !== 'conversation_reset') throw new Error('Missing clear result')
    expect(result.session_id).not.toBe(reset.new_conversation_id)
    expect(await root.input!.submit({ inputId: inputId(), text: 'Stale', whenBusy: 'steer' })).toMatchObject({
      status: 'rejected',
      error: { code: 'closed' }
    })
    const next = confirmed(await runtime.open(claudeThread(root.thread.backendId, result.session_id)))
    await next.input!.submit({ inputId: inputId(), text: 'After clear', whenBusy: 'steer' })
    const fresh = await test.request()
    expect(JSON.stringify(fresh.body.messages)).not.toContain('Before clear')
    fresh.reply.block({ type: 'text', text: 'New answer' })
    fresh.reply.finish()
    expect(test.children).toHaveLength(1)
    await expect.poll(() => view.snapshot.inputs.find((input) => input.inputId === clearId)?.outcome).toBe('completed')
    expect(view.snapshot.inputs.find((input) => input.inputId === clearId)?.facts).toContain('locally-handled')
    expect(textOf(view.snapshot)).toContain('Old answer')
  } finally {
    await test.close()
  }
}, 30000)
