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

async function nativeProbe() {
  const directory = await mkdtemp(path.join(tmpdir(), 'cherry-claude-contract-'))
  const cwd = path.join(directory, 'work')
  const config = path.join(directory, 'config')
  await mkdir(cwd)
  await mkdir(config)
  const input = new AsyncEventQueue<SDKUserMessage>()
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
  const sdk = query({
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
      model: 'claude-sonnet-4-6',
      systemPrompt: 'Local runtime contract test.',
      tools: ['Agent'],
      allowedTools: ['Agent'],
      agents: {
        probe: {
          description: 'Contract probe child',
          prompt: 'Return the requested probe content.',
          tools: [],
          model: 'inherit'
        }
      },
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
  const pump = (async () => {
    for await (const event of sdk) events.push(event)
  })().catch((error) => failures.push(error))
  return {
    sdk,
    events,
    hooks,
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
      return JSON.parse(result.stdout) as { root: SessionMessage[]; children: Record<string, SessionMessage[]> }
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
    if (result.type !== 'result') throw new Error('Missing root result')
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
