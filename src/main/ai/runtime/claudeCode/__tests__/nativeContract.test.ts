import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import {
  type HookInput,
  type Options,
  query,
  type SDKMessage,
  type SDKUserMessage,
  type SessionMessage
} from '@anthropic-ai/claude-agent-sdk'
import { startTestHttpServer } from '@test-helpers/http/server'
import { expect, it } from 'vitest'

import { AsyncEventQueue } from '@shared/utils/async/AsyncEventQueue'

const run = promisify(execFile)
const timeoutMs = 10_000

type ReplyBlock = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: object }

function modelReply(res: ServerResponse, id: string, model: string) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'close' })
  const closed = new Promise<void>((resolve) => res.once('close', resolve))
  const send = (type: string, value: object) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`)
  send('message_start', {
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 0 }
    }
  })
  let index = 0
  return {
    id,
    closed,
    startText(text: string) {
      send('content_block_start', { index, content_block: { type: 'text', text: '' } })
      send('content_block_delta', { index, delta: { type: 'text_delta', text } })
    },
    block(block: ReplyBlock) {
      if (block.type === 'text') {
        send('content_block_start', { index, content_block: { type: 'text', text: '' } })
        send('content_block_delta', { index, delta: { type: 'text_delta', text: block.text } })
      } else {
        send('content_block_start', { index, content_block: { ...block, input: {} } })
        send('content_block_delta', {
          index,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) }
        })
      }
      send('content_block_stop', { index: index++ })
    },
    finish(stopReason: 'end_turn' | 'tool_use' = 'end_turn') {
      send('message_delta', { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } })
      send('message_stop', {})
      res.end()
    }
  }
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Native probe timed out')), timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function nativeProbe(options: Pick<Options, 'agents'> = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'cherry-claude-contract-'))
  const cwd = path.join(directory, 'work')
  const config = path.join(directory, 'config')
  await mkdir(cwd)
  await mkdir(config)
  let input = new AsyncEventQueue<SDKUserMessage>()
  const requests = new AsyncEventQueue<{ reply: ReturnType<typeof modelReply>; body: { messages: unknown[] } }>()
  const incoming = requests[Symbol.asyncIterator]()
  const responses = new Set<ServerResponse>()
  const failures: unknown[] = []
  let count = 0
  const server = await startTestHttpServer((req, res) => {
    if (req.method !== 'POST' || req.url?.split('?')[0] !== '/v1/messages') {
      res.writeHead(404).end('{}')
      return
    }
    responses.add(res)
    res.once('close', () => responses.delete(res))
    void (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString())
      requests.push({ reply: modelReply(res, `msg_contract_${++count}`, body.model), body })
    })().catch((error) => {
      failures.push(error)
      res.destroy()
    })
  })
  const hooks: HookInput[] = []
  const events: SDKMessage[] = []
  const createQuery = (resume?: string) =>
    query({
      prompt: input,
      options: {
        cwd,
        env: {
          PATH: process.env.PATH,
          TMPDIR: process.env.TMPDIR,
          CLAUDE_CONFIG_DIR: config,
          ANTHROPIC_BASE_URL: server.url,
          ANTHROPIC_API_KEY: 'local-contract-test',
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'
        },
        settingSources: [],
        permissionMode: 'default',
        model: 'claude-sonnet-4-6',
        systemPrompt: 'Local runtime contract test.',
        tools: ['Agent', 'SendMessage'],
        allowedTools: ['Agent', 'SendMessage'],
        agents: {
          probe: {
            description: 'Contract probe child',
            prompt: 'Return the requested probe content.',
            tools: [],
            model: 'inherit'
          }
        },
        ...options,
        resume,
        includePartialMessages: true,
        forwardSubagentText: true,
        maxTurns: 5,
        hooks: {
          SubagentStart: [
            {
              hooks: [
                async (event) => {
                  hooks.push(event)
                  return {}
                }
              ]
            }
          ],
          SubagentStop: [
            {
              hooks: [
                async (event) => {
                  hooks.push(event)
                  return {}
                }
              ]
            }
          ]
        }
      }
    })
  let sdk = createQuery()
  const consume = () =>
    (async () => {
      for await (const event of sdk) events.push(event)
    })().catch((error) => failures.push(error))
  let pump = consume()
  return {
    get sdk() {
      return sdk
    },
    events,
    hooks,
    async restart(sessionId: string) {
      input.close()
      sdk.close()
      await bounded(pump)
      input = new AsyncEventQueue<SDKUserMessage>()
      sdk = createQuery(sessionId)
      pump = consume()
    },
    send(text: string, priority?: SDKUserMessage['priority']) {
      const uuid = randomUUID()
      input.push({
        type: 'user',
        uuid,
        priority,
        message: { role: 'user', content: text },
        session_id: '',
        parent_tool_use_id: null
      })
      return uuid
    },
    async request() {
      const result = await bounded(incoming.next())
      if (result.done) throw new Error('Native probe closed')
      return result.value
    },
    async event(predicate: (event: SDKMessage) => boolean) {
      await expect
        .poll(
          () => {
            if (failures.length) throw failures[0]
            return events.find(predicate)
          },
          { timeout: timeoutMs }
        )
        .toBeDefined()
      return events.find(predicate)!
    },
    async history(sessionId: string) {
      const result = await run(
        process.execPath,
        [fileURLToPath(new URL('./fixtures/nativeHistory.mjs', import.meta.url)), sessionId, cwd],
        {
          env: { PATH: process.env.PATH, CLAUDE_CONFIG_DIR: config },
          timeout: timeoutMs
        }
      )
      return JSON.parse(result.stdout) as {
        root: SessionMessage[]
        children: Record<string, SessionMessage[]>
        entries: { uuid?: string }[]
      }
    },
    async close() {
      input.close()
      sdk.close()
      for (const response of responses) response.destroy()
      requests.close()
      try {
        await bounded(pump)
      } finally {
        await server.close()
        await rm(directory, { recursive: true, force: true })
      }
    }
  }
}

function spawn(id: string, background = false): ReplyBlock {
  return {
    type: 'tool_use',
    id,
    name: 'Agent',
    input: { description: id, prompt: `Child ${id}`, subagent_type: 'probe', run_in_background: background }
  }
}

it('keeps child blocks independently observable and joins live identities to native history', async () => {
  const probe = await nativeProbe()
  try {
    const inputId = probe.send('Run the foreground child')
    const root = await probe.request()
    root.reply.block({ type: 'text', text: 'Parent starts child' })
    root.reply.block(spawn('toolu_child'))
    root.reply.finish('tool_use')
    const child = await probe.request()
    child.reply.block({ type: 'text', text: 'Child first block' })
    await probe.event((event) => event.type === 'assistant' && event.parent_tool_use_id === 'toolu_child')
    expect(probe.events.some((event) => event.type === 'result')).toBe(false)
    child.reply.block({ type: 'text', text: 'Child second block' })
    child.reply.finish()
    const parent = await probe.request()
    parent.reply.block({ type: 'text', text: 'Parent completed' })
    parent.reply.finish()
    const result = await probe.event((event) => event.type === 'result')
    if (result.type !== 'result') throw new Error('Missing root result')
    expect(result).toMatchObject({ is_error: false, user_message_uuid: inputId, result: 'Parent completed' })
    const childBlocks = probe.events
      .filter((event) => event.type === 'assistant')
      .filter((event) => event.parent_tool_use_id === 'toolu_child')
    expect(childBlocks.map((event) => event.message.content)).toEqual([
      [{ type: 'text', text: 'Child first block' }],
      [{ type: 'text', text: 'Child second block' }]
    ])
    expect(new Set(childBlocks.map((event) => event.uuid)).size).toBe(2)
    expect(new Set(childBlocks.map((event) => event.message.id)).size).toBe(1)
    const started = probe.hooks.find((hook) => hook.hook_event_name === 'SubagentStart')!
    const nativeId = started.agent_id
    expect(probe.events).toContainEqual(
      expect.objectContaining({
        subtype: 'task_started',
        task_id: nativeId,
        tool_use_id: 'toolu_child',
        is_backgrounded: false
      })
    )
    const toolResult = probe.events.find((event) => event.type === 'user' && event.tool_use_result)
    expect(toolResult).toMatchObject({ tool_use_result: { agentId: nativeId, status: 'completed' } })
    const history = await probe.history(result.session_id)
    expect(history.root).toContainEqual(expect.objectContaining({ uuid: inputId }))
    expect(
      history.children[nativeId].filter((message) => message.type === 'assistant').map((message) => message.uuid)
    ).toEqual(childBlocks.map((event) => event.uuid))
    expect(history.root.some((message) => childBlocks.some((block) => block.uuid === message.uuid))).toBe(false)
  } finally {
    await probe.close()
  }
})

// The pinned CLI emits this frame outside the published SDKMessage union; it is only a probe barrier.
function isQueued(event: unknown, inputId: string): boolean {
  return (
    typeof event === 'object' &&
    event !== null &&
    'type' in event &&
    event.type === 'command_lifecycle' &&
    'command_uuid' in event &&
    event.command_uuid === inputId &&
    'state' in event &&
    event.state === 'queued'
  )
}

function isToolResultRequest(body: { messages: unknown[] }) {
  const message = body.messages.at(-1) as { content: Array<{ type: string }> }
  return Array.isArray(message.content) && message.content.some((block) => block.type === 'tool_result')
}

it('continues observing a background child after the parent result', async () => {
  const probe = await nativeProbe()
  try {
    probe.send('Run a background child')
    const root = await probe.request()
    root.reply.block(spawn('toolu_background', true))
    root.reply.finish('tool_use')
    const pending = [await probe.request(), await probe.request()]
    const parent = pending.find(({ body }) => isToolResultRequest(body))!
    const child = pending.find(({ body }) => !isToolResultRequest(body))!
    parent.reply.block({ type: 'text', text: 'Parent finished first' })
    parent.reply.finish()
    await probe.event((event) => event.type === 'result')
    child.reply.block({ type: 'text', text: 'Child output after parent result' })
    await probe.event((event) => event.type === 'assistant' && event.parent_tool_use_id === 'toolu_background')
    child.reply.finish()
    await probe.event(
      (event) =>
        event.type === 'system' &&
        event.subtype === 'task_notification' &&
        event.tool_use_id === 'toolu_background' &&
        event.status === 'completed'
    )
    const resultIndex = probe.events.findIndex((event) => event.type === 'result')
    const childIndex = probe.events.findIndex(
      (event) => event.type === 'assistant' && event.parent_tool_use_id === 'toolu_background'
    )
    expect(childIndex).toBeGreaterThan(resultIndex)
    expect(probe.events[childIndex]).toMatchObject({
      message: { content: [{ type: 'text', text: 'Child output after parent result' }] }
    })
  } finally {
    await probe.close()
  }
})

it('stops only the selected task while its sibling and parent finish', async () => {
  const probe = await nativeProbe()
  try {
    probe.send('Run two children')
    const root = await probe.request()
    root.reply.block(spawn('toolu_stop', true))
    root.reply.block(spawn('toolu_survive', true))
    root.reply.finish('tool_use')
    const pending = [await probe.request(), await probe.request(), await probe.request()]
    const parent = pending.find(({ body }) => isToolResultRequest(body))!
    const children = pending.filter(({ body }) => !isToolResultRequest(body))
    const stopped = children.find(({ body }) => JSON.stringify(body.messages.at(-1)).includes('Child toolu_stop'))!
    const sibling = children.find(({ body }) => JSON.stringify(body.messages.at(-1)).includes('Child toolu_survive'))!
    const task = await probe.event(
      (event) => event.type === 'system' && event.subtype === 'task_started' && event.tool_use_id === 'toolu_stop'
    )
    if (task.type !== 'system' || task.subtype !== 'task_started') throw new Error('Missing task identity')
    await probe.sdk.stopTask(task.task_id)
    await probe.event(
      (event) =>
        event.type === 'system' &&
        event.subtype === 'task_notification' &&
        event.task_id === task.task_id &&
        event.status === 'stopped'
    )
    await bounded(stopped.reply.closed)
    sibling.reply.block({ type: 'text', text: 'Sibling survived' })
    sibling.reply.finish()
    await probe.event(
      (event) =>
        event.type === 'system' &&
        event.subtype === 'task_notification' &&
        event.tool_use_id === 'toolu_survive' &&
        event.status === 'completed'
    )
    parent.reply.block({ type: 'text', text: 'Parent survived' })
    parent.reply.finish()
    expect(await probe.event((event) => event.type === 'result')).toMatchObject({
      is_error: false,
      result: 'Parent survived'
    })
    expect(probe.events).toContainEqual(
      expect.objectContaining({
        type: 'assistant',
        parent_tool_use_id: 'toolu_survive',
        message: expect.objectContaining({ content: [{ type: 'text', text: 'Sibling survived' }] })
      })
    )
  } finally {
    await probe.close()
  }
})

it('reports a queued input that survives root interrupt and attributes the subsequent reply', async () => {
  const probe = await nativeProbe()
  try {
    const firstId = probe.send('Start a long answer')
    const first = await probe.request()
    first.reply.block({ type: 'text', text: 'Before interrupt' })
    await probe.event((event) => event.type === 'assistant' && event.user_message_uuid === firstId)
    const nextId = probe.send('Continue after interrupt', 'later')
    await probe.event((event) => isQueued(event, nextId))
    const receipt = await probe.sdk.interrupt()
    expect(receipt?.still_queued).toContain(nextId)
    await bounded(first.reply.closed)
    const next = await probe.request()
    expect(JSON.stringify(next.body.messages)).toContain('Continue after interrupt')
    next.reply.block({ type: 'text', text: 'Follow-up survived' })
    next.reply.finish()
    expect(await probe.event((event) => event.type === 'result' && event.user_message_uuid === nextId)).toMatchObject({
      is_error: false,
      result: 'Follow-up survived'
    })
  } finally {
    await probe.close()
  }
})

it('places next-priority input at the parent tool boundary with both input identities', async () => {
  const probe = await nativeProbe()
  try {
    const firstId = probe.send('Run a foreground child before answering')
    const root = await probe.request()
    root.reply.block(spawn('toolu_steer'))
    root.reply.finish('tool_use')
    const child = await probe.request()
    const nextId = probe.send('Use the revised parent requirement', 'next')
    await probe.event((event) => isQueued(event, nextId))
    child.reply.block({ type: 'text', text: 'Child done' })
    child.reply.finish()
    const parent = await probe.request()
    expect(JSON.stringify(parent.body.messages)).toContain('Use the revised parent requirement')
    parent.reply.block({ type: 'text', text: 'Parent used revised requirement' })
    parent.reply.finish()
    const result = await probe.event((event) => event.type === 'result')
    if (result.type !== 'result') throw new Error('Missing root result')
    expect(result).toMatchObject({ is_error: false, user_message_uuids: expect.arrayContaining([firstId, nextId]) })
  } finally {
    await probe.close()
  }
})

it('runs next-priority input as a follow-up when the active answer ends without a tool boundary', async () => {
  const probe = await nativeProbe()
  try {
    const firstId = probe.send('Answer without tools')
    const first = await probe.request()
    first.reply.block({ type: 'text', text: 'First answer' })
    await probe.event((event) => event.type === 'assistant' && event.user_message_uuid === firstId)
    const nextId = probe.send('New requirement at the end boundary', 'next')
    await probe.event((event) => isQueued(event, nextId))
    first.reply.finish()
    const next = await probe.request()
    expect(JSON.stringify(next.body.messages)).toContain('New requirement at the end boundary')
    next.reply.block({ type: 'text', text: 'Follow-up answer' })
    next.reply.finish()
    expect(await probe.event((event) => event.type === 'result' && event.user_message_uuid === nextId)).toMatchObject({
      is_error: false,
      result: 'Follow-up answer'
    })
  } finally {
    await probe.close()
  }
})

it('routes a grandchild to its immediate parent in live events and native history', async () => {
  const probe = await nativeProbe({
    agents: {
      probe: { description: 'Nested probe', prompt: 'Run the requested child.', tools: ['Agent'], model: 'inherit' }
    }
  })
  try {
    probe.send('Run a nested child')
    const root = await probe.request()
    root.reply.block(spawn('toolu_parent'))
    root.reply.finish('tool_use')
    const child = await probe.request()
    child.reply.block(spawn('toolu_grandchild'))
    child.reply.finish('tool_use')
    const grandchild = await probe.request()
    grandchild.reply.block({ type: 'text', text: 'Grandchild answer' })
    grandchild.reply.finish()
    const childResult = await probe.request()
    childResult.reply.block({ type: 'text', text: 'Child answer' })
    childResult.reply.finish()
    const rootResult = await probe.request()
    rootResult.reply.block({ type: 'text', text: 'Root answer' })
    rootResult.reply.finish()
    const result = await probe.event((event) => event.type === 'result')
    if (result.type !== 'result') throw new Error('Missing root result')
    const tasks = probe.events.filter((event) => event.type === 'system' && event.subtype === 'task_started')
    const parent = tasks.find((task) => task.tool_use_id === 'toolu_parent')!
    const nested = tasks.find((task) => task.tool_use_id === 'toolu_grandchild')!
    expect(nested).toMatchObject({ task_type: 'local_agent', parent_task_id: parent.task_id, spawn_depth: 2 })
    expect(probe.events).toContainEqual(
      expect.objectContaining({
        type: 'assistant',
        agent_id: nested.task_id,
        parent_tool_use_id: 'toolu_grandchild',
        message: expect.objectContaining({ content: [{ type: 'text', text: 'Grandchild answer' }] })
      })
    )
    const history = await probe.history(result.session_id)
    expect(history.children[nested.task_id]).toContainEqual(
      expect.objectContaining({
        type: 'assistant',
        parent_agent_id: parent.task_id,
        message: expect.objectContaining({ content: [{ type: 'text', text: 'Grandchild answer' }] })
      })
    )
    expect(
      history.children[parent.task_id].some((message) => JSON.stringify(message.message).includes('Grandchild answer'))
    ).toBe(true)
  } finally {
    await probe.close()
  }
})

it('closes an interrupted partial text block and retains its native identity', async () => {
  const probe = await nativeProbe()
  try {
    const inputId = probe.send('Generate a partial answer')
    const request = await probe.request()
    request.reply.startText('Unfinished text')
    await probe.event((event) => event.type === 'stream_event' && event.event.type === 'content_block_delta')
    await probe.sdk.interrupt()
    await bounded(request.reply.closed)
    const result = await probe.event((event) => event.type === 'result' && event.user_message_uuid === inputId)
    if (result.type !== 'result') throw new Error('Missing root result')
    const partial = probe.events.find((event) => event.type === 'assistant' && event.aborted)
    expect(partial).toMatchObject({ message: { content: [{ type: 'text', text: 'Unfinished text' }] } })
    const types = probe.events.filter((event) => event.type === 'stream_event').map((event) => event.event.type)
    expect(types).toContain('content_block_stop')
    expect(types.at(-1)).toBe('message_stop')
    expect(types.indexOf('content_block_stop')).toBeLessThan(types.indexOf('message_stop'))
    const history = await probe.history(result.session_id)
    expect(history.root).toContainEqual(expect.objectContaining({ uuid: partial!.uuid }))
  } finally {
    await probe.close()
  }
})

it.each([false, true])('preserves child identity but starts a new run on SendMessage (restart=%s)', async (restart) => {
  const probe = await nativeProbe()
  try {
    const firstId = probe.send('Start a child')
    const root = await probe.request()
    root.reply.block(spawn('toolu_original'))
    root.reply.finish('tool_use')
    const child = await probe.request()
    child.reply.block({ type: 'text', text: 'Original child answer' })
    child.reply.finish()
    const parent = await probe.request()
    parent.reply.block({ type: 'text', text: 'Original parent answer' })
    parent.reply.finish()
    const result = await probe.event((event) => event.type === 'result' && event.user_message_uuid === firstId)
    if (result.type !== 'result') throw new Error('Missing root result')
    const original = probe.events.find((event) => event.type === 'system' && event.subtype === 'task_started')!
    if (original.type !== 'system' || original.subtype !== 'task_started') throw new Error('Missing child task')
    if (restart) await probe.restart(result.session_id)
    probe.send('Ask the same child another question')
    const followup = await probe.request()
    followup.reply.block({
      type: 'tool_use',
      id: 'toolu_continue',
      name: 'SendMessage',
      input: { to: original.task_id, message: 'Continue with the original context', summary: 'Child follow-up' }
    })
    followup.reply.finish('tool_use')
    const pending = [await probe.request(), await probe.request()]
    const resumed = pending.find(({ body }) => JSON.stringify(body.messages).includes('Original child answer'))!
    const resumedParent = pending.find((request) => request !== resumed)!
    expect(JSON.stringify(resumed.body.messages)).toContain('Continue with the original context')
    resumedParent.reply.block({ type: 'text', text: 'Parent need not wait for continuation' })
    resumedParent.reply.finish()
    resumed.reply.block({ type: 'text', text: 'Continued child answer' })
    resumed.reply.finish()
    const newRun = await probe.event(
      (event) =>
        event.type === 'system' &&
        event.subtype === 'task_started' &&
        event.task_id === original.task_id &&
        event.run_id !== original.run_id
    )
    if (newRun.type !== 'system' || newRun.subtype !== 'task_started') throw new Error('Missing resumed task')
    expect(original.run_id).toBeTruthy()
    expect(newRun.run_id! > original.run_id!).toBe(true)
    expect(newRun.is_backgrounded).toBe(true)
    await probe.event(
      (event) =>
        event.type === 'system' &&
        event.subtype === 'task_notification' &&
        event.task_id === original.task_id &&
        event.run_id === newRun.run_id &&
        event.status === 'completed'
    )
    const answer = probe.events.find(
      (event) =>
        event.type === 'assistant' &&
        event.message.content.some((block) => block.type === 'text' && block.text === 'Continued child answer')
    )
    expect(answer).toMatchObject({ agent_id: original.task_id })
    const history = await probe.history(result.session_id)
    expect(Object.keys(history.children)).toEqual([original.task_id])
    expect(JSON.stringify(history.children[original.task_id])).toContain('Original child answer')
    expect(JSON.stringify(history.children[original.task_id])).toContain('Continue with the original context')
    expect(history.children[original.task_id]).toContainEqual(expect.objectContaining({ uuid: answer!.uuid }))
  } finally {
    await probe.close()
  }
})

it('compacts through native commands without deleting the retained conversation', async () => {
  const probe = await nativeProbe()
  try {
    const firstId = probe.send('Retain the original decision. ' + 'Additional context. '.repeat(500))
    const first = await probe.request()
    first.reply.block({ type: 'text', text: 'Original decision retained' })
    first.reply.finish()
    const result = await probe.event((event) => event.type === 'result' && event.user_message_uuid === firstId)
    if (result.type !== 'result') throw new Error('Missing root result')
    const before = await probe.history(result.session_id)
    probe.send('/compact Preserve the original decision')
    const compact = await probe.request()
    compact.reply.block({ type: 'text', text: '<summary>Summary: original decision retained.</summary>' })
    compact.reply.finish()
    await probe.event((event) => event.type === 'system' && event.subtype === 'compact_boundary')
    const after = await probe.history(result.session_id)
    expect(JSON.stringify(after.root)).toContain('Summary: original decision retained.')
    for (const message of before.root) {
      expect(after.entries).toContainEqual(expect.objectContaining({ uuid: message.uuid }))
    }
    await probe.restart(result.session_id)
    const nextId = probe.send('Continue after compact')
    const next = await probe.request()
    expect(JSON.stringify(next.body.messages)).toContain('Summary: original decision retained.')
    next.reply.block({ type: 'text', text: 'Post-compaction answer' })
    next.reply.finish()
    expect(await probe.event((event) => event.type === 'result' && event.user_message_uuid === nextId)).toMatchObject({
      is_error: false,
      result: 'Post-compaction answer'
    })
  } finally {
    await probe.close()
  }
})

it('reports a new native session identity for clear while retaining the old archive', async () => {
  const probe = await nativeProbe()
  try {
    const firstId = probe.send('Original conversation')
    const first = await probe.request()
    first.reply.block({ type: 'text', text: 'Old conversation answer' })
    first.reply.finish()
    const old = await probe.event((event) => event.type === 'result' && event.user_message_uuid === firstId)
    if (old.type !== 'result') throw new Error('Missing old session result')
    const clearId = probe.send('/clear')
    const reset = await probe.event((event) => event.type === 'conversation_reset')
    if (reset.type !== 'conversation_reset') throw new Error('Missing reset')
    expect(reset).toMatchObject({ trigger: 'clear', user_message_uuid: clearId })
    const cleared = await probe.event((event) => event.type === 'result' && event.user_message_uuid === clearId)
    if (cleared.type !== 'result') throw new Error('Missing clear result')
    expect(cleared.is_error).toBe(false)
    expect(cleared.session_id).not.toBe(old.session_id)
    expect(probe.events).toContainEqual(
      expect.objectContaining({ type: 'system', subtype: 'init', session_id: cleared.session_id })
    )
    const nextId = probe.send('New conversation')
    const next = await probe.request()
    expect(JSON.stringify(next.body.messages)).not.toContain('Old conversation answer')
    next.reply.block({ type: 'text', text: 'New conversation answer' })
    next.reply.finish()
    expect(await probe.event((event) => event.type === 'result' && event.user_message_uuid === nextId)).toMatchObject({
      session_id: cleared.session_id,
      result: 'New conversation answer'
    })
    const history = await probe.history(old.session_id)
    expect(JSON.stringify(history.root)).toContain('Old conversation answer')
    const newHistory = await probe.history(cleared.session_id)
    expect(JSON.stringify(newHistory.root)).toContain('New conversation answer')
    expect(JSON.stringify(newHistory.root)).not.toContain('Old conversation answer')
    await probe.restart(cleared.session_id)
    const resumedId = probe.send('Continue the new conversation')
    const resumed = await probe.request()
    expect(JSON.stringify(resumed.body.messages)).toContain('New conversation answer')
    expect(JSON.stringify(resumed.body.messages)).not.toContain('Old conversation answer')
    resumed.reply.block({ type: 'text', text: 'Resumed new conversation' })
    resumed.reply.finish()
    expect(
      await probe.event((event) => event.type === 'result' && event.user_message_uuid === resumedId)
    ).toMatchObject({
      session_id: cleared.session_id,
      is_error: false
    })
  } finally {
    await probe.close()
  }
})

it('keeps a fork child archive separate while preserving its inherited context', async () => {
  const probe = await nativeProbe()
  try {
    probe.send('Original root context for the fork')
    const root = await probe.request()
    root.reply.block({ type: 'text', text: 'Root context before fork' })
    root.reply.block({
      type: 'tool_use',
      id: 'toolu_fork',
      name: 'Agent',
      input: {
        description: 'Fork probe',
        prompt: 'Answer with inherited context',
        subagent_type: 'fork',
        run_in_background: false
      }
    })
    root.reply.finish('tool_use')
    const child = await probe.request()
    expect(JSON.stringify(child.body.messages)).toContain('Original root context for the fork')
    child.reply.block({ type: 'text', text: 'Fork child answer' })
    child.reply.finish()
    const parent = await probe.request()
    parent.reply.block({ type: 'text', text: 'Parent after fork' })
    parent.reply.finish()
    const result = await probe.event((event) => event.type === 'result')
    if (result.type !== 'result') throw new Error('Missing root result')
    const answer = probe.events.find(
      (event) =>
        event.type === 'assistant' &&
        event.agent_id &&
        event.message.content.some((block) => block.type === 'text' && block.text === 'Fork child answer')
    )!
    if (answer.type !== 'assistant') throw new Error('Missing fork reply')
    const history = await probe.history(result.session_id)
    expect(history.children[answer.agent_id!]).toContainEqual(expect.objectContaining({ uuid: answer.uuid }))
    expect(history.root.some((message) => message.uuid === answer.uuid)).toBe(false)
  } finally {
    await probe.close()
  }
})
