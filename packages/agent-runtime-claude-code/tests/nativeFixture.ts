import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { expect } from 'vitest'

import { runtimeId, ThreadFeed, type OperationResult, type ThreadSnapshot } from '@cherrystudio/agent-runtime'

import {
  createClaudeCodeRuntime,
  type ClaudeObservation,
  type ClaudeCommandLifecycle,
  type ClaudeSessionOptions,
  type ClaudeThreadHandle
} from '../src'

export function confirmed<T>(result: OperationResult<T>): T {
  if (result.status !== 'confirmed') throw new Error(JSON.stringify(result))
  return result.value
}

export const inputId = () => runtimeId<'input'>(randomUUID())
export type ReplyBlock = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: object }

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
    closed,
    startText(text: string) {
      send('content_block_start', { index, content_block: { type: 'text', text: '' } })
      send('content_block_delta', { index, delta: { type: 'text_delta', text } })
    },
    block(block: ReplyBlock) {
      send('content_block_start', {
        index,
        content_block: block.type === 'text' ? { type: 'text', text: '' } : { ...block, input: {} }
      })
      send('content_block_delta', {
        index,
        delta:
          block.type === 'text'
            ? { type: 'text_delta', text: block.text }
            : { type: 'input_json_delta', partial_json: JSON.stringify(block.input) }
      })
      send('content_block_stop', { index: index++ })
    },
    finish(stopReason: 'end_turn' | 'tool_use' = 'end_turn') {
      send('message_delta', { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } })
      send('message_stop', {})
      res.end()
    }
  }
}

export async function fixture(overrides: Partial<ClaudeSessionOptions> = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'cherry-claude-runtime-'))
  const cwd = path.join(directory, 'work')
  const configDir = path.join(directory, 'config')
  await mkdir(cwd)
  await mkdir(configDir)
  const pending: { reply: ReturnType<typeof modelReply>; body: { messages: unknown[] } }[] = []
  const responses = new Set<ServerResponse>()
  const errors: unknown[] = []
  const children: ChildProcess[] = []
  let count = 0
  const server = createServer((req, res) => {
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
      pending.push({ body, reply: modelReply(res, `msg_runtime_${++count}`, body.model) })
    })().catch((error) => {
      errors.push(error)
      res.destroy()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test endpoint')
  const options: ClaudeSessionOptions = {
    cwd,
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
      ANTHROPIC_API_KEY: 'local-runtime-test',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'
    },
    settingSources: [],
    permissionMode: 'default',
    model: 'claude-sonnet-4-6',
    systemPrompt: 'Local adapter test.',
    tools: ['Agent', 'SendMessage'],
    allowedTools: ['Agent', 'SendMessage'],
    maxTurns: 6,
    agents: {
      probe: { description: 'Adapter child', prompt: 'Return the requested content.', tools: [], model: 'inherit' }
    },
    spawnClaudeCodeProcess: (args) => {
      const child = spawn(args.command, args.args, {
        cwd: args.cwd,
        env: args.env,
        signal: args.signal,
        stdio: ['pipe', 'pipe', 'pipe']
      })
      child.stderr.resume()
      children.push(child)
      return child
    },
    ...overrides
  }
  const backendId = runtimeId<'backend'>(randomUUID())
  const runtimes: ReturnType<typeof createClaudeCodeRuntime>[] = []
  const runtime = () => {
    const result = createClaudeCodeRuntime({
      backendId,
      configDir,
      load: async () => options,
      onError: (error) => errors.push(error)
    })
    runtimes.push(result)
    return result
  }
  return {
    directory,
    configDir,
    options,
    errors,
    children,
    runtime,
    async request() {
      await expect.poll(() => pending.length, { timeout: 15000 }).toBeGreaterThan(0)
      return pending.shift()!
    },
    async close() {
      for (const native of runtimes) await native.shutdown()
      for (const response of responses) response.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(directory, { recursive: true, force: true })
    }
  }
}

export async function observe(handle: ClaudeThreadHandle) {
  const batches: ClaudeObservation[] = []
  const native: (SDKMessage | ClaudeCommandLifecycle)[] = []
  const initial: ThreadSnapshot = {
    type: 'snapshot',
    coverage: 'live-only',
    items: [],
    inputs: [],
    activity: { scope: 'foreground', state: 'unknown' }
  }
  const state = new ThreadFeed(initial, (error) => {
    throw error
  })
  const subscription = confirmed(
    await handle.claude.observe((batch) => {
      batches.push(batch)
      native.push(...batch.native.flatMap((entry) => (entry.source === 'live' ? [entry.message] : [])))
      for (const event of batch.events) state.publish(event)
    })
  )
  return {
    batches,
    native,
    subscription,
    get snapshot() {
      return state.snapshot
    },
    async event(predicate: (message: SDKMessage | ClaudeCommandLifecycle) => boolean) {
      await expect.poll(() => native.find(predicate), { timeout: 15000 }).toBeDefined()
      return native.find(predicate)!
    }
  }
}

export const spawnChild = (id: string, background = false): ReplyBlock => ({
  type: 'tool_use',
  id,
  name: 'Agent',
  input: { description: id, prompt: `Child ${id}`, subagent_type: 'probe', run_in_background: background }
})

export function textOf(snapshot: ThreadSnapshot): string[] {
  return snapshot.items.flatMap((item) => (item.type === 'message' ? item.parts.map((part) => part.text) : []))
}
